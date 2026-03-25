use std::sync::mpsc;
use std::time::Duration;

use enigo::{Enigo, Key, Keyboard, Settings};

use crate::logger;

/// Paste text by writing to clipboard and simulating Cmd+V
#[tauri::command]
pub async fn paste_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let char_count = text.chars().count();
    logger::log_info(
        "PASTE",
        &format!("Scheduling paste on main thread, chars={}", char_count),
    );

    let handle = app.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        let result = (|| -> Result<(), String> {
            logger::log_info(
                "PASTE",
                &format!("Writing text to clipboard, chars={}", char_count),
            );
            handle
                .clipboard()
                .write_text(text)
                .map_err(|e| format!("Clipboard write failed: {}", e))?;

            std::thread::sleep(Duration::from_millis(100));

            logger::log_info("PASTE", "Simulating Cmd+V");
            let mut enigo = Enigo::new(&Settings::default())
                .map_err(|e| format!("Input initialization failed: {}", e))?;
            enigo
                .key(Key::Meta, enigo::Direction::Press)
                .map_err(|e| format!("Meta press failed: {}", e))?;
            enigo
                .raw(0x09, enigo::Direction::Click)
                .map_err(|e| format!("V click failed: {}", e))?;
            enigo
                .key(Key::Meta, enigo::Direction::Release)
                .map_err(|e| format!("Meta release failed: {}", e))?;

            Ok(())
        })();

        if let Err(err) = &result {
            logger::log_error("PASTE", err);
        } else {
            logger::log_info("PASTE", "Paste completed on main thread");
        }

        let _ = tx.send(result);
    })
    .map_err(|e| format!("Failed to schedule paste on main thread: {}", e))?;

    tokio::task::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("Failed waiting for paste completion: {}", e))?
        .map_err(|e| format!("Failed receiving paste result: {}", e))??;

    Ok(())
}
