use crate::logger;
#[cfg(debug_assertions)]
use std::env;
#[cfg(debug_assertions)]
use std::path::PathBuf;
#[cfg(debug_assertions)]
use std::process::Command;
use std::time::Instant;
use tauri_plugin_shell::ShellExt;

#[cfg(debug_assertions)]
fn ffmpeg_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(value) = env::var("FFMPEG_PATH") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value));
        }
    }

    candidates.push(PathBuf::from("ffmpeg"));
    candidates.push(PathBuf::from("/opt/homebrew/bin/ffmpeg"));
    candidates.push(PathBuf::from("/usr/local/bin/ffmpeg"));
    candidates.push(PathBuf::from("/usr/bin/ffmpeg"));
    candidates
}

#[cfg(debug_assertions)]
fn resolve_ffmpeg() -> Result<PathBuf, String> {
    for candidate in ffmpeg_candidates() {
        if Command::new(&candidate)
            .arg("-version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
        {
            return Ok(candidate);
        }
    }

    Err("Системный ffmpeg не найден.".to_string())
}

pub(super) async fn run_ffmpeg(
    app: &tauri::AppHandle,
    args: Vec<String>,
) -> Result<Vec<u8>, String> {
    match app.shell().sidecar("talkis-ffmpeg") {
        Ok(command) => {
            logger::log_info("MEDIA", "Running bundled ffmpeg sidecar");
            let started_at = Instant::now();
            let output = command
                .args(args.clone())
                .output()
                .await
                .map_err(|err| format!("Не удалось запустить встроенный ffmpeg: {}", err))?;
            let elapsed_ms = started_at.elapsed().as_millis();

            if output.status.success() {
                logger::log_info(
                    "MEDIA",
                    &format!("Bundled ffmpeg sidecar finished in {}ms", elapsed_ms),
                );
                return Ok(output.stderr);
            }

            logger::log_error(
                "MEDIA",
                &format!("Bundled ffmpeg sidecar failed in {}ms", elapsed_ms),
            );
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Err(err) => {
            logger::log_error(
                "MEDIA",
                &format!("Bundled ffmpeg sidecar unavailable: {}", err),
            );
        }
    }

    #[cfg(debug_assertions)]
    {
        let ffmpeg = resolve_ffmpeg()?;
        logger::log_info(
            "MEDIA",
            &format!("Running system ffmpeg fallback: {:?}", ffmpeg),
        );
        let started_at = Instant::now();
        let output = Command::new(&ffmpeg)
            .args(&args)
            .output()
            .map_err(|err| format!("Не удалось запустить системный ffmpeg: {}", err))?;
        let elapsed_ms = started_at.elapsed().as_millis();

        if output.status.success() {
            logger::log_info(
                "MEDIA",
                &format!("System ffmpeg fallback finished in {}ms", elapsed_ms),
            );
            return Ok(output.stderr);
        }

        logger::log_error(
            "MEDIA",
            &format!("System ffmpeg fallback failed in {}ms", elapsed_ms),
        );
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }

    #[cfg(not(debug_assertions))]
    {
        Err("Встроенный медиаконвертер недоступен. Переустановите приложение или обратитесь в поддержку Talkis.".to_string())
    }
}
