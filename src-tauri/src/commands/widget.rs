use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::media_permissions;

const NOTICE_WINDOW_LABEL: &str = "widget-notice";
const TEXT_WINDOW_LABEL: &str = "widget-text";
const NOTICE_EVENT: &str = "widget-notice:update";
const TEXT_EVENT: &str = "widget-text:update";
pub const NOTICE_WIDTH: f64 = 212.0;
pub const NOTICE_HEIGHT: f64 = 52.0;
pub const TEXT_OVERLAY_WIDTH: f64 = 324.0;
pub const TEXT_OVERLAY_HEIGHT: f64 = 131.2;
/// Must match NOTICE_WIDGET_GAP in src/windows/widget/widgetConstants.ts (logical pixels).
pub const NOTICE_GAP: f64 = 2.0;
const TEXT_OVERLAY_GAP: f64 = 8.0;
/// Must match CALL_STACK_WIDGET_WIDTH/HEIGHT in src/windows/widget/widgetConstants.ts.
pub const WIDGET_WIDTH: f64 = 109.0;
pub const WIDGET_HEIGHT: f64 = 34.0;
const WIDGET_EXPANDED_OFFSET_RATIO: f64 = 0.20;

fn centered_resize_offset(current: f64, target: f64, expanded_offset_ratio: f64) -> f64 {
    let centered = (current - target) / 2.0;

    if target > current {
        centered - (target - current) * expanded_offset_ratio
    } else {
        centered
    }
}

#[derive(Clone, Serialize)]
struct WidgetNoticePayload {
    message: String,
    tone: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetTextOverlayPayload {
    status: String,
    source_text: String,
    translated_text: String,
    target_language: String,
    request_id: Option<String>,
    message: Option<String>,
}

fn text_overlay_payload_store() -> &'static Mutex<Option<WidgetTextOverlayPayload>> {
    static STORE: OnceLock<Mutex<Option<WidgetTextOverlayPayload>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn cached_text_overlay_payload() -> Result<Option<WidgetTextOverlayPayload>, String> {
    text_overlay_payload_store()
        .lock()
        .map_err(|e| format!("Text overlay state lock failed: {e}"))
        .map(|cached| cached.clone())
}

fn emit_cached_text_overlay_payload(app: &AppHandle) -> Result<(), String> {
    if let Some(payload) = cached_text_overlay_payload()? {
        app.emit_to(TEXT_WINDOW_LABEL, TEXT_EVENT, payload)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn should_ignore_text_overlay_payload(
    current: Option<&WidgetTextOverlayPayload>,
    next: &WidgetTextOverlayPayload,
) -> bool {
    let Some(current) = current else {
        return false;
    };

    let current_request_id = current.request_id.as_deref().unwrap_or_default();
    if current_request_id.is_empty() {
        return false;
    }

    if next.status == "dictating" {
        return false;
    }

    next.request_id.as_deref() != Some(current_request_id)
}

pub fn ensure_widget_notice_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(NOTICE_WINDOW_LABEL) {
        return Ok(win);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        NOTICE_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=widget-notice".into()),
    )
    .title("Talkis Notice")
    .inner_size(NOTICE_WIDTH, NOTICE_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .accept_first_mouse(true)
    .focused(false)
    .visible(false)
    .shadow(false);

    #[cfg(target_os = "linux")]
    {
        builder = builder.transparent(true).skip_taskbar(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.transparent(true).skip_taskbar(true);
    }

    let win = builder.build().map_err(|e| e.to_string())?;
    media_permissions::allow_microphone_requests(&win);

    Ok(win)
}

pub fn ensure_widget_text_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(TEXT_WINDOW_LABEL) {
        return Ok(win);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        TEXT_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=widget-text".into()),
    )
    .title("Talkis Text")
    .inner_size(TEXT_OVERLAY_WIDTH, TEXT_OVERLAY_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .accept_first_mouse(true)
    .focused(false)
    .visible(false)
    .shadow(false);

    #[cfg(target_os = "linux")]
    {
        builder = builder.transparent(true).skip_taskbar(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.transparent(true).skip_taskbar(true);
    }

    let win = builder.build().map_err(|e| e.to_string())?;
    media_permissions::allow_microphone_requests(&win);

    Ok(win)
}

/// Maximum expanded height for the notice bubble (logical px) — keeps a very long
/// hint from running off the top of the screen.
pub const NOTICE_MAX_HEIGHT: f64 = 360.0;

fn position_widget_notice_window(
    widget_window: &tauri::WebviewWindow,
    notice_window: &tauri::WebviewWindow,
    height: f64,
) -> Result<(), String> {
    let widget_position = widget_window.outer_position().map_err(|e| e.to_string())?;
    let widget_size = widget_window.outer_size().map_err(|e| e.to_string())?;
    let scale_factor = widget_window.scale_factor().map_err(|e| e.to_string())?;
    let notice_width = NOTICE_WIDTH * scale_factor;
    let notice_height = height * scale_factor;
    let notice_gap = NOTICE_GAP * scale_factor;
    let x = widget_position.x as f64 + (widget_size.width as f64 - notice_width) / 2.0;
    // Anchor the bubble's bottom edge just above the widget, so it grows upward.
    let y = widget_position.y as f64 - notice_gap - notice_height;

    notice_window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: NOTICE_WIDTH,
            height,
        }))
        .map_err(|e| e.to_string())?;

    notice_window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: x.round() as i32,
            y: y.round() as i32,
        }))
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn position_widget_text_window(
    widget_window: &tauri::WebviewWindow,
    text_window: &tauri::WebviewWindow,
    height: f64,
) -> Result<(), String> {
    let widget_position = widget_window.outer_position().map_err(|e| e.to_string())?;
    let widget_size = widget_window.outer_size().map_err(|e| e.to_string())?;
    let scale_factor = widget_window.scale_factor().map_err(|e| e.to_string())?;
    let text_width = TEXT_OVERLAY_WIDTH * scale_factor;
    let text_height = height * scale_factor;
    let gap = TEXT_OVERLAY_GAP * scale_factor;
    let x = widget_position.x as f64 + (widget_size.width as f64 - text_width) / 2.0;
    let y = widget_position.y as f64 - gap - text_height;

    text_window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: TEXT_OVERLAY_WIDTH,
            height,
        }))
        .map_err(|e| e.to_string())?;

    text_window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: x.round() as i32,
            y: y.round() as i32,
        }))
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn text_overlay_height(_payload: &WidgetTextOverlayPayload) -> f64 {
    TEXT_OVERLAY_HEIGHT
}

#[cfg(target_os = "macos")]
fn order_widget_window_front(app: &AppHandle) -> Result<(), String> {
    use objc2_app_kit::NSWindowCollectionBehavior;
    use std::sync::mpsc;

    let handle = app.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let Some(win) = handle.get_webview_window("widget") else {
                return Ok(());
            };

            unsafe {
                let ns_win: &objc2_app_kit::NSWindow =
                    &*win.ns_window().map_err(|e| e.to_string())?.cast();
                ns_win.setCollectionBehavior(
                    ns_win.collectionBehavior()
                        | NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                        | NSWindowCollectionBehavior::Stationary,
                );
                ns_win.orderFrontRegardless();
            }

            Ok(())
        })();

        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    rx.recv()
        .map_err(|e| format!("Failed to receive widget activation result: {}", e))?
}

#[cfg(target_os = "macos")]
fn resize_widget_window(
    app: &AppHandle,
    width: f64,
    height: f64,
    expanded_offset_ratio: f64,
) -> Result<(), String> {
    use std::sync::mpsc;

    let handle = app.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let Some(win) = handle.get_webview_window("widget") else {
                return Ok(());
            };

            unsafe {
                let ns_win: &objc2_app_kit::NSWindow =
                    &*win.ns_window().map_err(|e| e.to_string())?.cast();
                let frame = ns_win.frame();
                // NSWindow frames are measured in macOS points, matching Tauri
                // logical sizes. Do not multiply by scale factor here, or the
                // resize anchor drifts away from the visible widget center.
                let target_width = width;
                let target_height = height;
                let next_x = frame.origin.x
                    + centered_resize_offset(frame.size.width, target_width, expanded_offset_ratio);
                let next_y = frame.origin.y
                    + centered_resize_offset(
                        frame.size.height,
                        target_height,
                        expanded_offset_ratio,
                    );
                let next_frame = objc2_foundation::NSRect::new(
                    objc2_foundation::NSPoint::new(next_x, next_y),
                    objc2_foundation::NSSize::new(target_width, target_height),
                );

                ns_win.setFrame_display(next_frame, true);
            }

            Ok(())
        })();

        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    rx.recv()
        .map_err(|e| format!("Failed to receive resize result: {}", e))?
}

#[cfg(not(target_os = "macos"))]
fn calculate_default_widget_position(
    monitor: &tauri::Monitor,
    width: f64,
    height: f64,
) -> tauri::PhysicalPosition<i32> {
    let scale_factor = monitor.scale_factor();
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let target_width = width * scale_factor;
    let target_height = height * scale_factor;
    let x = monitor_position.x as f64 + (monitor_size.width as f64 - target_width) / 2.0;
    let y = monitor_position.y as f64 + monitor_size.height as f64 - target_height;

    tauri::PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }
}

#[cfg(not(target_os = "macos"))]
fn resize_widget_window(
    app: &AppHandle,
    width: f64,
    height: f64,
    expanded_offset_ratio: f64,
) -> Result<(), String> {
    use crate::logger;

    if let Some(win) = app.get_webview_window("widget") {
        let current_position = win.outer_position().ok();
        let current_size = win.outer_size().ok();
        let scale_factor = win.scale_factor().unwrap_or(1.0);

        if let Err(err) = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })) {
            logger::log_error(
                "WINDOW",
                &format!("Failed to resize widget window: {}", err),
            );
        }

        if let (Some(position), Some(size)) = (current_position, current_size) {
            let target_width = width * scale_factor;
            let target_height = height * scale_factor;
            let x = position.x as f64
                + centered_resize_offset(size.width as f64, target_width, expanded_offset_ratio);
            let y = position.y as f64
                + centered_resize_offset(size.height as f64, target_height, expanded_offset_ratio);

            if let Err(err) = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: x.round() as i32,
                y: y.round() as i32,
            })) {
                logger::log_error(
                    "WINDOW",
                    &format!("Failed to preserve widget position on resize: {}", err),
                );
            }
        } else if let Ok(Some(monitor)) = win.primary_monitor() {
            let position = calculate_default_widget_position(&monitor, width, height);
            if let Err(err) = win.set_position(tauri::Position::Physical(position)) {
                logger::log_error(
                    "WINDOW",
                    &format!("Failed to reposition widget window: {}", err),
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn show_widget_notice(
    app: AppHandle,
    message: String,
    tone: String,
    _anchor_state: String,
) -> Result<(), String> {
    let widget_window = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window not found".to_string())?;
    let notice_window = ensure_widget_notice_window(&app)?;

    // Always (re)show collapsed; the overlay expands on click.
    position_widget_notice_window(&widget_window, &notice_window, NOTICE_HEIGHT)?;

    app.emit_to(
        NOTICE_WINDOW_LABEL,
        NOTICE_EVENT,
        WidgetNoticePayload { message, tone },
    )
    .map_err(|e| e.to_string())?;

    let _ = notice_window.set_ignore_cursor_events(false);
    notice_window.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn hide_widget_notice(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(NOTICE_WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn show_widget_text_overlay(
    app: AppHandle,
    payload: WidgetTextOverlayPayload,
) -> Result<(), String> {
    {
        let mut cached = text_overlay_payload_store()
            .lock()
            .map_err(|e| format!("Text overlay state lock failed: {e}"))?;
        if should_ignore_text_overlay_payload(cached.as_ref(), &payload) {
            return Ok(());
        }
        *cached = Some(payload.clone());
    }

    let widget_window = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window not found".to_string())?;
    let text_window = ensure_widget_text_window(&app)?;

    position_widget_text_window(&widget_window, &text_window, text_overlay_height(&payload))?;
    let _ = text_window.set_ignore_cursor_events(false);

    app.emit_to(TEXT_WINDOW_LABEL, TEXT_EVENT, payload)
        .map_err(|e| e.to_string())?;
    text_window.show().map_err(|e| e.to_string())?;
    let _ = emit_cached_text_overlay_payload(&app);
    Ok(())
}

#[tauri::command]
pub async fn widget_text_overlay_ready(app: AppHandle) -> Result<(), String> {
    emit_cached_text_overlay_payload(&app)
}

#[tauri::command]
pub async fn get_widget_text_overlay_payload() -> Result<Option<WidgetTextOverlayPayload>, String> {
    cached_text_overlay_payload()
}

#[tauri::command]
pub async fn hide_widget_text_overlay(app: AppHandle) -> Result<(), String> {
    {
        let mut cached = text_overlay_payload_store()
            .lock()
            .map_err(|e| format!("Text overlay state lock failed: {e}"))?;
        *cached = None;
    }

    if let Some(win) = app.get_webview_window(TEXT_WINDOW_LABEL) {
        let _ = app.emit_to(
            TEXT_WINDOW_LABEL,
            TEXT_EVENT,
            Option::<WidgetTextOverlayPayload>::None,
        );
        win.hide().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Resize the notice bubble to fit its full text on click (or back to the
/// collapsed height). Re-anchors above the widget so it grows upward.
#[tauri::command]
pub async fn expand_widget_notice(app: AppHandle, height: f64) -> Result<(), String> {
    let widget_window = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window not found".to_string())?;
    let notice_window = app
        .get_webview_window(NOTICE_WINDOW_LABEL)
        .ok_or_else(|| "Notice window not found".to_string())?;
    let clamped = height.clamp(NOTICE_HEIGHT, NOTICE_MAX_HEIGHT);
    position_widget_notice_window(&widget_window, &notice_window, clamped)
}

#[tauri::command]
pub async fn widget_resize(
    app: AppHandle,
    width: f64,
    height: f64,
    growth_offset_ratio: Option<f64>,
) -> Result<(), String> {
    let expanded_offset_ratio = growth_offset_ratio
        .unwrap_or(WIDGET_EXPANDED_OFFSET_RATIO)
        .clamp(0.0, 1.0);
    resize_widget_window(&app, width, height, expanded_offset_ratio)
}

#[tauri::command]
pub async fn activate_widget_for_hotkey(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    crate::paste::remember_linux_paste_target_window();

    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window not found".to_string())?;

    let _ = win.unminimize();
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);

    #[cfg(target_os = "macos")]
    order_widget_window_front(&app)?;

    Ok(())
}
