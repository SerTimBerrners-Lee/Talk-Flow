use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const HISTORY_FILE_NAME: &str = "history.json";

fn resolve_storage_dir(storage_dir: &str) -> Result<PathBuf, String> {
    let trimmed = storage_dir.trim();
    if trimmed.is_empty() {
        return Err("Папка истории не задана.".to_string());
    }

    Ok(PathBuf::from(trimmed))
}

fn history_file_path(storage_dir: &str) -> Result<PathBuf, String> {
    Ok(resolve_storage_dir(storage_dir)?.join(HISTORY_FILE_NAME))
}

fn temp_history_file_path(path: &Path) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let temp_name = format!(
        ".{}.tmp-{}-{}",
        HISTORY_FILE_NAME,
        std::process::id(),
        now_ms
    );

    path.with_file_name(temp_name)
}

fn write_history_json(path: &Path, history: &[Value]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(history)
        .map_err(|err| format!("Не удалось подготовить файл истории: {}", err))?;
    let temp_path = temp_history_file_path(path);
    let mut file = fs::File::create(&temp_path)
        .map_err(|err| format!("Не удалось создать временный файл истории: {}", err))?;

    file.write_all(&json)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|err| format!("Не удалось записать временный файл истории: {}", err))?;
    drop(file);

    if let Err(err) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Не удалось заменить файл истории: {}", err));
    }

    Ok(())
}

#[tauri::command]
pub async fn read_history_file(storage_dir: String) -> Result<Vec<Value>, String> {
    let path = history_file_path(&storage_dir)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("Не удалось прочитать файл истории: {}", err)),
    };

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    match serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("Не удалось разобрать файл истории: {}", err))?
    {
        Value::Array(items) => Ok(items),
        _ => Err("Файл истории должен содержать JSON-массив.".to_string()),
    }
}

#[tauri::command]
pub async fn write_history_file(storage_dir: String, history: Vec<Value>) -> Result<(), String> {
    let dir = resolve_storage_dir(&storage_dir)?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Не удалось подготовить папку истории: {}", err))?;
    write_history_json(&dir.join(HISTORY_FILE_NAME), &history)
}

#[tauri::command]
pub fn get_default_transcription_storage_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
}
