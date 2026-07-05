use crate::logger;
use serde::Serialize;
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
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
    description: &'static str,
    size_label: &'static str,
    min_ram_gb: u32,
    profile_label: &'static str,
    languages_label: &'static str,
    speed: &'static str,
    accuracy: &'static str,
    language_label: &'static str,
    avatar_family: &'static str,
    recommended: bool,
}

/// Built-in catalog of local text models (GGUF for llama.cpp). Qwen3 is the
/// default starter line; Qwen2.5 remains for users who already downloaded it.
static LLM_CATALOG: &[LlmModelInfo] = &[
    LlmModelInfo {
        id: "qwen3-1.7b-instruct-q4",
        file_name: "Qwen3-1.7B-Q4_K_M.gguf",
        url: "https://huggingface.co/lm-kit/qwen-3-1.7b-instruct-gguf/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
        label: "Qwen3 1.7B Instruct",
        description: "Быстрая модель для коротких саммари и правки текста. Рекомендуется по умолчанию.",
        size_label: "1.2 ГБ",
        min_ram_gb: 8,
        profile_label: "Быстрая",
        languages_label: "RU / EN / multi",
        speed: "очень быстро",
        accuracy: "средняя+",
        language_label: "119+",
        avatar_family: "qwen",
        recommended: true,
    },
    LlmModelInfo {
        id: "granite-3.3-2b-instruct-q4",
        file_name: "granite-3.3-2b-instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF/resolve/main/granite-3.3-2b-instruct-Q4_K_M.gguf",
        label: "Granite 3.3 2B Instruct",
        description: "Компактная Apache 2.0 модель IBM для быстрых локальных задач и аккуратных деловых саммари.",
        size_label: "1.5 ГБ",
        min_ram_gb: 8,
        profile_label: "Open / быстрая",
        languages_label: "EN / code / multi",
        speed: "очень быстро",
        accuracy: "средняя",
        language_label: "12",
        avatar_family: "granite",
        recommended: false,
    },
    LlmModelInfo {
        id: "smollm3-3b-q4",
        file_name: "HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/HuggingFaceTB_SmolLM3-3B-GGUF/resolve/main/HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf",
        label: "SmolLM3 3B",
        description: "Современная компактная Apache 2.0 модель Hugging Face: длинный контекст, reasoning, быстрый on-device режим.",
        size_label: "1.8 ГБ",
        min_ram_gb: 8,
        profile_label: "Open / reasoning",
        languages_label: "6 языков",
        speed: "быстро",
        accuracy: "средняя+",
        language_label: "6",
        avatar_family: "smollm",
        recommended: false,
    },
    LlmModelInfo {
        id: "qwen3-4b-instruct-q4",
        file_name: "Qwen3-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/lm-kit/qwen-3-4b-instruct-gguf/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        label: "Qwen3 4B Instruct",
        description: "Баланс скорости и качества для более аккуратных саммари на машинах с запасом памяти.",
        size_label: "2.5 ГБ",
        min_ram_gb: 12,
        profile_label: "Баланс качества",
        languages_label: "RU / EN / multi",
        speed: "быстро",
        accuracy: "высокая",
        language_label: "119+",
        avatar_family: "qwen",
        recommended: false,
    },
    LlmModelInfo {
        id: "phi-4-mini-instruct-q4",
        file_name: "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/llmware/phi-4-mini-gguf/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        label: "Phi-4 Mini Instruct",
        description: "Лёгкая reasoning-модель Microsoft: хороша для структурирования, инструкций и плотных коротких ответов.",
        size_label: "2.3 ГБ",
        min_ram_gb: 12,
        profile_label: "Reasoning",
        languages_label: "EN / multi",
        speed: "быстро",
        accuracy: "высокая",
        language_label: "EN / multi",
        avatar_family: "microsoft",
        recommended: false,
    },
    LlmModelInfo {
        id: "gemma-3-4b-it-q4",
        file_name: "google_gemma-3-4b-it-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf",
        label: "Gemma 3 4B IT",
        description: "Современная instruction-модель Google с сильной мультиязычностью и хорошим качеством саммари.",
        size_label: "2.3 ГБ",
        min_ram_gb: 12,
        profile_label: "Качество",
        languages_label: "RU / EN / multi",
        speed: "быстро",
        accuracy: "высокая",
        language_label: "140+",
        avatar_family: "gemma",
        recommended: false,
    },
    LlmModelInfo {
        id: "qwen3-8b-instruct-q4",
        file_name: "Qwen3-8B-Q4_K_M.gguf",
        url: "https://huggingface.co/lm-kit/qwen-3-8b-instruct-gguf/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        label: "Qwen3 8B Instruct",
        description: "Качественная модель для сложных и длинных текстов. Тяжелее по загрузке и памяти.",
        size_label: "4.7 ГБ",
        min_ram_gb: 16,
        profile_label: "Качество",
        languages_label: "RU / EN / multi",
        speed: "средне",
        accuracy: "максимальная",
        language_label: "119+",
        avatar_family: "qwen",
        recommended: false,
    },
    LlmModelInfo {
        id: "qwen2.5-3b-instruct-q4",
        file_name: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        label: "Qwen2.5 3B Instruct",
        description: "Совместимая модель прошлого каталога. Оставлена для уже скачанных установок.",
        size_label: "2.0 ГБ",
        min_ram_gb: 8,
        profile_label: "Legacy",
        languages_label: "RU / EN / multi",
        speed: "быстро",
        accuracy: "средняя+",
        language_label: "119+",
        avatar_family: "qwen",
        recommended: false,
    },
    LlmModelInfo {
        id: "qwen2.5-7b-instruct-q4",
        file_name: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        label: "Qwen2.5 7B Instruct",
        description: "Совместимая качественная модель прошлого каталога. Новым установкам лучше выбрать Qwen3.",
        size_label: "4.7 ГБ",
        min_ram_gb: 16,
        profile_label: "Legacy",
        languages_label: "RU / EN / multi",
        speed: "средне",
        accuracy: "высокая",
        language_label: "119+",
        avatar_family: "qwen",
        recommended: false,
    },
];

fn model_info(id: &str) -> Option<&'static LlmModelInfo> {
    let normalized = id.trim();
    LLM_CATALOG.iter().find(|model| model.id == normalized)
}

struct RunningLlm {
    child: CommandChild,
    pid: u32,
    port: u16,
    model_id: String,
}

fn runtime_state() -> &'static Mutex<Option<RunningLlm>> {
    static STATE: OnceLock<Mutex<Option<RunningLlm>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn clear_runtime_if_pid(pid: u32) {
    let mut guard = runtime_state()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if guard.as_ref().map(|running| running.pid) == Some(pid) {
        *guard = None;
    }
}

fn llama_stderr_is_error(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("error")
        || lower.contains("failed")
        || lower.contains("panic")
        || lower.contains("exception")
        || lower.contains("terminated")
}

fn drain_runtime_events(
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    pid: u32,
    model_id: String,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim();
                    if !line.is_empty() {
                        let message = format!("{} stderr: {}", model_id, line);
                        if llama_stderr_is_error(line) {
                            logger::log_error("LOCAL_LLM", &message);
                        } else {
                            logger::log_info("LOCAL_LLM", &message);
                        }
                    }
                }
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim();
                    if !line.is_empty() {
                        logger::log_info("LOCAL_LLM", &format!("{} stdout: {}", model_id, line));
                    }
                }
                CommandEvent::Error(err) => {
                    logger::log_error("LOCAL_LLM", &format!("{} event error: {}", model_id, err));
                }
                CommandEvent::Terminated(payload) => {
                    logger::log_error(
                        "LOCAL_LLM",
                        &format!(
                            "{} terminated: pid={} code={:?} signal={:?}",
                            model_id, pid, payload.code, payload.signal
                        ),
                    );
                    clear_runtime_if_pid(pid);
                    break;
                }
                _ => {}
            }
        }
    });
}

fn llm_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
        .map(|dir| dir.join("models").join("llm"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    llm_dir(app)
}

fn model_path(app: &AppHandle, info: &LlmModelInfo) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(info.file_name))
}

fn is_downloaded(app: &AppHandle, info: &LlmModelInfo) -> bool {
    model_path(app, info)
        .map(|path| path.is_file())
        .unwrap_or(false)
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
        if matches!(
            payload.status.as_str(),
            "downloaded" | "cancelled" | "error"
        ) {
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

async fn chat_completions_ready_with_timeout(
    client: &reqwest::Client,
    port: u16,
    timeout: Duration,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/v1/chat/completions", port);
    let payload = serde_json::json!({
        "model": "talkis-llm",
        "messages": [
            { "role": "system", "content": "Ответь одним словом." },
            { "role": "user", "content": "ping" }
        ],
        "temperature": 0.0,
        "max_tokens": 1,
        "stream": false
    });

    let response = client
        .post(&url)
        .json(&payload)
        .timeout(timeout)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if status.is_success() {
        Ok(())
    } else {
        let snippet: String = body.chars().take(500).collect();
        Err(format!("{}: {}", status, snippet))
    }
}

async fn chat_completions_ready(client: &reqwest::Client, port: u16) -> Result<(), String> {
    chat_completions_ready_with_timeout(client, port, Duration::from_secs(120)).await
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

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let existing_port = {
        let guard = runtime_state()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if let Some(running) = guard.as_ref() {
            if running.model_id == info.id {
                Some(running.port)
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some(port) = existing_port {
        if health_ok(&client, port).await {
            match chat_completions_ready_with_timeout(&client, port, Duration::from_secs(8)).await {
                Ok(()) => return Ok(base_url(port)),
                Err(message) => logger::log_error(
                    "LOCAL_LLM",
                    &format!(
                        "Detected stale local LLM runtime on port {} ({}): {}",
                        port, info.id, message
                    ),
                ),
            }
        } else {
            logger::log_error(
                "LOCAL_LLM",
                &format!(
                    "Detected stopped local LLM runtime on port {} ({})",
                    port, info.id
                ),
            );
        }
        stop_runtime();
    }

    stop_runtime();

    let port = find_port();
    let (events, child) = app
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
    let pid = child.pid();
    drain_runtime_events(events, pid, info.id.to_string());

    {
        let mut guard = runtime_state()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        *guard = Some(RunningLlm {
            child,
            pid,
            port,
            model_id: info.id.to_string(),
        });
    }

    for _ in 0..180 {
        if health_ok(&client, port).await {
            if let Err(message) = chat_completions_ready(&client, port).await {
                logger::log_error(
                    "LOCAL_LLM",
                    &format!(
                        "llama-server chat/completions warmup failed on port {} ({}): {}",
                        port, info.id, message
                    ),
                );
                stop_runtime();
                return Err(format!(
                    "Локальный LLM-рантайм запустился, но не смог выполнить тестовый запрос к /v1/chat/completions: {}",
                    message
                ));
            }
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
    let mut guard = runtime_state()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if let Some(running) = guard.take() {
        let _ = running.child.kill();
    }
}

#[derive(Serialize)]
pub struct LocalLlmModel {
    id: String,
    label: String,
    description: String,
    file_name: String,
    size_label: String,
    min_ram_gb: u32,
    profile_label: String,
    languages_label: String,
    speed: String,
    accuracy: String,
    language_label: String,
    avatar_family: String,
    recommended: bool,
    downloaded: bool,
}

#[tauri::command]
pub fn list_local_llm_models(app: AppHandle) -> Vec<LocalLlmModel> {
    LLM_CATALOG
        .iter()
        .map(|model| LocalLlmModel {
            id: model.id.to_string(),
            label: model.label.to_string(),
            description: model.description.to_string(),
            file_name: model.file_name.to_string(),
            size_label: model.size_label.to_string(),
            min_ram_gb: model.min_ram_gb,
            profile_label: model.profile_label.to_string(),
            languages_label: model.languages_label.to_string(),
            speed: model.speed.to_string(),
            accuracy: model.accuracy.to_string(),
            language_label: model.language_label.to_string(),
            avatar_family: model.avatar_family.to_string(),
            recommended: model.recommended,
            downloaded: is_downloaded(&app, model),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_starts_with_recommended_qwen3_models() {
        let ids: Vec<&str> = LLM_CATALOG.iter().map(|model| model.id).collect();

        assert_eq!(ids[0], "qwen3-1.7b-instruct-q4");
        assert!(ids.contains(&"qwen3-4b-instruct-q4"));
        assert!(ids.contains(&"qwen3-8b-instruct-q4"));
        assert!(LLM_CATALOG[0].recommended);
    }

    #[test]
    fn catalog_keeps_legacy_qwen25_ids_for_existing_downloads() {
        assert!(model_info("qwen2.5-3b-instruct-q4").is_some());
        assert!(model_info("qwen2.5-7b-instruct-q4").is_some());
    }

    #[test]
    fn catalog_includes_modern_non_qwen_families() {
        assert!(model_info("granite-3.3-2b-instruct-q4").is_some());
        assert!(model_info("smollm3-3b-q4").is_some());
        assert!(model_info("phi-4-mini-instruct-q4").is_some());
        assert!(model_info("gemma-3-4b-it-q4").is_some());
    }

    #[test]
    fn llama_cpp_kernel_stderr_is_logged_as_info() {
        assert!(!llama_stderr_is_error(
            "ggml_metal_library_compile_pipeline: loaded kernel_mul_mv_q4_K_f32"
        ));
        assert!(llama_stderr_is_error("server failed to load model"));
    }
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
        let guard = runtime_state()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
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
        std::fs::remove_file(&path).map_err(|err| format!("Не удалось удалить модель: {}", err))?;
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
    let guard = runtime_state()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
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
