use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const HISTORY_DIR_NAME: &str = "history";
const HISTORY_FILE_NAME: &str = "history.json";
const RECORDINGS_DIR_NAME: &str = "recordings";
const CALL_CAPTURE_DIR_NAME: &str = "call-capture";
const MODELS_DIR_NAME: &str = "models";
const STT_MODELS_DIR_NAME: &str = "stt";
const LLM_MODELS_DIR_NAME: &str = "llm";
const LEGACY_LOCAL_STT_DIR_NAME: &str = "local-stt";
const LEGACY_LOCAL_LLM_DIR_NAME: &str = "local-llm";
const APP_DATA_LAYOUT_MARKER_FILE: &str = ".talkis-app-data-layout-v3";
const LEGACY_GGML_STT_MODEL_FILES: &[&str] = &[
    "ggml-tiny.bin",
    "ggml-base.bin",
    "ggml-small.bin",
    "ggml-medium.bin",
    "ggml-large-v2.bin",
    "ggml-large-v3.bin",
    "ggml-large-v3-turbo.bin",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAudioFile {
    path: String,
    mime_type: String,
    file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAudioRead {
    audio_base64: String,
    mime_type: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
}

fn default_history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(HISTORY_DIR_NAME))
}

fn resolve_storage_dir(app: Option<&AppHandle>, storage_dir: &str) -> Result<PathBuf, String> {
    if let Some(app) = app {
        return default_history_dir(app);
    }

    let trimmed = storage_dir.trim();
    if trimmed.is_empty() {
        return Err("Папка истории не задана.".to_string());
    }

    Ok(PathBuf::from(trimmed))
}

fn history_file_path(app: Option<&AppHandle>, storage_dir: &str) -> Result<PathBuf, String> {
    Ok(resolve_storage_dir(app, storage_dir)?.join(HISTORY_FILE_NAME))
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

fn storage_root(app: &AppHandle, _storage_dir: Option<&str>) -> Result<PathBuf, String> {
    default_history_dir(app)
}

fn allowed_audio_roots(app: &AppHandle, storage_dir: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let app_data = app_data_dir(app)?;
    let history_dir = default_history_dir(app)?;
    let mut roots = vec![
        history_dir.join(RECORDINGS_DIR_NAME),
        history_dir.join(CALL_CAPTURE_DIR_NAME),
    ];

    if let Some(custom_dir) = storage_dir.map(str::trim).filter(|value| !value.is_empty()) {
        let custom = PathBuf::from(custom_dir);
        for custom_root in [
            custom.join(RECORDINGS_DIR_NAME),
            custom.join(CALL_CAPTURE_DIR_NAME),
        ] {
            if !roots.iter().any(|root| root == &custom_root) {
                roots.push(custom_root);
            }
        }
    }

    for legacy_root in [
        app_data.join(RECORDINGS_DIR_NAME),
        app_data.join(CALL_CAPTURE_DIR_NAME),
    ] {
        if !roots.iter().any(|root| root == &legacy_root) {
            roots.push(legacy_root);
        }
    }

    Ok(roots)
}

fn canonical_existing_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|err| format!("Не удалось проверить папку хранения аудио: {}", err))
}

fn validate_audio_path(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|err| format!("Не удалось проверить путь аудио: {}", err))?;

    for root in roots {
        let Ok(canonical_root) = canonical_existing_root(root) else {
            continue;
        };

        if canonical_path.starts_with(canonical_root) {
            return Ok(canonical_path);
        }
    }

    Err("Аудиофайл находится вне папки хранения Talkis.".to_string())
}

fn sanitize_entry_id(entry_id: &str) -> String {
    entry_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn audio_extension(mime_type: &str) -> &'static str {
    let normalized = mime_type.to_ascii_lowercase();

    if normalized.contains("wav") || normalized.contains("wave") {
        "wav"
    } else if normalized.contains("mpeg") || normalized.contains("mp3") {
        "mp3"
    } else if normalized.contains("mp4") || normalized.contains("m4a") {
        "m4a"
    } else if normalized.contains("ogg") {
        "ogg"
    } else {
        "webm"
    }
}

fn mime_type_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        _ => "audio/webm",
    }
    .to_string()
}

fn save_history_audio_file(
    root: &Path,
    entry_id: &str,
    audio_base64: &str,
    mime_type: &str,
) -> Result<HistoryAudioFile, String> {
    let safe_entry_id = sanitize_entry_id(entry_id);
    if safe_entry_id.is_empty() {
        return Err("Некорректный идентификатор записи.".to_string());
    }

    let extension = audio_extension(mime_type);
    let file_name = format!("recording.{}", extension);
    let dir = root.join(RECORDINGS_DIR_NAME).join(safe_entry_id);
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Не удалось подготовить папку аудио истории: {}", err))?;

    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|err| format!("Не удалось прочитать аудио записи: {}", err))?;
    let path = dir.join(&file_name);
    fs::write(&path, audio_bytes)
        .map_err(|err| format!("Не удалось сохранить аудио записи: {}", err))?;

    Ok(HistoryAudioFile {
        path: path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        file_name,
    })
}

fn read_history_audio_file(path: &Path, roots: &[PathBuf]) -> Result<HistoryAudioRead, String> {
    let safe_path = validate_audio_path(path, roots)?;
    let audio_bytes =
        fs::read(&safe_path).map_err(|err| format!("Не удалось прочитать аудио: {}", err))?;

    Ok(HistoryAudioRead {
        audio_base64: base64::engine::general_purpose::STANDARD.encode(audio_bytes),
        mime_type: mime_type_for_path(&safe_path),
    })
}

fn delete_history_audio_file(path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let safe_path = validate_audio_path(path, roots)?;
    fs::remove_file(&safe_path).map_err(|err| format!("Не удалось удалить аудио: {}", err))?;

    if let Some(parent) = safe_path.parent() {
        let _ = fs::remove_dir(parent);
    }

    Ok(())
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

fn read_history_json(path: &Path) -> Result<Vec<Value>, String> {
    let content = match fs::read_to_string(path) {
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

fn history_entry_id(entry: &Value) -> Option<String> {
    entry
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn merge_history(target: &mut Vec<Value>, source: Vec<Value>) {
    let mut seen = target
        .iter()
        .filter_map(history_entry_id)
        .collect::<std::collections::HashSet<_>>();

    for entry in source {
        if let Some(id) = history_entry_id(&entry) {
            if seen.insert(id) {
                target.push(entry);
            }
        } else {
            target.push(entry);
        }
    }
}

fn copy_file_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_file() || target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Не удалось подготовить папку {}: {}", parent.display(), err))?;
    }

    fs::copy(source, target).map_err(|err| {
        format!(
            "Не удалось перенести файл {} в {}: {}",
            source.display(),
            target.display(),
            err
        )
    })?;

    Ok(())
}

fn copy_dir_contents_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(target)
        .map_err(|err| format!("Не удалось подготовить папку {}: {}", target.display(), err))?;

    for entry in fs::read_dir(source)
        .map_err(|err| format!("Не удалось прочитать папку {}: {}", source.display(), err))?
    {
        let entry = entry.map_err(|err| format!("Не удалось прочитать элемент папки: {}", err))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|err| {
            format!(
                "Не удалось проверить тип файла {}: {}",
                source_path.display(),
                err
            )
        })?;

        if file_type.is_dir() {
            copy_dir_contents_if_missing(&source_path, &target_path)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&source_path, &target_path)?;
        }
    }

    Ok(())
}

fn migrate_path_value(
    value: &mut Value,
    target_dir: &Path,
    fallback_name: &str,
) -> Result<bool, String> {
    let Some(source) = value
        .as_str()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return Ok(false);
    };

    let source_path = PathBuf::from(source);
    if !source_path.is_file() {
        return Ok(false);
    }

    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_name);
    let target_path = target_dir.join(file_name);
    copy_file_if_missing(&source_path, &target_path)?;
    *value = Value::String(target_path.to_string_lossy().to_string());
    Ok(true)
}

fn migrate_history_audio_paths(history: &mut [Value], history_dir: &Path) -> Result<(), String> {
    for entry in history {
        let entry_id = history_entry_id(entry).unwrap_or_else(|| "entry".to_string());
        let safe_entry_id = sanitize_entry_id(&entry_id);
        let safe_entry_id = if safe_entry_id.is_empty() {
            "entry".to_string()
        } else {
            safe_entry_id
        };

        if let Some(audio_path) = entry.get_mut("audioPath") {
            let target_dir = history_dir.join(RECORDINGS_DIR_NAME).join(&safe_entry_id);
            migrate_path_value(audio_path, &target_dir, "recording.wav")?;
        }

        let session_id = entry
            .get("callSessionId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| safe_entry_id.clone());

        if let Some(tracks) = entry.get_mut("callTracks").and_then(Value::as_array_mut) {
            for track in tracks {
                let kind = track
                    .get("kind")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("track")
                    .to_string();
                if let Some(path) = track.get_mut("path") {
                    let target_dir = history_dir.join(CALL_CAPTURE_DIR_NAME).join(&session_id);
                    let fallback_name = format!("{}.wav", kind);
                    migrate_path_value(path, &target_dir, &fallback_name)?;
                }
            }
        }
    }

    Ok(())
}

fn migrate_models(app_data: &Path, legacy_local_models_dir: Option<&str>) -> Result<(), String> {
    let stt_target = app_data.join(MODELS_DIR_NAME).join(STT_MODELS_DIR_NAME);
    let llm_target = app_data.join(MODELS_DIR_NAME).join(LLM_MODELS_DIR_NAME);
    let legacy_stt_default = app_data
        .join(LEGACY_LOCAL_STT_DIR_NAME)
        .join(MODELS_DIR_NAME);
    let legacy_llm_default = app_data
        .join(LEGACY_LOCAL_LLM_DIR_NAME)
        .join(MODELS_DIR_NAME);

    copy_dir_contents_if_missing(&legacy_stt_default, &stt_target)?;
    remove_legacy_ggml_stt_models(&legacy_stt_default)?;
    if let Some(custom_dir) = legacy_local_models_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        copy_dir_contents_if_missing(&custom_dir, &stt_target)?;
        remove_legacy_ggml_stt_models(&custom_dir)?;
    }
    remove_legacy_ggml_stt_models(&stt_target)?;
    copy_dir_contents_if_missing(&legacy_llm_default, &llm_target)?;

    Ok(())
}

fn remove_legacy_ggml_stt_models(dir: &Path) -> Result<(), String> {
    for file_name in LEGACY_GGML_STT_MODEL_FILES {
        let path = dir.join(file_name);
        if path.is_file() {
            fs::remove_file(&path).map_err(|err| {
                format!(
                    "Не удалось удалить старую STT-модель {}: {}",
                    path.display(),
                    err
                )
            })?;
            crate::logger::log_info(
                "APP_DATA",
                &format!("Removed legacy GGML STT model {}", path.display()),
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn migrate_app_data_layout(
    app: AppHandle,
    legacy_local_models_dir: Option<String>,
    legacy_transcription_storage_dir: Option<String>,
    legacy_history: Vec<Value>,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;
    fs::create_dir_all(&app_data)
        .map_err(|err| format!("Не удалось подготовить папку данных Talkis: {}", err))?;
    let marker_path = app_data.join(APP_DATA_LAYOUT_MARKER_FILE);
    if marker_path.is_file() {
        return Ok(());
    }

    let mut errors: Vec<String> = Vec::new();
    let history_dir = app_data.join(HISTORY_DIR_NAME);
    if let Err(err) = fs::create_dir_all(&history_dir) {
        errors.push(format!(
            "Не удалось подготовить новую папку истории: {}",
            err
        ));
    }

    if let Err(err) = migrate_models(&app_data, legacy_local_models_dir.as_deref()) {
        errors.push(err);
    }

    let mut history =
        read_history_json(&history_dir.join(HISTORY_FILE_NAME)).unwrap_or_else(|err| {
            errors.push(err);
            Vec::new()
        });
    merge_history(&mut history, legacy_history);

    if let Some(legacy_dir) = legacy_transcription_storage_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match read_history_json(&PathBuf::from(legacy_dir).join(HISTORY_FILE_NAME)) {
            Ok(items) => merge_history(&mut history, items),
            Err(err) => errors.push(err),
        }
    }

    for old_default_file in [app_data.join(HISTORY_FILE_NAME)] {
        match read_history_json(&old_default_file) {
            Ok(items) => merge_history(&mut history, items),
            Err(err) => errors.push(err),
        }
    }

    if let Err(err) = migrate_history_audio_paths(&mut history, &history_dir) {
        errors.push(err);
    }

    if !history.is_empty() {
        if let Err(err) = write_history_json(&history_dir.join(HISTORY_FILE_NAME), &history) {
            errors.push(err);
        }
    }

    if errors.is_empty() {
        fs::write(&marker_path, b"3\n")
            .map_err(|err| format!("Не удалось сохранить marker миграции данных: {}", err))?;
        crate::logger::log_info("APP_DATA", "App data layout migration completed.");
    } else {
        for err in &errors {
            crate::logger::log_error("APP_DATA", err);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn read_history_file(app: AppHandle, storage_dir: String) -> Result<Vec<Value>, String> {
    let path = history_file_path(Some(&app), &storage_dir)?;
    read_history_json(&path)
}

#[tauri::command]
pub async fn write_history_file(
    app: AppHandle,
    storage_dir: String,
    history: Vec<Value>,
) -> Result<(), String> {
    let dir = resolve_storage_dir(Some(&app), &storage_dir)?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Не удалось подготовить папку истории: {}", err))?;
    write_history_json(&dir.join(HISTORY_FILE_NAME), &history)
}

#[tauri::command]
pub fn get_default_transcription_storage_dir(app: AppHandle) -> Result<String, String> {
    app_data_dir(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_history_audio(
    app: AppHandle,
    storage_dir: Option<String>,
    entry_id: String,
    audio_base64: String,
    mime_type: String,
) -> Result<HistoryAudioFile, String> {
    let root = storage_root(&app, storage_dir.as_deref())?;
    save_history_audio_file(&root, &entry_id, &audio_base64, &mime_type)
}

#[tauri::command]
pub async fn read_history_audio(
    app: AppHandle,
    storage_dir: Option<String>,
    path: String,
) -> Result<HistoryAudioRead, String> {
    let roots = allowed_audio_roots(&app, storage_dir.as_deref())?;
    read_history_audio_file(Path::new(&path), &roots)
}

#[tauri::command]
pub async fn delete_history_audio(
    app: AppHandle,
    storage_dir: Option<String>,
    path: String,
) -> Result<(), String> {
    let roots = allowed_audio_roots(&app, storage_dir.as_deref())?;
    delete_history_audio_file(Path::new(&path), &roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "talkis-history-audio-test-{}-{}-{}",
            name,
            std::process::id(),
            now_ms
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn saves_reads_and_deletes_history_audio_inside_root() {
        let root = temp_test_dir("roundtrip");
        let saved = save_history_audio_file(&root, "entry/../1", "aGVsbG8=", "audio/wav")
            .expect("audio should save");

        assert_eq!(saved.file_name, "recording.wav");
        assert!(Path::new(&saved.path).exists());

        let read = read_history_audio_file(Path::new(&saved.path), std::slice::from_ref(&root))
            .expect("audio should read");
        assert_eq!(read.audio_base64, "aGVsbG8=");
        assert_eq!(read.mime_type, "audio/wav");

        delete_history_audio_file(Path::new(&saved.path), &[root]).expect("audio should delete");
        assert!(!Path::new(&saved.path).exists());
    }

    #[test]
    fn rejects_audio_path_outside_allowed_roots() {
        let allowed_root = temp_test_dir("allowed");
        let other_root = temp_test_dir("other");
        let outside = other_root.join("outside.wav");
        fs::write(&outside, b"nope").unwrap();

        let err = read_history_audio_file(&outside, &[allowed_root]).unwrap_err();
        assert!(err.contains("вне папки хранения"));
    }
}
