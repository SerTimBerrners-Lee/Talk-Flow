use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

/// Registry of local-model download ids the user asked to cancel. The streaming
/// download loops (STT and LLM) poll `is_cancel_requested` each chunk and abort.
fn registry() -> &'static Mutex<HashSet<String>> {
    static REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn request_cancel(id: &str) {
    registry()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .insert(id.trim().to_string());
}

pub fn is_cancel_requested(id: &str) -> bool {
    let registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    !id.trim().is_empty() && registry.contains(id.trim())
}

/// True if any of the given ids was flagged for cancellation (the STT download is
/// keyed by both the requested model name and the catalog id).
pub fn is_any_cancel_requested(ids: &[&str]) -> bool {
    ids.iter().any(|id| is_cancel_requested(id))
}

pub fn clear(id: &str) {
    registry()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(id.trim());
}

/// Human-facing marker so the UI can recognize a user-cancelled download and
/// reset silently instead of showing it as an error.
pub const CANCELLED_MESSAGE: &str = "Загрузка отменена";

#[tauri::command]
pub fn cancel_local_model_download(model_id: String) {
    request_cancel(&model_id);
}
