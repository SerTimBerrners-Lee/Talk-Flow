use crate::logger;
use base64::Engine;
use std::fs;
use std::path::Path;

use super::ffmpeg::run_ffmpeg;
use super::paths::{file_extension, unique_temp_path};
use super::probe::is_local_stt_ready_wav;
use super::types::{
    PrepareMediaRequest, PrepareMediaResponse, PreparedDiarizationAudio, PreparedMediaChunk,
    PreparedMediaChunks, PreparedProxyMedia,
};
use super::{
    FILE_TRANSCRIPTION_SEGMENT_SECONDS, LOCAL_STT_FILE_TRANSCRIPTION_SEGMENT_SECONDS,
    MAX_FILE_TRANSCRIPTION_INPUT_BYTES, MAX_TRANSCRIPTION_BYTES,
};

pub async fn prepare_media_file_chunks_for_transcription(
    app: &tauri::AppHandle,
    input_path: &Path,
    local_stt_target: bool,
) -> Result<PreparedMediaChunks, String> {
    let metadata =
        fs::metadata(input_path).map_err(|err| format!("Не удалось прочитать файл: {}", err))?;

    if !metadata.is_file() {
        return Err("Выбранный путь не является файлом.".to_string());
    }

    if metadata.len() == 0 {
        return Err("Пустой файл нельзя транскрибировать.".to_string());
    }

    if metadata.len() > MAX_FILE_TRANSCRIPTION_INPUT_BYTES {
        return Err(
            "Файл слишком большой. Максимальный размер для локальной подготовки: 8 ГБ.".to_string(),
        );
    }

    if metadata.len() <= MAX_TRANSCRIPTION_BYTES {
        if let Ok(input_bytes) = fs::read(input_path) {
            if is_local_stt_ready_wav(&input_bytes) {
                logger::log_info(
                    "MEDIA",
                    &format!(
                        "Skipping ffmpeg for file transcription: input is already 16 kHz mono PCM WAV, size={} bytes",
                        metadata.len()
                    ),
                );
                return Ok(PreparedMediaChunks {
                    temp_dir: unique_temp_path("file-transcription-direct-wav", "dir"),
                    chunks: vec![PreparedMediaChunk {
                        path: input_path.to_path_buf(),
                        file_name: input_path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or("talkis-transcription.wav")
                            .to_string(),
                        mime_type: "audio/wav".to_string(),
                        size_bytes: metadata.len(),
                        start_offset_seconds: 0.0,
                    }],
                });
            }
        }
    }

    let chunks_dir = unique_temp_path("file-transcription-chunks", "dir");
    fs::create_dir_all(&chunks_dir)
        .map_err(|err| format!("Не удалось подготовить временную папку: {}", err))?;

    let segment_seconds = if local_stt_target {
        LOCAL_STT_FILE_TRANSCRIPTION_SEGMENT_SECONDS
    } else {
        FILE_TRANSCRIPTION_SEGMENT_SECONDS
    };
    logger::log_info(
        "MEDIA",
        &format!(
            "Preparing file transcription chunks: local_stt_target={}, segment_seconds={}",
            local_stt_target, segment_seconds
        ),
    );

    let output_pattern = chunks_dir.join("chunk-%05d.mp3");
    let ffmpeg_args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-b:a".to_string(),
        "32k".to_string(),
        "-f".to_string(),
        "segment".to_string(),
        "-segment_time".to_string(),
        segment_seconds.to_string(),
        "-reset_timestamps".to_string(),
        "1".to_string(),
        output_pattern.to_string_lossy().to_string(),
    ];

    if let Err(message) = run_ffmpeg(app, ffmpeg_args).await {
        let _ = fs::remove_dir_all(&chunks_dir);
        return Err(if message.is_empty() {
            "Не удалось извлечь аудио из файла.".to_string()
        } else {
            format!("Не удалось извлечь аудио из файла: {}", message)
        });
    }

    let mut chunk_paths = fs::read_dir(&chunks_dir)
        .map_err(|err| {
            let _ = fs::remove_dir_all(&chunks_dir);
            format!("Не удалось прочитать подготовленные фрагменты: {}", err)
        })?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("mp3"))
        .collect::<Vec<_>>();
    chunk_paths.sort();

    if chunk_paths.is_empty() {
        let _ = fs::remove_dir_all(&chunks_dir);
        return Err("Не удалось извлечь аудио из файла.".to_string());
    }

    let mut chunks = Vec::with_capacity(chunk_paths.len());
    for path in chunk_paths {
        let metadata = fs::metadata(&path).map_err(|err| {
            let _ = fs::remove_dir_all(&chunks_dir);
            format!("Не удалось прочитать фрагмент аудио: {}", err)
        })?;

        if metadata.len() > MAX_TRANSCRIPTION_BYTES {
            let _ = fs::remove_dir_all(&chunks_dir);
            return Err(
                "Подготовленный фрагмент больше 25 МБ. Попробуйте более короткий файл.".to_string(),
            );
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("talkis-transcription-chunk.mp3")
            .to_string();

        chunks.push(PreparedMediaChunk {
            path,
            file_name,
            mime_type: "audio/mpeg".to_string(),
            size_bytes: metadata.len(),
            start_offset_seconds: chunks.len() as f64 * segment_seconds as f64,
        });
    }

    Ok(PreparedMediaChunks {
        temp_dir: chunks_dir,
        chunks,
    })
}

pub async fn prepare_media_file_for_proxy_transcription(
    app: &tauri::AppHandle,
    input_path: &Path,
) -> Result<PreparedProxyMedia, String> {
    let metadata =
        fs::metadata(input_path).map_err(|err| format!("Не удалось прочитать файл: {}", err))?;

    validate_input_file(&metadata)?;

    let temp_dir = unique_temp_path("file-proxy-transcription", "dir");
    fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("Не удалось подготовить временную папку: {}", err))?;
    let output_path = temp_dir.join("talkis-cloud-diarization.mp3");
    let ffmpeg_args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-b:a".to_string(),
        "32k".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    if let Err(message) = run_ffmpeg(app, ffmpeg_args).await {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(if message.is_empty() {
            "Не удалось извлечь аудио из файла.".to_string()
        } else {
            format!("Не удалось извлечь аудио из файла: {}", message)
        });
    }

    let output_metadata = fs::metadata(&output_path).map_err(|err| {
        let _ = fs::remove_dir_all(&temp_dir);
        format!("Не удалось прочитать сжатый аудиофайл: {}", err)
    })?;

    if output_metadata.len() > MAX_TRANSCRIPTION_BYTES {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("После сжатия файл всё ещё больше 25 МБ. Для облачного разделения по говорящим выберите более короткий файл или используйте локальную разметку.".to_string());
    }

    Ok(PreparedProxyMedia {
        temp_dir,
        path: output_path,
        file_name: "talkis-cloud-diarization.mp3".to_string(),
        mime_type: "audio/mpeg".to_string(),
        size_bytes: output_metadata.len(),
    })
}

pub async fn prepare_media_file_for_diarization(
    app: &tauri::AppHandle,
    input_path: &Path,
) -> Result<PreparedDiarizationAudio, String> {
    let metadata =
        fs::metadata(input_path).map_err(|err| format!("Не удалось прочитать файл: {}", err))?;

    validate_input_file(&metadata)?;

    let temp_dir = unique_temp_path("file-diarization", "dir");
    fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("Не удалось подготовить временную папку: {}", err))?;
    let output_path = temp_dir.join("talkis-diarization.wav");
    let ffmpeg_args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-acodec".to_string(),
        "pcm_s16le".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    if let Err(message) = run_ffmpeg(app, ffmpeg_args).await {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(if message.is_empty() {
            "Не удалось подготовить аудио для разделения говорящих.".to_string()
        } else {
            format!(
                "Не удалось подготовить аудио для разделения говорящих: {}",
                message
            )
        });
    }

    Ok(PreparedDiarizationAudio {
        temp_dir,
        path: output_path,
    })
}

pub async fn prepare_media_for_transcription(
    app: tauri::AppHandle,
    req: PrepareMediaRequest,
) -> Result<PrepareMediaResponse, String> {
    logger::log_info(
        "MEDIA",
        &format!("Preparing media file for transcription: {}", req.file_name),
    );

    let input_bytes = base64::engine::general_purpose::STANDARD
        .decode(&req.file_base64)
        .map_err(|err| format!("Не удалось прочитать файл: {}", err))?;
    let input_ext = file_extension(&req.file_name);
    let input_path = unique_temp_path("input", input_ext);
    let output_path = unique_temp_path("output", "mp3");

    fs::write(&input_path, input_bytes)
        .map_err(|err| format!("Не удалось подготовить временный файл: {}", err))?;

    let ffmpeg_args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-b:a".to_string(),
        "32k".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    let ffmpeg_result = run_ffmpeg(&app, ffmpeg_args).await;

    let _ = fs::remove_file(&input_path);

    if let Err(message) = ffmpeg_result {
        let _ = fs::remove_file(&output_path);
        return Err(if message.is_empty() {
            "Не удалось извлечь аудио из файла.".to_string()
        } else {
            format!("Не удалось извлечь аудио из файла: {}", message)
        });
    }

    let metadata = fs::metadata(&output_path).map_err(|err| {
        let _ = fs::remove_file(&output_path);
        format!("Не удалось прочитать сжатый аудиофайл: {}", err)
    })?;

    if metadata.len() > MAX_TRANSCRIPTION_BYTES {
        let _ = fs::remove_file(&output_path);
        return Err(
            "После сжатия файл всё ещё больше 25 МБ. Выберите более короткий фрагмент.".to_string(),
        );
    }

    let output_bytes = fs::read(&output_path).map_err(|err| {
        let _ = fs::remove_file(&output_path);
        format!("Не удалось прочитать сжатый аудиофайл: {}", err)
    })?;
    let _ = fs::remove_file(&output_path);

    Ok(PrepareMediaResponse {
        audio_base64: base64::engine::general_purpose::STANDARD.encode(output_bytes),
        file_name: "talkis-transcription.mp3".to_string(),
        mime_type: "audio/mpeg".to_string(),
        size_bytes: metadata.len(),
    })
}

fn validate_input_file(metadata: &fs::Metadata) -> Result<(), String> {
    if !metadata.is_file() {
        return Err("Выбранный путь не является файлом.".to_string());
    }

    if metadata.len() == 0 {
        return Err("Пустой файл нельзя транскрибировать.".to_string());
    }

    if metadata.len() > MAX_FILE_TRANSCRIPTION_INPUT_BYTES {
        return Err(
            "Файл слишком большой. Максимальный размер для локальной подготовки: 8 ГБ.".to_string(),
        );
    }

    Ok(())
}
