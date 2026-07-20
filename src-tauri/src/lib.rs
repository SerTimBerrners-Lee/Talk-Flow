mod ai;
mod call_capture;
mod commands;
mod download_cancel;
mod history_storage;
mod hotkey_capture;
mod hotkey_manager;
mod live_dictation;
mod live_translation;
mod llm_runtime;
mod local_stt;
mod local_translator;
mod logger;
mod media;
mod media_permissions;
mod native_voice_recorder;
mod paste;
mod prompt_config;
pub mod realtime;
mod shutdown;
mod tray;

use commands::{
    accessibility, runtime_info, settings_window,
    widget::{self, WIDGET_HEIGHT, WIDGET_WIDTH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// Bring the already-running instance to front when a second launch is blocked
/// by the single-instance plugin (Windows/Linux only).
#[cfg(any(windows, target_os = "linux"))]
fn focus_existing_instance(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered first. macOS enforces one
    // app instance natively (so the duplicate-widget bug never happens there);
    // on Windows/Linux a second launch — autostart, deep link, or re-open —
    // would otherwise start another process with its own floating widget.
    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_existing_instance(app)
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            logger::log_info("INIT", "Application starting...");
            hotkey_manager::init(app);
            tray::setup(app)?;

            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            let _ = widget::ensure_widget_notice_window(app.handle());
            let _ = widget::ensure_widget_text_window(app.handle());

            if let Some(win) = app.get_webview_window("widget") {
                media_permissions::allow_microphone_requests(&win);
                let _ = win.set_resizable(false);

                #[cfg(target_os = "macos")]
                {
                    unsafe {
                        let ns_win: &objc2_app_kit::NSWindow =
                            &*win.ns_window().map_err(|e| e.to_string())?.cast();
                        ns_win.setAcceptsMouseMovedEvents(true);
                    }
                }

                if let Err(err) = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: WIDGET_WIDTH,
                    height: WIDGET_HEIGHT,
                })) {
                    logger::log_error(
                        "WINDOW",
                        &format!("Failed to size widget window during setup: {}", err),
                    );
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = settings_window::open_settings(handle).await;
            });

            // ── Deep link handling ──────────────────────────
            // Check if app was launched via deep link
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in &urls {
                    logger::log_info("DEEP_LINK", &format!("Startup deep link: {}", url));
                    if let Some(token) = extract_auth_token(url.as_str()) {
                        let _ = app.emit("deep-link-auth", token);
                    }
                }
            }

            // Listen for deep links while running
            let handle_for_dl = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    logger::log_info("DEEP_LINK", &format!("Runtime deep link: {}", url));
                    if let Some(token) = extract_auth_token(url.as_str()) {
                        let _ = handle_for_dl.emit("deep-link-auth", token.clone());
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_window::open_settings,
            settings_window::open_settings_tab,
            widget::widget_resize,
            widget::activate_widget_for_hotkey,
            widget::show_widget_notice,
            widget::hide_widget_notice,
            widget::expand_widget_notice,
            widget::show_widget_text_overlay,
            widget::widget_text_overlay_ready,
            widget::get_widget_text_overlay_payload,
            widget::hide_widget_text_overlay,
            widget::hide_widget_text_overlay_request,
            paste::remember_paste_target_window,
            paste::copy_selected_text,
            paste::paste_text,
            ai::transcribe_and_clean,
            ai::transcribe_only,
            ai::transcribe_file_path,
            ai::process_text,
            ai::embed_text,
            history_storage::migrate_app_data_layout,
            history_storage::read_history_file,
            history_storage::read_history_index_file,
            history_storage::read_history_entry_file,
            history_storage::write_history_file,
            history_storage::get_default_transcription_storage_dir,
            history_storage::save_history_audio,
            history_storage::read_history_audio,
            history_storage::delete_history_audio,
            call_capture::list_call_capture_targets,
            call_capture::start_call_capture,
            call_capture::stop_call_capture,
            call_capture::save_call_capture_mic_track,
            call_capture::pause_call_capture_mic,
            call_capture::resume_call_capture_mic,
            call_capture::checkpoint_call_transcription,
            call_capture::recover_call_capture_sessions,
            call_capture::get_call_capture_status,
            call_capture::get_call_capture_duration_ms,
            live_translation::start_live_translation,
            live_translation::get_live_translation_audio_level,
            live_translation::stop_live_translation,
            media::prepare_media_for_transcription,
            native_voice_recorder::start_native_voice_recording,
            native_voice_recorder::pause_native_voice_recording,
            native_voice_recorder::resume_native_voice_recording,
            native_voice_recorder::stop_native_voice_recording,
            ai::test_api_connection,
            realtime::test_realtime_connection,
            ai::list_stt_models,
            ai::install_stt_model,
            ai::delete_stt_model,
            local_translator::list_local_translators,
            local_translator::download_local_translator,
            local_translator::delete_local_translator,
            local_translator::translate_with_local_translator,
            local_stt::get_local_stt_default_models_dir,
            llm_runtime::list_local_llm_models,
            llm_runtime::download_local_llm_model,
            llm_runtime::delete_local_llm_model,
            llm_runtime::start_local_llm,
            llm_runtime::stop_local_llm,
            llm_runtime::get_local_llm_status,
            llm_runtime::get_llm_download_progress,
            download_cancel::cancel_local_model_download,
            logger::log_event,
            logger::get_log_path_cmd,
            logger::clear_logs,
            accessibility::open_accessibility_settings,
            accessibility::reset_accessibility_permission,
            accessibility::check_accessibility_permission,
            accessibility::check_microphone_permission,
            runtime_info::get_app_runtime_info,
            get_cleanup_prompt_preview,
            start_native_hotkey_capture,
            stop_native_hotkey_capture,
            hotkey_manager::register_handy_hotkey,
            hotkey_manager::unregister_handy_hotkey,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Talkis");
}

#[tauri::command]
fn get_cleanup_prompt_preview(
    language: String,
    style: String,
) -> Result<prompt_config::PromptPreview, String> {
    prompt_config::build_cleanup_prompt_preview(&language, &style)
}

#[tauri::command]
fn start_native_hotkey_capture(
    window: tauri::WebviewWindow,
    request_id: String,
    target: String,
) -> Result<(), String> {
    hotkey_capture::start_capture(&window, request_id, target)
}

#[tauri::command]
fn stop_native_hotkey_capture(
    window: tauri::WebviewWindow,
    request_id: String,
    target: String,
) -> Result<(), String> {
    hotkey_capture::stop_capture(&window, request_id, target)
}

/// Extract token from `talkis://auth?token=<jwt>` URLs.
fn extract_auth_token(url_str: &str) -> Option<String> {
    // Parse talkis://auth?token=xxx or talkis://auth/callback?token=xxx
    if let Ok(url) = url::Url::parse(url_str) {
        for (key, value) in url.query_pairs() {
            if key == "token" && !value.is_empty() {
                return Some(value.into_owned());
            }
        }
    }
    None
}
