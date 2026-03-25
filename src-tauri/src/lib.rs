mod ai;
mod logger;
mod paste;
mod prompt_config;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        if let Err(err) = win.show() {
            logger::log_error("WINDOW", &format!("Failed to show settings window: {}", err));
        }
        if let Err(err) = win.set_focus() {
            logger::log_error("WINDOW", &format!("Failed to focus settings window: {}", err));
        }
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("TalkFlow — Settings")
    .inner_size(920.0, 680.0)
    .min_inner_size(820.0, 560.0)
    .decorations(false)
    .transparent(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    if let Err(err) = apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, None) {
        logger::log_error(
            "WINDOW",
            &format!("Failed to apply vibrancy to settings window: {}", err),
        );
    }

    if let Err(err) = win.show() {
        logger::log_error(
            "WINDOW",
            &format!("Failed to show new settings window: {}", err),
        );
    }
    if let Err(err) = win.set_focus() {
        logger::log_error(
            "WINDOW",
            &format!("Failed to focus new settings window: {}", err),
        );
    }

    Ok(())
}

#[tauri::command]
async fn widget_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("widget") {
        if let Err(err) = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })) {
            logger::log_error("WINDOW", &format!("Failed to resize widget window: {}", err));
        }

        if let Ok(Some(monitor)) = win.primary_monitor() {
            let screen_size = monitor.size();
            let scale_factor = monitor.scale_factor();
            let x = (screen_size.width as f64 / scale_factor - width) / 2.0;
            let center_y = screen_size.height as f64 / scale_factor - 105.0;
            let y = center_y - (height / 2.0);
            if let Err(err) =
                win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            {
                logger::log_error("WINDOW", &format!("Failed to reposition widget window: {}", err));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open accessibility settings: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        // On Windows/Linux, accessibility is usually not required for global shortcuts
    }
    Ok(())
}

#[tauri::command]
async fn check_accessibility_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(unsafe { AXIsProcessTrusted() != 0 });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
fn get_cleanup_prompt_preview(
    language: String,
    style: String,
) -> Result<prompt_config::PromptPreview, String> {
    prompt_config::build_cleanup_prompt_preview(&language, &style)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            logger::log_info("INIT", "Application starting...");
            if let Some(win) = app.get_webview_window("widget") {
                #[cfg(target_os = "macos")]
                {
                    unsafe {
                        let ns_win: &objc2_app_kit::NSWindow =
                            &*win.ns_window().map_err(|e| e.to_string())?.cast();
                        ns_win.setAcceptsMouseMovedEvents(true);
                    }
                }
                let width = 56.0;
                let height = 56.0;

                if let Ok(Some(monitor)) = win.primary_monitor() {
                    let screen_size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    let x = (screen_size.width as f64 / scale_factor - width) / 2.0;
                    let center_y = screen_size.height as f64 / scale_factor - 105.0;
                    let y = center_y - (height / 2.0);

                    if let Err(err) =
                        win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
                    {
                        logger::log_error(
                            "WINDOW",
                            &format!("Failed to position widget window during setup: {}", err),
                        );
                    }
                    if let Err(err) = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
                        width,
                        height,
                    })) {
                        logger::log_error(
                            "WINDOW",
                            &format!("Failed to size widget window during setup: {}", err),
                        );
                    }
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = open_settings(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_settings,
            widget_resize,
            paste::paste_text,
            ai::transcribe_and_clean,
            logger::log_event,
            logger::get_log_path_cmd,
            logger::clear_logs,
            open_accessibility_settings,
            check_accessibility_permission,
            get_cleanup_prompt_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TalkFlow");
}
