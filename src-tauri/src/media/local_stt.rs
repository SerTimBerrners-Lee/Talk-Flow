use crate::logger;
use std::fs;

use super::ffmpeg::run_ffmpeg;
use super::paths::{file_extension, unique_temp_path};
use super::probe::is_local_stt_ready_wav;

pub async fn convert_audio_to_local_stt_wav(
    app: &tauri::AppHandle,
    input_bytes: &[u8],
    file_name: &str,
) -> Result<Vec<u8>, String> {
    if is_local_stt_ready_wav(input_bytes) {
        logger::log_info(
            "MEDIA",
            &format!(
                "Skipping ffmpeg for local STT: input is already 16 kHz mono PCM WAV, size={} bytes",
                input_bytes.len()
            ),
        );
        return Ok(input_bytes.to_vec());
    }

    let input_ext = file_extension(file_name);
    let input_path = unique_temp_path("local-stt-input", input_ext);
    let output_path = unique_temp_path("local-stt-output", "wav");

    fs::write(&input_path, input_bytes)
        .map_err(|err| format!("Не удалось подготовить аудио для локального STT: {}", err))?;

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

    let ffmpeg_result = run_ffmpeg(app, ffmpeg_args).await;
    let _ = fs::remove_file(&input_path);

    if let Err(message) = ffmpeg_result {
        let _ = fs::remove_file(&output_path);
        return Err(if message.is_empty() {
            "Не удалось подготовить аудио для локального STT.".to_string()
        } else {
            format!(
                "Не удалось подготовить аудио для локального STT: {}",
                message
            )
        });
    }

    let output_bytes = fs::read(&output_path).map_err(|err| {
        let _ = fs::remove_file(&output_path);
        format!("Не удалось прочитать WAV для локального STT: {}", err)
    })?;
    let _ = fs::remove_file(&output_path);

    Ok(output_bytes)
}
