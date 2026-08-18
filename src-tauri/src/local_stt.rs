use crate::logger;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
#[cfg(any(unix, windows))]
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;

const WHISPER_RUNTIME_NAME: &str = "talkis-stt";
const DIARIZATION_RUNTIME_NAME: &str = "talkis-diarize";
const WHISPER_RUNTIME_API_VERSION: u32 = 3;
const DEFAULT_RUNTIME_MANIFEST_URL: &str = "https://talkis.ru/downloads/talkis-stt/manifest.json";
pub const MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "local-stt-model-download-progress";
pub const LOCAL_DIARIZATION_MODEL_ID: &str = "sherpa-diarization-pyannote-titanet-int8";
const MODEL_DOWNLOAD_MAX_ATTEMPTS: usize = 3;
const MODEL_DOWNLOAD_RETRY_DELAYS_MS: [u64; MODEL_DOWNLOAD_MAX_ATTEMPTS - 1] = [750, 1_500];
const RUNTIME_START_TIMEOUT_SECS: u64 = 15;
const RUNTIME_READINESS_POLL_INTERVAL_MS: u64 = 250;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalRuntimeKind {
    Whisper,
    Diarization,
}

impl LocalRuntimeKind {
    fn runtime_name(self) -> &'static str {
        match self {
            LocalRuntimeKind::Whisper => WHISPER_RUNTIME_NAME,
            LocalRuntimeKind::Diarization => DIARIZATION_RUNTIME_NAME,
        }
    }

    fn engine_name(self) -> &'static str {
        match self {
            LocalRuntimeKind::Whisper => "transcribe.cpp",
            LocalRuntimeKind::Diarization => "sherpa-onnx",
        }
    }

    fn default_port(self) -> u16 {
        match self {
            LocalRuntimeKind::Whisper => 8000,
            LocalRuntimeKind::Diarization => 8003,
        }
    }

    fn label(self) -> &'static str {
        match self {
            LocalRuntimeKind::Whisper => "Whisper",
            LocalRuntimeKind::Diarization => "Diarization",
        }
    }
}

#[derive(Default)]
struct ManagedRuntimeEndpoints {
    whisper: Option<String>,
    diarization: Option<String>,
}

static MANAGED_RUNTIME_ENDPOINTS: OnceLock<Mutex<ManagedRuntimeEndpoints>> = OnceLock::new();
static MANAGED_RUNTIME_START_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static LOCAL_RUNTIME_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn managed_runtime_endpoints() -> &'static Mutex<ManagedRuntimeEndpoints> {
    MANAGED_RUNTIME_ENDPOINTS.get_or_init(|| Mutex::new(ManagedRuntimeEndpoints::default()))
}

fn managed_runtime_start_lock() -> &'static tokio::sync::Mutex<()> {
    MANAGED_RUNTIME_START_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn local_runtime_http_client() -> &'static reqwest::Client {
    LOCAL_RUNTIME_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // The managed runtime is always loopback-only. It must never inherit
            // a Windows/VPN system proxy, even when localhost is not in its bypass list.
            .no_proxy()
            .pool_max_idle_per_host(0)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn remembered_runtime_endpoint(kind: LocalRuntimeKind) -> Option<String> {
    managed_runtime_endpoints()
        .lock()
        .ok()
        .and_then(|endpoints| match kind {
            LocalRuntimeKind::Whisper => endpoints.whisper.clone(),
            LocalRuntimeKind::Diarization => endpoints.diarization.clone(),
        })
}

fn remember_runtime_endpoint(kind: LocalRuntimeKind, endpoint: String) {
    if let Ok(mut endpoints) = managed_runtime_endpoints().lock() {
        match kind {
            LocalRuntimeKind::Whisper => endpoints.whisper = Some(endpoint),
            LocalRuntimeKind::Diarization => endpoints.diarization = Some(endpoint),
        }
    }
}

fn forget_runtime_endpoint(kind: LocalRuntimeKind) {
    if let Ok(mut endpoints) = managed_runtime_endpoints().lock() {
        match kind {
            LocalRuntimeKind::Whisper => endpoints.whisper = None,
            LocalRuntimeKind::Diarization => endpoints.diarization = None,
        }
    }
}

#[derive(Deserialize)]
struct RuntimeManifest {
    version: String,
    #[serde(rename = "macos-aarch64")]
    macos_aarch64: Option<RuntimeAsset>,
    #[serde(rename = "macos-x86_64")]
    macos_x86_64: Option<RuntimeAsset>,
}

#[derive(Deserialize)]
struct RuntimeAsset {
    url: String,
    sha256: String,
}

#[derive(Deserialize)]
struct HealthResponse {
    status: Option<String>,
    runtime: Option<String>,
    engine: Option<String>,
    api_version: Option<u32>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelResponseItem>,
}

#[derive(Deserialize)]
struct ModelResponseItem {
    id: String,
}

enum LocalSttProbe {
    Ready,
    StaleManagedRuntime,
    Unavailable,
}

#[derive(Serialize, Clone)]
pub struct ModelDownloadProgress {
    pub model: String,
    pub status: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

struct LocalModelInfo {
    id: &'static str,
    file_name: &'static str,
    url: &'static str,
}

const LOCAL_WHISPER_MODELS: &[LocalModelInfo] = &[
    LocalModelInfo {
        id: "whisper-tiny",
        file_name: "whisper-tiny-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-tiny-GGUF/resolve/main/whisper.cpp/whisper-tiny-q4_k.gguf",
    },
    LocalModelInfo {
        id: "whisper-base",
        file_name: "whisper-base-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-base-GGUF/resolve/main/whisper.cpp/whisper-base-q4_k.gguf",
    },
    LocalModelInfo {
        id: "whisper-small",
        file_name: "whisper-small-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-small-GGUF/resolve/main/whisper.cpp/whisper-small-q4_k.gguf",
    },
    LocalModelInfo {
        id: "whisper-medium",
        file_name: "whisper-medium-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-medium-GGUF/resolve/main/whisper.cpp/whisper-medium-q4_k.gguf",
    },
    LocalModelInfo {
        id: "whisper-large-v3",
        file_name: "whisper-large-v3-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-large-v3-GGUF/resolve/main/whisper.cpp/whisper-large-v3-q4_k.gguf",
    },
    LocalModelInfo {
        id: "whisper-large-v3-turbo",
        file_name: "whisper-large-v3-turbo-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-large-v3-turbo-GGUF/resolve/main/whisper.cpp/whisper-large-v3-turbo-q4_k.gguf",
    },
    LocalModelInfo {
        id: "nvidia/parakeet-tdt-0.6b-v3",
        file_name: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "nvidia/parakeet-tdt-0.6b-v2",
        file_name: "parakeet-tdt-0.6b-v2-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v2-gguf/resolve/main/parakeet-tdt-0.6b-v2-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "nvidia/nemotron-3.5-asr-streaming-0.6b",
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "nvidia/nemotron-speech-streaming-en-0.6b",
        file_name: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/main/nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "moonshine-streaming-tiny",
        file_name: "moonshine-streaming-tiny-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/main/moonshine-streaming-tiny-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "moonshine-streaming-small",
        file_name: "moonshine-streaming-small-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/moonshine-streaming-small-gguf/resolve/main/moonshine-streaming-small-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "Qwen/Qwen3-ASR-0.6B",
        file_name: "Qwen3-ASR-0.6B-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/main/Qwen3-ASR-0.6B-Q8_0.gguf",
    },
    LocalModelInfo {
        id: "ai-sage/GigaAM-v3",
        file_name: "gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
        url: "https://huggingface.co/handy-computer/gigaam-v3-e2e-rnnt-gguf/resolve/main/gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
    },
];

const LOCAL_QWEN_MODEL_ID: &str = "Qwen/Qwen3-ASR-0.6B";
pub(crate) fn resolve_stt_base_url_from_models_url(models_url: &str) -> String {
    models_url
        .trim_end_matches('/')
        .strip_suffix("/v1/models")
        .or_else(|| models_url.trim_end_matches('/').strip_suffix("/models"))
        .unwrap_or_else(|| models_url.trim_end_matches('/'))
        .to_string()
}

pub fn managed_runtime_kind(models_url: &str) -> Option<LocalRuntimeKind> {
    let parsed = url::Url::parse(models_url.trim()).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }

    runtime_kind_for_port(parsed.port()?)
}

pub fn is_managed_whisper_runtime_url(models_url: &str) -> bool {
    managed_runtime_kind(models_url) == Some(LocalRuntimeKind::Whisper)
}

fn runtime_kind_for_port(port: u16) -> Option<LocalRuntimeKind> {
    if port == LocalRuntimeKind::Whisper.default_port() || (18000..=18049).contains(&port) {
        return Some(LocalRuntimeKind::Whisper);
    }

    if port == 8001 || port == 8002 || (18050..=18149).contains(&port) {
        return Some(LocalRuntimeKind::Whisper);
    }

    if port == LocalRuntimeKind::Diarization.default_port() || (18150..=18199).contains(&port) {
        return Some(LocalRuntimeKind::Diarization);
    }

    None
}

fn dynamic_port_range(kind: LocalRuntimeKind) -> std::ops::RangeInclusive<u16> {
    match kind {
        LocalRuntimeKind::Whisper => 18000..=18049,
        LocalRuntimeKind::Diarization => 18150..=18199,
    }
}

fn requested_port(base_url: &str, kind: LocalRuntimeKind) -> u16 {
    url::Url::parse(base_url)
        .ok()
        .and_then(|url| url.port())
        .filter(|port| {
            runtime_kind_for_port(*port) == Some(kind)
                && !(kind == LocalRuntimeKind::Whisper
                    && (*port == 8001 || *port == 8002 || (18050..=18149).contains(port)))
        })
        .unwrap_or_else(|| kind.default_port())
}

fn managed_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

fn managed_models_url(base_url: &str) -> String {
    format!("{}/v1/models", base_url.trim_end_matches('/'))
}

fn port_is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_available_runtime_port(kind: LocalRuntimeKind, preferred_port: u16) -> Result<u16, String> {
    if port_is_available(preferred_port) {
        return Ok(preferred_port);
    }

    if preferred_port != kind.default_port() && port_is_available(kind.default_port()) {
        return Ok(kind.default_port());
    }

    for port in dynamic_port_range(kind) {
        if port != preferred_port && port_is_available(port) {
            return Ok(port);
        }
    }

    Err(format!(
        "Не найден свободный порт для локального {} runtime. Освободите порт {} или закройте лишние локальные STT процессы.",
        kind.label(),
        kind.default_port()
    ))
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
        .map(|dir| dir.join("runtime").join("stt"))
}

pub fn default_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
        .map(|dir| dir.join("models").join("stt"))
}

fn resolve_models_dir(app: &AppHandle, _custom_dir: Option<&str>) -> Result<PathBuf, String> {
    default_models_dir(app)
}

fn local_model_info(value: &str) -> Option<&'static LocalModelInfo> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "whisper-tiny" | "tiny" | "systran/faster-whisper-tiny" | "whisper-tiny-q4_k.gguf" => {
            LOCAL_WHISPER_MODELS
                .iter()
                .find(|model| model.id == "whisper-tiny")
        }
        "whisper-base" | "base" | "systran/faster-whisper-base" | "whisper-base-q4_k.gguf" => {
            LOCAL_WHISPER_MODELS
                .iter()
                .find(|model| model.id == "whisper-base")
        }
        "whisper-small" | "small" | "systran/faster-whisper-small" | "whisper-small-q4_k.gguf" => {
            LOCAL_WHISPER_MODELS
                .iter()
                .find(|model| model.id == "whisper-small")
        }
        "whisper-medium"
        | "medium"
        | "systran/faster-whisper-medium"
        | "whisper-medium-q4_k.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "whisper-medium"),
        "whisper-large-v3"
        | "large-v3"
        | "systran/faster-whisper-large-v3"
        | "whisper-large-v3-q4_k.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "whisper-large-v3"),
        "whisper-large-v3-turbo"
        | "large-v3-turbo"
        | "systran/faster-whisper-large-v3-turbo"
        | "mlx-community/whisper-large-v3-turbo-4bit"
        | "whisper-large-v3-turbo-q4_k.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "whisper-large-v3-turbo"),
        "nvidia/parakeet-tdt-0.6b-v3"
        | "mlx-community/parakeet-tdt-0.6b-v3"
        | "parakeet-tdt-06b-v3"
        | "parakeet-tdt-0.6b-v3"
        | "parakeet-tdt-0.6b-v3-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "nvidia/parakeet-tdt-0.6b-v3"),
        "nvidia/parakeet-tdt-0.6b-v2"
        | "mlx-community/parakeet-tdt-0.6b-v2"
        | "parakeet-tdt-06b-v2"
        | "parakeet-tdt-0.6b-v2"
        | "parakeet-tdt-0.6b-v2-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "nvidia/parakeet-tdt-0.6b-v2"),
        "nvidia/nemotron-3.5-asr-streaming-0.6b"
        | "nemotron-35-asr-streaming-06b"
        | "nemotron-3.5-asr-streaming-0.6b"
        | "nemotron-3.5-asr-streaming-0.6b-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "nvidia/nemotron-3.5-asr-streaming-0.6b"),
        "nvidia/nemotron-speech-streaming-en-0.6b"
        | "nemotron-speech-streaming-en-06b"
        | "nemotron-speech-streaming-en-0.6b"
        | "nemotron-speech-streaming-en-0.6b-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "nvidia/nemotron-speech-streaming-en-0.6b"),
        "moonshine-streaming-tiny" | "moonshine-streaming-tiny-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "moonshine-streaming-tiny"),
        "moonshine-streaming-small" | "moonshine-streaming-small-q8_0.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "moonshine-streaming-small"),
        "qwen/qwen3-asr-0.6b" | "qwen3-asr-06b" | "qwen3-asr-0.6b" | "qwen3-asr-0.6b-q8_0.gguf" => {
            LOCAL_WHISPER_MODELS
                .iter()
                .find(|model| model.id == LOCAL_QWEN_MODEL_ID)
        }
        "ai-sage/gigaam-v3"
        | "gigaam-v3"
        | "gigaam-v3-e2e-rnnt"
        | "gigaam-v3-e2e-rnnt-q4_k_m.gguf" => LOCAL_WHISPER_MODELS
            .iter()
            .find(|model| model.id == "ai-sage/GigaAM-v3"),
        _ => None,
    }
}

fn emit_download_progress(app: &AppHandle, progress: ModelDownloadProgress) {
    let _ = app.emit(MODEL_DOWNLOAD_PROGRESS_EVENT, progress);
}

fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    total
        .filter(|value| *value > 0)
        .map(|value| ((downloaded.saturating_mul(100) / value).min(100)) as u8)
}

fn model_download_retry_delay(failed_attempt: usize) -> Option<Duration> {
    MODEL_DOWNLOAD_RETRY_DELAYS_MS
        .get(failed_attempt.saturating_sub(1))
        .copied()
        .map(Duration::from_millis)
}

fn model_download_progress(
    model: &str,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) -> ModelDownloadProgress {
    ModelDownloadProgress {
        model: model.to_string(),
        status: status.to_string(),
        downloaded_bytes,
        total_bytes,
        percent: progress_percent(downloaded_bytes, total_bytes),
        message: None,
    }
}

pub fn emit_model_download_progress_message(
    app: &AppHandle,
    model: &str,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: &str,
) {
    let mut progress = model_download_progress(model, status, downloaded_bytes, total_bytes);
    progress.message = Some(message.to_string());
    emit_download_progress(app, progress);
}

pub async fn download_model_with_progress(
    app: &AppHandle,
    _client: &reqwest::Client,
    custom_dir: Option<&str>,
    model: &str,
) -> Result<String, String> {
    let info = local_model_info(model).ok_or_else(|| {
        format!(
            "Модель «{}» не поддерживается встроенным Whisper runtime.",
            model
        )
    })?;
    crate::download_cancel::clear(model);
    crate::download_cancel::clear(info.id);
    let models_dir = resolve_models_dir(app, custom_dir)?;
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|err| format!("Не удалось подготовить директорию моделей: {}", err))?;

    let model_path = models_dir.join(info.file_name);
    let marker_path = local_model_marker_path(&models_dir, info);
    let temp_path = model_path.with_extension("download");
    if model_path.is_file() {
        emit_download_progress(
            app,
            model_download_progress(model, "downloaded", 1, Some(1)),
        );
        write_model_marker(&marker_path, info)?;
        return Ok(info.id.to_string());
    }

    emit_download_progress(app, model_download_progress(model, "starting", 0, None));
    let download_client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut attempt = 1usize;
    let response = loop {
        if crate::download_cancel::is_any_cancel_requested(&[model, info.id]) {
            let _ = tokio::fs::remove_file(&temp_path).await;
            crate::download_cancel::clear(model);
            crate::download_cancel::clear(info.id);
            emit_download_progress(app, model_download_progress(model, "cancelled", 0, None));
            return Err(crate::download_cancel::CANCELLED_MESSAGE.to_string());
        }

        match download_client.get(info.url).send().await {
            Ok(response) => break response,
            Err(err) => {
                let Some(delay) = model_download_retry_delay(attempt) else {
                    return Err(format!(
                        "Не удалось скачать модель «{}» после {} попыток: {}",
                        info.id, attempt, err
                    ));
                };
                let next_attempt = attempt + 1;
                logger::log_info(
                    "LOCAL_STT",
                    &format!(
                        "Retrying model download after transport error: model={}, attempt={}/{}, delay_ms={}, error={}",
                        info.id,
                        next_attempt,
                        MODEL_DOWNLOAD_MAX_ATTEMPTS,
                        delay.as_millis(),
                        err
                    ),
                );
                emit_model_download_progress_message(
                    app,
                    model,
                    "preparing",
                    0,
                    None,
                    &format!(
                        "Не удалось подключиться. Повторяем скачивание ({}/{}).",
                        next_attempt, MODEL_DOWNLOAD_MAX_ATTEMPTS
                    ),
                );
                tokio::time::sleep(delay).await;
                attempt = next_attempt;
            }
        }
    };
    let mut response = response
        .error_for_status()
        .map_err(|err| format!("Скачивание модели «{}» вернуло ошибку: {}", info.id, err))?;
    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0u64;
    let mut last_percent: Option<u8> = None;
    let mut last_emitted_bytes = 0u64;

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|err| format!("Не удалось сохранить модель «{}»: {}", info.id, err))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("Не удалось прочитать модель «{}»: {}", info.id, err))?
    {
        if crate::download_cancel::is_any_cancel_requested(&[model, info.id]) {
            drop(file);
            let _ = tokio::fs::remove_file(&temp_path).await;
            crate::download_cancel::clear(model);
            crate::download_cancel::clear(info.id);
            emit_download_progress(
                app,
                model_download_progress(model, "cancelled", downloaded_bytes, total_bytes),
            );
            return Err(crate::download_cancel::CANCELLED_MESSAGE.to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|err| format!("Не удалось записать модель «{}»: {}", info.id, err))?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        let percent = progress_percent(downloaded_bytes, total_bytes);
        let byte_delta = downloaded_bytes.saturating_sub(last_emitted_bytes);

        if percent != last_percent || byte_delta >= 8 * 1024 * 1024 {
            emit_download_progress(
                app,
                model_download_progress(model, "downloading", downloaded_bytes, total_bytes),
            );
            last_percent = percent;
            last_emitted_bytes = downloaded_bytes;
        }
    }

    file.flush()
        .await
        .map_err(|err| format!("Не удалось завершить запись модели «{}»: {}", info.id, err))?;
    drop(file);

    tokio::fs::rename(&temp_path, &model_path)
        .await
        .map_err(|err| format!("Не удалось установить модель «{}»: {}", info.id, err))?;
    write_model_marker(&marker_path, info)?;
    emit_download_progress(
        app,
        model_download_progress(model, "downloaded", downloaded_bytes, total_bytes),
    );

    Ok(info.id.to_string())
}

fn write_model_marker(path: &Path, model: &LocalModelInfo) -> Result<(), String> {
    let marker = serde_json::json!({
        "id": model.id,
        "file": model.file_name,
        "engine": "transcribe.cpp"
    });
    fs::write(path, marker.to_string()).map_err(|err| {
        format!(
            "Не удалось сохранить состояние модели «{}»: {}",
            model.id, err
        )
    })
}

fn local_model_marker_path(models_dir: &Path, model: &LocalModelInfo) -> PathBuf {
    models_dir.join(format!("{}.json", safe_marker_file_stem(model.id)))
}

fn safe_marker_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

pub fn delete_downloaded_model(
    app: &AppHandle,
    custom_dir: Option<&str>,
    model: &str,
) -> Result<(), String> {
    let info = local_model_info(model).ok_or_else(|| {
        format!(
            "Модель «{}» не поддерживается встроенным Whisper runtime.",
            model
        )
    })?;
    let models_dir = resolve_models_dir(app, custom_dir)?;
    let model_path = models_dir.join(info.file_name);
    let marker_path = local_model_marker_path(&models_dir, info);
    let temp_path = model_path.with_extension("download");

    for path in [&model_path, &marker_path, &temp_path] {
        if path.is_file() {
            fs::remove_file(path)
                .map_err(|err| format!("Не удалось удалить {}: {}", path.display(), err))?;
        }
    }

    Ok(())
}

pub fn installed_model_ids(
    app: &AppHandle,
    custom_dir: Option<&str>,
) -> Result<Vec<String>, String> {
    let models_dir = resolve_models_dir(app, custom_dir)?;
    let mut models = LOCAL_WHISPER_MODELS
        .iter()
        .filter(|model| models_dir.join(model.file_name).is_file())
        .map(|model| model.id.to_string())
        .collect::<Vec<_>>();

    if diarization_model_is_installed_in_dir(&models_dir) {
        models.push(LOCAL_DIARIZATION_MODEL_ID.to_string());
    }

    models.sort();
    models.dedup();
    Ok(models)
}

fn installed_model_ids_for_runtime(kind: LocalRuntimeKind, models_dir: &Path) -> Vec<String> {
    let mut models = match kind {
        LocalRuntimeKind::Whisper => LOCAL_WHISPER_MODELS
            .iter()
            .filter(|model| models_dir.join(model.file_name).is_file())
            .map(|model| model.id.to_string())
            .collect::<Vec<_>>(),
        LocalRuntimeKind::Diarization => {
            if diarization_model_is_installed_in_dir(models_dir) {
                vec![LOCAL_DIARIZATION_MODEL_ID.to_string()]
            } else {
                Vec::new()
            }
        }
    };

    models.sort();
    models.dedup();
    models
}

fn diarization_model_is_installed_in_dir(models_dir: &Path) -> bool {
    let model_dir = models_dir.join(LOCAL_DIARIZATION_MODEL_ID);
    model_dir
        .join("pyannote-segmentation-3.0.int8.onnx")
        .is_file()
        && model_dir.join("nemo_en_titanet_small.onnx").is_file()
}

pub fn resolve_installed_model_for_runtime(
    app: &AppHandle,
    kind: LocalRuntimeKind,
    custom_dir: Option<&str>,
    requested: &str,
) -> Result<Option<String>, String> {
    let models_dir = resolve_models_dir(app, custom_dir)?;

    match kind {
        LocalRuntimeKind::Whisper => Ok(resolve_installed_whisper_model(requested, |model| {
            models_dir.join(model.file_name).is_file()
        })),
        LocalRuntimeKind::Diarization => {
            if requested.eq_ignore_ascii_case(LOCAL_DIARIZATION_MODEL_ID)
                && diarization_model_is_installed_in_dir(&models_dir)
            {
                Ok(Some(LOCAL_DIARIZATION_MODEL_ID.to_string()))
            } else {
                Ok(None)
            }
        }
    }
}

fn resolve_installed_whisper_model(
    requested: &str,
    mut is_installed: impl FnMut(&LocalModelInfo) -> bool,
) -> Option<String> {
    if let Some(model) = local_model_info(requested) {
        if is_installed(model) {
            return Some(model.id.to_string());
        }
    }

    for model_id in [
        "whisper-medium",
        "whisper-base",
        "whisper-small",
        "whisper-large-v3-turbo",
        "whisper-large-v3",
        "whisper-tiny",
    ] {
        if let Some(model) = local_model_info(model_id) {
            if is_installed(model) {
                return Some(model.id.to_string());
            }
        }
    }

    LOCAL_WHISPER_MODELS
        .iter()
        .find(|model| is_installed(model))
        .map(|model| model.id.to_string())
}

fn runtime_executable_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join(WHISPER_RUNTIME_NAME))
}

fn runtime_manifest_url() -> String {
    std::env::var("TALKIS_STT_RUNTIME_MANIFEST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_RUNTIME_MANIFEST_URL.to_string())
}

fn platform_asset(manifest: &RuntimeManifest) -> Option<&RuntimeAsset> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => manifest.macos_aarch64.as_ref(),
        ("macos", "x86_64") => manifest.macos_x86_64.as_ref(),
        _ => None,
    }
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = hex::encode(Sha256::digest(bytes));
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err("Загруженный локальный STT runtime не прошел проверку целостности.".to_string())
    }
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|err| format!("Не удалось прочитать права runtime: {}", err))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|err| format!("Не удалось сделать runtime исполняемым: {}", err))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn download_runtime(app: &AppHandle, client: &reqwest::Client) -> Result<PathBuf, String> {
    let manifest_url = runtime_manifest_url();
    logger::log_info(
        "LOCAL_STT",
        &format!("Downloading local STT runtime manifest: {}", manifest_url),
    );

    let manifest = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|err| {
            format!(
                "Не удалось скачать manifest локального STT runtime: {}",
                err
            )
        })?
        .error_for_status()
        .map_err(|err| format!("Manifest локального STT runtime вернул ошибку: {}", err))?
        .json::<RuntimeManifest>()
        .await
        .map_err(|err| format!("Manifest локального STT runtime некорректен: {}", err))?;

    let asset = platform_asset(&manifest).ok_or_else(|| {
        format!(
            "Для этой платформы нет локального STT runtime: {}-{}.",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;

    logger::log_info(
        "LOCAL_STT",
        &format!(
            "Downloading local STT runtime version {}: {}",
            manifest.version, asset.url
        ),
    );

    let bytes = client
        .get(&asset.url)
        .send()
        .await
        .map_err(|err| format!("Не удалось скачать локальный STT runtime: {}", err))?
        .error_for_status()
        .map_err(|err| format!("Скачивание локального STT runtime вернуло ошибку: {}", err))?
        .bytes()
        .await
        .map_err(|err| format!("Не удалось прочитать локальный STT runtime: {}", err))?;

    verify_sha256(&bytes, &asset.sha256)?;

    let dir = runtime_dir(app)?;
    fs::create_dir_all(&dir).map_err(|err| {
        format!(
            "Не удалось подготовить папку локального STT runtime: {}",
            err
        )
    })?;

    let executable_path = runtime_executable_path(app)?;
    let temp_path = executable_path.with_extension("download");
    fs::write(&temp_path, &bytes)
        .map_err(|err| format!("Не удалось сохранить локальный STT runtime: {}", err))?;
    make_executable(&temp_path)?;
    fs::rename(&temp_path, &executable_path)
        .map_err(|err| format!("Не удалось установить локальный STT runtime: {}", err))?;

    Ok(executable_path)
}

fn is_expected_runtime_health(health: &HealthResponse, kind: LocalRuntimeKind) -> bool {
    let identity_matches = health
        .status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("ok"))
        .unwrap_or(false)
        && health
            .runtime
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(kind.runtime_name()))
            .unwrap_or(false)
        && health
            .engine
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(kind.engine_name()))
            .unwrap_or(false);

    identity_matches
        && (kind != LocalRuntimeKind::Whisper
            || health.api_version.unwrap_or_default() >= WHISPER_RUNTIME_API_VERSION)
}

fn is_stale_managed_runtime_health(health: &HealthResponse, kind: LocalRuntimeKind) -> bool {
    health
        .runtime
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case(kind.runtime_name()))
        .unwrap_or(false)
        && !is_expected_runtime_health(health, kind)
}

async fn whisper_runtime_supports_streaming_endpoints(
    client: &reqwest::Client,
    base_url: &str,
) -> bool {
    for path in [
        "/v1/audio/transcriptions/stream",
        "/v1/audio/transcriptions/live",
    ] {
        let url = format!("{}{}", base_url.trim_end_matches('/'), path);
        let available = client
            .request(reqwest::Method::OPTIONS, &url)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false);
        if !available {
            return false;
        }
    }

    true
}

async fn probe_local_stt(
    client: &reqwest::Client,
    kind: LocalRuntimeKind,
    base_url: &str,
    models_url: &str,
) -> LocalSttProbe {
    let health_url = format!("{}/health", base_url.trim_end_matches('/'));
    if let Ok(response) = client
        .get(&health_url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(text) = response.text().await {
                if let Ok(health) = serde_json::from_str::<HealthResponse>(&text) {
                    if is_expected_runtime_health(&health, kind) {
                        if kind == LocalRuntimeKind::Whisper
                            && !whisper_runtime_supports_streaming_endpoints(client, base_url).await
                        {
                            logger::log_info(
                                "LOCAL_STT",
                                "Detected stale managed Whisper runtime: missing streaming/live endpoint",
                            );
                            return LocalSttProbe::StaleManagedRuntime;
                        }

                        return LocalSttProbe::Ready;
                    }

                    if is_stale_managed_runtime_health(&health, kind) {
                        logger::log_info(
                            "LOCAL_STT",
                            &format!("Detected stale managed runtime: engine={:?}", health.engine),
                        );
                        return LocalSttProbe::StaleManagedRuntime;
                    }
                }
            }
        }
    }

    if client
        .get(models_url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
    {
        LocalSttProbe::Ready
    } else {
        LocalSttProbe::Unavailable
    }
}

async fn local_stt_is_ready(
    client: &reqwest::Client,
    kind: LocalRuntimeKind,
    base_url: &str,
    models_url: &str,
) -> bool {
    matches!(
        probe_local_stt(client, kind, base_url, models_url).await,
        LocalSttProbe::Ready
    )
}

async fn runtime_models_match_disk(
    client: &reqwest::Client,
    kind: LocalRuntimeKind,
    models_url: &str,
    models_dir: &Path,
) -> bool {
    let expected_models = installed_model_ids_for_runtime(kind, models_dir);
    if expected_models.is_empty() {
        return true;
    }

    let Ok(response) = client
        .get(models_url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    else {
        return true;
    };

    if !response.status().is_success() {
        return true;
    }

    let Ok(text) = response.text().await else {
        return true;
    };

    let Ok(parsed) = serde_json::from_str::<ModelsResponse>(&text) else {
        return true;
    };

    let runtime_models = parsed
        .data
        .into_iter()
        .map(|model| model.id)
        .collect::<std::collections::HashSet<_>>();
    let missing_models = expected_models
        .iter()
        .filter(|model| !runtime_models.contains(*model))
        .cloned()
        .collect::<Vec<_>>();

    if missing_models.is_empty() {
        true
    } else {
        logger::log_info(
            "LOCAL_STT",
            &format!(
                "Detected stale managed {} runtime: installed model(s) missing from endpoint: {}",
                kind.label(),
                missing_models.join(", ")
            ),
        );
        false
    }
}

#[cfg(unix)]
fn command_has_port_argument(command: &str, port: u16) -> bool {
    let port = port.to_string();
    let mut parts = command.split_whitespace();
    while let Some(part) = parts.next() {
        if part == "--port" && parts.next().is_some_and(|value| value == port.as_str()) {
            return true;
        }
    }
    false
}

#[cfg(unix)]
fn stop_stale_managed_runtime(kind: LocalRuntimeKind, port: u16) -> Result<(), String> {
    let output = StdCommand::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output()
        .map_err(|err| format!("Не удалось проверить старый локальный runtime: {}", err))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut killed = 0usize;

    for line in text.lines() {
        let trimmed = line.trim_start();
        let Some((pid_text, command)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };

        if !command.contains(kind.runtime_name()) || !command_has_port_argument(command, port) {
            continue;
        }

        let Some(pid) = pid_text.parse::<u32>().ok() else {
            continue;
        };

        let status = StdCommand::new("kill")
            .arg(pid.to_string())
            .status()
            .map_err(|err| format!("Не удалось остановить старый локальный runtime: {}", err))?;
        if status.success() {
            killed += 1;
        }
    }

    if killed > 0 {
        logger::log_info(
            "LOCAL_STT",
            &format!("Stopped {} stale managed runtime process(es)", killed),
        );
        Ok(())
    } else {
        Err("Не найден процесс старого локального runtime для остановки.".to_string())
    }
}

#[cfg(windows)]
fn stop_stale_managed_runtime(kind: LocalRuntimeKind, _port: u16) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let image_name = format!("{}.exe", kind.runtime_name());
    let output = StdCommand::new("taskkill")
        .args(["/F", "/T", "/IM", &image_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| {
            format!("Не удалось проверить старый локальный runtime {image_name}: {err}")
        })?;

    if output.status.success() {
        logger::log_info(
            "LOCAL_STT",
            &format!("Stopped stale Windows managed runtime: {image_name}"),
        );
        Ok(())
    } else {
        Err(format!(
            "Не найден процесс старого локального runtime {image_name} для остановки."
        ))
    }
}

#[cfg(not(any(unix, windows)))]
fn stop_stale_managed_runtime(_kind: LocalRuntimeKind, _port: u16) -> Result<(), String> {
    Err(
        "Автоматическая остановка старого локального runtime недоступна на этой платформе."
            .to_string(),
    )
}

pub fn stop_managed_runtime(kind: LocalRuntimeKind, port: u16) -> Result<(), String> {
    forget_runtime_endpoint(kind);
    stop_stale_managed_runtime(kind, port)
}

async fn wait_for_local_stt(
    client: &reqwest::Client,
    kind: LocalRuntimeKind,
    base_url: &str,
    models_url: &str,
    timeout: Duration,
) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if local_stt_is_ready(client, kind, base_url, models_url).await {
            logger::log_info(
                "LOCAL_STT",
                &format!(
                    "Managed local {} STT runtime ready at {} in {}ms",
                    kind.label(),
                    base_url,
                    started.elapsed().as_millis()
                ),
            );
            return true;
        }
        tokio::time::sleep(Duration::from_millis(RUNTIME_READINESS_POLL_INTERVAL_MS)).await;
    }
    logger::log_error(
        "LOCAL_STT",
        &format!(
            "Managed local {} STT runtime readiness timed out at {} after {}ms",
            kind.label(),
            base_url,
            started.elapsed().as_millis()
        ),
    );
    false
}

async fn start_bundled_runtime(
    app: &AppHandle,
    kind: LocalRuntimeKind,
    port: u16,
    models_dir: &Path,
) -> Result<(), String> {
    let data_dir = runtime_dir(app)?;
    let command = app
        .shell()
        .sidecar(kind.runtime_name())
        .map_err(|err| format!("Встроенный локальный STT runtime недоступен: {}", err))?;

    let (events, child) = command
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--data-dir",
            &data_dir.to_string_lossy(),
            "--models-dir",
            &models_dir.to_string_lossy(),
        ])
        .spawn()
        .map_err(|err| {
            format!(
                "Не удалось запустить встроенный локальный STT runtime: {}",
                err
            )
        })?;
    let pid = child.pid();
    logger::log_info(
        "LOCAL_STT",
        &format!(
            "Spawned bundled {} runtime: pid={}, port={}",
            kind.label(),
            pid,
            port
        ),
    );
    drain_bundled_runtime_events(events, kind, pid);
    Ok(())
}

fn drain_bundled_runtime_events(
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    kind: LocalRuntimeKind,
    pid: u32,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let output = String::from_utf8_lossy(&bytes);
                    for line in output
                        .lines()
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                    {
                        let message = format!("{} runtime stderr: {}", kind.label(), line);
                        let normalized = line.to_ascii_lowercase();
                        if normalized.contains("error")
                            || normalized.contains("failed")
                            || normalized.contains("panic")
                        {
                            logger::log_error("LOCAL_STT", &message);
                        } else {
                            logger::log_info("LOCAL_STT", &message);
                        }
                    }
                }
                CommandEvent::Stdout(bytes) => {
                    let output = String::from_utf8_lossy(&bytes);
                    for line in output
                        .lines()
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                    {
                        logger::log_info(
                            "LOCAL_STT",
                            &format!("{} runtime stdout: {}", kind.label(), line),
                        );
                    }
                }
                CommandEvent::Error(error) => {
                    logger::log_error(
                        "LOCAL_STT",
                        &format!("{} runtime event error: {}", kind.label(), error),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    logger::log_error(
                        "LOCAL_STT",
                        &format!(
                            "{} runtime terminated: pid={} code={:?} signal={:?}",
                            kind.label(),
                            pid,
                            payload.code,
                            payload.signal
                        ),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
}

async fn start_downloaded_runtime(
    app: &AppHandle,
    client: &reqwest::Client,
    port: u16,
    models_dir: &Path,
) -> Result<(), String> {
    let data_dir = runtime_dir(app)?;
    let executable_path = match runtime_executable_path(app) {
        Ok(path) if path.is_file() => path,
        Ok(_) => download_runtime(app, client).await?,
        Err(err) => return Err(err),
    };

    TokioCommand::new(&executable_path)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--data-dir",
            &data_dir.to_string_lossy(),
            "--models-dir",
            &models_dir.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| {
            format!(
                "Не удалось запустить локальный STT runtime {}: {}",
                executable_path.display(),
                err
            )
        })
}

pub async fn ensure_runtime(
    app: &AppHandle,
    client: &reqwest::Client,
    models_url: &str,
    custom_models_dir: Option<&str>,
) -> Result<String, String> {
    let _start_guard = managed_runtime_start_lock().lock().await;
    let kind = managed_runtime_kind(models_url).ok_or_else(|| {
        "Автоматический запуск локального runtime поддержан только для портов Talkis 8000/8003."
            .to_string()
    })?;
    let runtime_client = local_runtime_http_client();

    let base_url = resolve_stt_base_url_from_models_url(models_url);
    let preferred_port = requested_port(&base_url, kind);
    let models_dir = resolve_models_dir(app, custom_models_dir)?;

    if let Some(runtime_base_url) = remembered_runtime_endpoint(kind) {
        let runtime_models_url = managed_models_url(&runtime_base_url);
        if local_stt_is_ready(runtime_client, kind, &runtime_base_url, &runtime_models_url).await
            && runtime_models_match_disk(runtime_client, kind, &runtime_models_url, &models_dir)
                .await
        {
            logger::log_info(
                "LOCAL_STT",
                &format!(
                    "Reusing managed local {} STT runtime at {}",
                    kind.label(),
                    runtime_base_url
                ),
            );
            return Ok(runtime_base_url);
        }

        forget_runtime_endpoint(kind);
        if let Some(port) = url::Url::parse(&runtime_base_url)
            .ok()
            .and_then(|url| url.port())
        {
            if let Err(err) = stop_stale_managed_runtime(kind, port) {
                logger::log_error("LOCAL_STT", &err);
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
    }

    match probe_local_stt(runtime_client, kind, &base_url, models_url).await {
        LocalSttProbe::Ready => {
            if runtime_models_match_disk(runtime_client, kind, models_url, &models_dir).await {
                remember_runtime_endpoint(kind, base_url.clone());
                return Ok(base_url);
            }

            if let Err(err) = stop_stale_managed_runtime(kind, preferred_port) {
                logger::log_error("LOCAL_STT", &err);
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        LocalSttProbe::StaleManagedRuntime => {
            if let Err(err) = stop_stale_managed_runtime(kind, preferred_port) {
                logger::log_error("LOCAL_STT", &err);
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        LocalSttProbe::Unavailable => {}
    }

    logger::log_info(
        "LOCAL_STT",
        &format!("Starting managed local {} STT runtime", kind.label()),
    );
    fs::create_dir_all(&models_dir)
        .map_err(|err| format!("Не удалось подготовить папку локальных моделей: {}", err))?;
    let runtime_port = find_available_runtime_port(kind, preferred_port)?;
    let runtime_base_url = managed_base_url(runtime_port);
    let runtime_models_url = managed_models_url(&runtime_base_url);
    if runtime_port != preferred_port {
        logger::log_info(
            "LOCAL_STT",
            &format!(
                "Port {} is unavailable for {}; using {}",
                preferred_port,
                kind.label(),
                runtime_port
            ),
        );
    }

    if let Err(err) = start_bundled_runtime(app, kind, runtime_port, &models_dir).await {
        logger::log_info(
            "LOCAL_STT",
            &format!("Bundled local STT runtime unavailable: {}", err),
        );
        if kind == LocalRuntimeKind::Whisper {
            start_downloaded_runtime(app, client, runtime_port, &models_dir).await?;
        } else {
            return Err(format!(
                "Встроенный {} runtime пока не подключен в сборку Talkis.",
                kind.label()
            ));
        }
    }

    if wait_for_local_stt(
        runtime_client,
        kind,
        &runtime_base_url,
        &runtime_models_url,
        Duration::from_secs(RUNTIME_START_TIMEOUT_SECS),
    )
    .await
    {
        remember_runtime_endpoint(kind, runtime_base_url.clone());
        Ok(runtime_base_url)
    } else {
        forget_runtime_endpoint(kind);
        if let Err(err) = stop_stale_managed_runtime(kind, runtime_port) {
            logger::log_error(
                "LOCAL_STT",
                &format!("Failed to stop runtime after readiness timeout: {err}"),
            );
        }
        Err("Локальный STT runtime запущен, но не успел стать доступным. Повторите установку модели через минуту.".to_string())
    }
}

#[tauri::command]
pub fn get_local_stt_default_models_dir(app: AppHandle) -> Result<String, String> {
    default_models_dir(&app).map(|path| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_path_sanitizes_model_ids_with_slashes() {
        let models_dir = PathBuf::from("/tmp/talkis-models");
        let model = local_model_info("nvidia/nemotron-3.5-asr-streaming-0.6b").expect("model");

        assert_eq!(
            local_model_marker_path(&models_dir, model),
            models_dir.join("nvidia_nemotron-3.5-asr-streaming-0.6b.json")
        );
    }

    #[test]
    fn whisper_runtime_health_requires_current_live_api_version() {
        let stale = HealthResponse {
            status: Some("ok".to_string()),
            runtime: Some("talkis-stt".to_string()),
            engine: Some("transcribe.cpp".to_string()),
            api_version: None,
        };
        let current = HealthResponse {
            status: Some("ok".to_string()),
            runtime: Some("talkis-stt".to_string()),
            engine: Some("transcribe.cpp".to_string()),
            api_version: Some(WHISPER_RUNTIME_API_VERSION),
        };
        let previous = HealthResponse {
            status: Some("ok".to_string()),
            runtime: Some("talkis-stt".to_string()),
            engine: Some("transcribe.cpp".to_string()),
            api_version: Some(WHISPER_RUNTIME_API_VERSION - 1),
        };

        assert!(!is_expected_runtime_health(
            &stale,
            LocalRuntimeKind::Whisper,
        ));
        assert!(!is_expected_runtime_health(
            &previous,
            LocalRuntimeKind::Whisper,
        ));
        assert!(is_expected_runtime_health(
            &current,
            LocalRuntimeKind::Whisper,
        ));
    }

    #[cfg(unix)]
    #[test]
    fn stale_runtime_match_requires_the_exact_port_argument() {
        let command = "/Applications/Talkis Dev.app/talkis-stt --host 127.0.0.1 --port 18000";
        assert!(command_has_port_argument(command, 18000));
        assert!(!command_has_port_argument(command, 8000));
    }

    #[test]
    fn new_streaming_models_resolve_aliases_and_marker_paths() {
        let models_dir = PathBuf::from("/tmp/talkis-models");
        let cases = [
            (
                "nemotron-35-asr-streaming-06b",
                "nvidia/nemotron-3.5-asr-streaming-0.6b",
                "nvidia_nemotron-3.5-asr-streaming-0.6b.json",
            ),
            (
                "nemotron-speech-streaming-en-06b",
                "nvidia/nemotron-speech-streaming-en-0.6b",
                "nvidia_nemotron-speech-streaming-en-0.6b.json",
            ),
            (
                "moonshine-streaming-tiny-q8_0.gguf",
                "moonshine-streaming-tiny",
                "moonshine-streaming-tiny.json",
            ),
            (
                "moonshine-streaming-small-q8_0.gguf",
                "moonshine-streaming-small",
                "moonshine-streaming-small.json",
            ),
        ];

        for (requested, expected_id, expected_marker) in cases {
            let model = local_model_info(requested).expect("model");
            assert_eq!(model.id, expected_id);
            assert_eq!(
                local_model_marker_path(&models_dir, model),
                models_dir.join(expected_marker)
            );
        }
    }

    #[test]
    fn stale_api_model_falls_back_to_an_installed_streaming_model() {
        let selected = resolve_installed_whisper_model("gpt-4o-transcribe", |model| {
            model.id == "nvidia/nemotron-3.5-asr-streaming-0.6b"
        });

        assert_eq!(
            selected.as_deref(),
            Some("nvidia/nemotron-3.5-asr-streaming-0.6b")
        );
    }

    #[test]
    fn gigaam_resolves_base_model_and_gguf_aliases() {
        let models_dir = PathBuf::from("/tmp/talkis-models");
        let model = local_model_info("ai-sage/GigaAM-v3").expect("model");

        assert_eq!(model.id, "ai-sage/GigaAM-v3");
        assert_eq!(model.file_name, "gigaam-v3-e2e-rnnt-Q4_K_M.gguf");
        assert_eq!(
            local_model_info("gigaam-v3-e2e-rnnt-Q4_K_M.gguf")
                .expect("gguf alias")
                .id,
            model.id
        );
        assert_eq!(
            local_model_marker_path(&models_dir, model),
            models_dir.join("ai-sage_GigaAM-v3.json")
        );
    }

    #[test]
    fn model_download_retries_use_bounded_backoff() {
        assert_eq!(
            model_download_retry_delay(1),
            Some(Duration::from_millis(750))
        );
        assert_eq!(
            model_download_retry_delay(2),
            Some(Duration::from_millis(1_500))
        );
        assert_eq!(model_download_retry_delay(3), None);
    }
}
