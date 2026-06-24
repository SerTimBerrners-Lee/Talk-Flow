use crate::logger;
use serde::Serialize;
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;

/// Name of the bundled `llama-server` sidecar (prepared by prepare-llm-sidecar.mjs).
const LLM_RUNTIME_NAME: &str = "talkis-llm";
const LLM_DEFAULT_PORT: u16 = 8011;
const LLM_CONTEXT_SIZE: u32 = 8192;
pub const LLM_DOWNLOAD_PROGRESS_EVENT: &str = "local-llm-model-download-progress";

#[derive(Clone, Copy)]
struct LlmModelInfo {
    id: &'static str,
    file_name: &'static str,
    url: &'static str,
    label: &'static str,
    size_label: &'static str,
    min_ram_gb: u32,
}

/// Built-in catalog of local text models (GGUF for llama.cpp). Qwen2.5 chosen
/// for strong Russian support. URLs may need refreshing if HF layout changes.
static LLM_CATALOG: &[LlmModelInfo] = &[
    LlmModelInfo {
        id: "qwen2.5-3b-instruct-q4",
        file_name: "qwen2.5-3b-instruct-q4_k_m.gguf",
        url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
        label: "Qwen2.5 3B Instruct",
        size_label: "2.0 ГБ",
        min_ram_gb: 8,
    },
    LlmModelInfo {
        id: "qwen2.5-7b-instruct-q4",
        file_name: "qwen2.5-7b-instruct-q4_k_m.gguf",
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf",
        label: "Qwen2.5 7B Instruct",
        size_label: "4.7 ГБ",
        min_ram_gb: 16,
    },
];

fn model_info(id: &str) -> Option<&'static LlmModelInfo> {
    let normalized = id.trim();
    LLM_CATALOG.iter().find(|model| model.id == normalized)
}

struct RunningLlm {
    child: CommandChild,
    port: u16,
    model_id: String,
}

fn runtime_state() -> &'static Mutex<Option<RunningLlm>> {
    static STATE: OnceLock<Mutex<Option<RunningLlm>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn llm_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
        .map(|dir| dir.join("local-llm"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(llm_dir(app)?.join("models"))
}

fn model_path(app: &AppHandle, info: &LlmModelInfo) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(info.file_name))
}

fn is_downloaded(app: &AppHandle, info: &LlmModelInfo) -> bool {
    model_path(app, info).map(|path| path.is_file()).unwrap_or(false)
}

fn port_is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_port() -> u16 {
    if port_is_available(LLM_DEFAULT_PORT) {
        return LLM_DEFAULT_PORT;
    }
    for port in 18200u16..18250 {
        if port_is_available(port) {
            return port;
        }
    }
    LLM_DEFAULT_PORT
}

/// OpenAI-compatible base URL llama-server exposes (so `/chat/completions` is appended).
fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{}/v1", port)
}

#[derive(Serialize, Clone)]
pub struct LlmDownloadProgress {
    model_id: String,
    status: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<u8>,
}

fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    total
        .filter(|value| *value > 0)
        .map(|value| ((downloaded.min(value) as f64 / value as f64) * 100.0).round() as u8)
}

/// In-flight download progress kept on the backend so the UI can restore it after
/// remounting (tab switch, window close), not just from live events.
fn download_registry() -> &'static Mutex<HashMap<String, LlmDownloadProgress>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, LlmDownloadProgress>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn emit_progress(app: &AppHandle, payload: LlmDownloadProgress) {
    {
        let mut registry = download_registry()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if matches!(payload.status.as_str(), "downloaded" | "cancelled" | "error") {
            registry.remove(&payload.model_id);
        } else {
            registry.insert(payload.model_id.clone(), payload.clone());
        }
    }
    let _ = app.emit(LLM_DOWNLOAD_PROGRESS_EVENT, payload);
}

/// Removes the registry entry on any exit from `download_model`, so an errored
/// download never leaves a stuck "downloading" entry behind.
struct DownloadGuard(String);

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        download_registry()
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .remove(&self.0);
    }
}

#[tauri::command]
pub fn get_llm_download_progress() -> Vec<LlmDownloadProgress> {
    download_registry()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .values()
        .cloned()
        .collect()
}

pub async fn download_model(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let info = model_info(model_id)
        .ok_or_else(|| format!("Неизвестная локальная модель «{}»", model_id))?;
    crate::download_cancel::clear(info.id);
    let _guard = DownloadGuard(info.id.to_string());
    let dir = models_dir(app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| format!("Не удалось подготовить папку моделей: {}", err))?;

    let target = dir.join(info.file_name);
    if target.is_file() {
        emit_progress(
            app,
            LlmDownloadProgress {
                model_id: info.id.to_string(),
                status: "downloaded".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100),
            },
        );
        return Ok(());
    }

    let temp = target.with_extension("download");
    emit_progress(
        app,
        LlmDownloadProgress {
            model_id: info.id.to_string(),
            status: "starting".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
        },
    );

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut response = client
        .get(info.url)
        .send()
        .await
        .map_err(|err| format!("Не удалось скачать «{}»: {}", info.id, err))?
        .error_for_status()
        .map_err(|err| format!("Скачивание «{}» вернуло ошибку: {}", info.id, err))?;
    let total = response.content_length();
    let mut downloaded = 0u64;
    let mut last_percent: Option<u8> = None;
    let mut last_emitted = 0u64;

    let mut file = tokio::fs::File::create(&temp)
        .await
        .map_err(|err| format!("Не удалось сохранить «{}»: {}", info.id, err))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("Не удалось прочитать «{}»: {}", info.id, err))?
    {
        if crate::download_cancel::is_cancel_requested(info.id) {
            drop(file);
            let _ = tokio::fs::remove_file(&temp).await;
            crate::download_cancel::clear(info.id);
            emit_progress(
                app,
                LlmDownloadProgress {
                    model_id: info.id.to_string(),
                    status: "cancelled".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    percent: None,
                },
            );
            return Err(crate::download_cancel::CANCELLED_MESSAGE.to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|err| format!("Не удалось записать «{}»: {}", info.id, err))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let percent = progress_percent(downloaded, total);

        if percent != last_percent || downloaded.saturating_sub(last_emitted) >= 8 * 1024 * 1024 {
            emit_progress(
                app,
                LlmDownloadProgress {
                    model_id: info.id.to_string(),
                    status: "downloading".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    percent,
                },
            );
            last_percent = percent;
            last_emitted = downloaded;
        }
    }

    file.flush()
        .await
        .map_err(|err| format!("Не удалось завершить «{}»: {}", info.id, err))?;
    drop(file);

    tokio::fs::rename(&temp, &target)
        .await
        .map_err(|err| format!("Не удалось установить «{}»: {}", info.id, err))?;
    emit_progress(
        app,
        LlmDownloadProgress {
            model_id: info.id.to_string(),
            status: "downloaded".to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent: Some(100),
        },
    );

    Ok(())
}

async fn health_ok(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    matches!(
        client.get(&url).timeout(Duration::from_secs(2)).send().await,
        Ok(response) if response.status().is_success()
    )
}

/// Ensure the bundled llama-server is running with the requested model and return
/// its OpenAI-compatible base URL (`http://127.0.0.1:<port>/v1`).
pub async fn ensure_runtime(app: &AppHandle, model_id: &str) -> Result<String, String> {
    let info = model_info(model_id)
        .ok_or_else(|| format!("Неизвестная локальная модель «{}»", model_id))?;
    let path = model_path(app, info)?;
    if !path.is_file() {
        return Err(format!("Модель «{}» ещё не скачана", info.label));
    }

    {
        let guard = runtime_state().lock().unwrap_or_else(|err| err.into_inner());
        if let Some(running) = guard.as_ref() {
            if running.model_id == info.id {
                return Ok(base_url(running.port));
            }
        }
    }

    stop_runtime();

    let port = find_port();
    let (_events, child) = app
        .shell()
        .sidecar(LLM_RUNTIME_NAME)
        .map_err(|err| format!("Встроенный LLM-рантайм недоступен: {}", err))?
        .args([
            "-m",
            &path.to_string_lossy(),
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-c",
            &LLM_CONTEXT_SIZE.to_string(),
            "--jinja",
        ])
        .spawn()
        .map_err(|err| format!("Не удалось запустить LLM-рантайм: {}", err))?;

    {
        let mut guard = runtime_state().lock().unwrap_or_else(|err| err.into_inner());
        *guard = Some(RunningLlm {
            child,
            port,
            model_id: info.id.to_string(),
        });
    }

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    for _ in 0..180 {
        if health_ok(&client, port).await {
            logger::log_info(
                "LOCAL_LLM",
                &format!("llama-server ready on port {} ({})", port, info.id),
            );
            return Ok(base_url(port));
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }

    stop_runtime();
    Err("Локальный LLM-рантайм не запустился (timeout)".to_string())
}

pub fn stop_runtime() {
    let mut guard = runtime_state().lock().unwrap_or_else(|err| err.into_inner());
    if let Some(running) = guard.take() {
        let _ = running.child.kill();
    }
}

#[derive(Serialize)]
pub struct LocalLlmModel {
    id: String,
    label: String,
    file_name: String,
    size_label: String,
    min_ram_gb: u32,
    downloaded: bool,
}

#[tauri::command]
pub fn list_local_llm_models(app: AppHandle) -> Vec<LocalLlmModel> {
    LLM_CATALOG
        .iter()
        .map(|model| LocalLlmModel {
            id: model.id.to_string(),
            label: model.label.to_string(),
            file_name: model.file_name.to_string(),
            size_label: model.size_label.to_string(),
            min_ram_gb: model.min_ram_gb,
            downloaded: is_downloaded(&app, model),
        })
        .collect()
}

#[tauri::command]
pub async fn download_local_llm_model(app: AppHandle, model_id: String) -> Result<(), String> {
    download_model(&app, &model_id).await
}

#[tauri::command]
pub fn delete_local_llm_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let info = model_info(&model_id)
        .ok_or_else(|| format!("Неизвестная локальная модель «{}»", model_id))?;

    let running_same = {
        let guard = runtime_state().lock().unwrap_or_else(|err| err.into_inner());
        guard
            .as_ref()
            .map(|running| running.model_id == info.id)
            .unwrap_or(false)
    };
    if running_same {
        stop_runtime();
    }

    let path = model_path(&app, info)?;
    if path.is_file() {
        std::fs::remove_file(&path)
            .map_err(|err| format!("Не удалось удалить модель: {}", err))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn start_local_llm(app: AppHandle, model_id: String) -> Result<String, String> {
    ensure_runtime(&app, &model_id).await
}

#[tauri::command]
pub fn stop_local_llm() {
    stop_runtime();
}

#[derive(Serialize)]
pub struct LocalLlmStatus {
    running: bool,
    model_id: Option<String>,
    base_url: Option<String>,
}

#[tauri::command]
pub fn get_local_llm_status() -> LocalLlmStatus {
    let guard = runtime_state().lock().unwrap_or_else(|err| err.into_inner());
    match guard.as_ref() {
        Some(running) => LocalLlmStatus {
            running: true,
            model_id: Some(running.model_id.clone()),
            base_url: Some(base_url(running.port)),
        },
        None => LocalLlmStatus {
            running: false,
            model_id: None,
            base_url: None,
        },
    }
}
