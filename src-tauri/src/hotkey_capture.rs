#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::ptr;
    use std::rc::Rc;
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    const HOTKEY_CAPTURE_EVENT: &str = "native-hotkey-capture";

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NativeHotkeyCapturePayload {
        request_id: String,
        target: String,
        status: String,
        hotkey: Option<String>,
        message: Option<String>,
    }

    struct CaptureRuntime {
        app: AppHandle,
        window_label: String,
        request_id: String,
        target: String,
        active: bool,
        candidate: Option<String>,
        main_key: Option<String>,
        main_key_code: Option<u16>,
        main_released: bool,
        captured_flags: NSEventModifierFlags,
        last_preview: Option<String>,
    }

    struct NativeHotkeyCaptureMonitor {
        monitor: Retained<AnyObject>,
        _block: RcBlock<dyn Fn(std::ptr::NonNull<NSEvent>) -> *mut NSEvent>,
        _runtime: Rc<RefCell<CaptureRuntime>>,
    }

    thread_local! {
        static HOTKEY_CAPTURE_MONITOR: RefCell<Option<NativeHotkeyCaptureMonitor>> = const { RefCell::new(None) };
    }

    fn emit_capture_event(
        app: &AppHandle,
        window_label: &str,
        request_id: &str,
        target: &str,
        status: &str,
        hotkey: Option<String>,
        message: Option<String>,
    ) {
        let _ = app.emit_to(
            window_label,
            HOTKEY_CAPTURE_EVENT,
            NativeHotkeyCapturePayload {
                request_id: request_id.to_string(),
                target: target.to_string(),
                status: status.to_string(),
                hotkey,
                message,
            },
        );
    }

    fn with_runtime_context(
        runtime: &Rc<RefCell<CaptureRuntime>>,
    ) -> (AppHandle, String, String, String) {
        let runtime_ref = runtime.borrow();
        (
            runtime_ref.app.clone(),
            runtime_ref.window_label.clone(),
            runtime_ref.request_id.clone(),
            runtime_ref.target.clone(),
        )
    }

    fn build_hotkey_string(flags: NSEventModifierFlags, main_key: Option<&str>) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let normalized_flags = flags & NSEventModifierFlags::DeviceIndependentFlagsMask;

        if normalized_flags.contains(NSEventModifierFlags::Control) {
            parts.push("Control");
        }
        if normalized_flags.contains(NSEventModifierFlags::Option) {
            parts.push("Alt");
        }
        if normalized_flags.contains(NSEventModifierFlags::Shift) {
            parts.push("Shift");
        }
        if normalized_flags.contains(NSEventModifierFlags::Command) {
            parts.push("Command");
        }
        if let Some(main_key) = main_key {
            parts.push(main_key);
        }

        parts.join("+")
    }

    fn supported_modifier_flags(flags: NSEventModifierFlags) -> NSEventModifierFlags {
        (flags & NSEventModifierFlags::DeviceIndependentFlagsMask)
            & (NSEventModifierFlags::Control
                | NSEventModifierFlags::Option
                | NSEventModifierFlags::Shift
                | NSEventModifierFlags::Command)
    }

    fn has_any_supported_modifier(flags: NSEventModifierFlags) -> bool {
        supported_modifier_flags(flags).intersects(
            NSEventModifierFlags::Control
                | NSEventModifierFlags::Option
                | NSEventModifierFlags::Shift
                | NSEventModifierFlags::Command,
        )
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum ChordCompletion {
        Wait,
        Reject,
        Complete,
    }

    fn chord_completion(
        main_released: bool,
        active_flags: NSEventModifierFlags,
        captured_flags: NSEventModifierFlags,
    ) -> ChordCompletion {
        if !main_released || !supported_modifier_flags(active_flags).is_empty() {
            ChordCompletion::Wait
        } else if supported_modifier_flags(captured_flags).is_empty() {
            ChordCompletion::Reject
        } else {
            ChordCompletion::Complete
        }
    }

    fn main_key_from_key_code(key_code: u16) -> Option<&'static str> {
        match key_code {
            0x00 => Some("A"),
            0x0b => Some("B"),
            0x08 => Some("C"),
            0x02 => Some("D"),
            0x0e => Some("E"),
            0x03 => Some("F"),
            0x05 => Some("G"),
            0x04 => Some("H"),
            0x22 => Some("I"),
            0x26 => Some("J"),
            0x28 => Some("K"),
            0x25 => Some("L"),
            0x2e => Some("M"),
            0x2d => Some("N"),
            0x1f => Some("O"),
            0x23 => Some("P"),
            0x0c => Some("Q"),
            0x0f => Some("R"),
            0x01 => Some("S"),
            0x11 => Some("T"),
            0x20 => Some("U"),
            0x09 => Some("V"),
            0x0d => Some("W"),
            0x07 => Some("X"),
            0x10 => Some("Y"),
            0x06 => Some("Z"),
            0x1d => Some("0"),
            0x12 => Some("1"),
            0x13 => Some("2"),
            0x14 => Some("3"),
            0x15 => Some("4"),
            0x17 => Some("5"),
            0x16 => Some("6"),
            0x1a => Some("7"),
            0x1c => Some("8"),
            0x19 => Some("9"),
            0x24 => Some("Enter"),
            0x31 => Some("Space"),
            0x60 => Some("F5"),
            0x61 => Some("F6"),
            0x62 => Some("F7"),
            0x63 => Some("F3"),
            0x64 => Some("F8"),
            0x65 => Some("F9"),
            0x67 => Some("F11"),
            0x6d => Some("F10"),
            0x6f => Some("F12"),
            0x76 => Some("F4"),
            0x78 => Some("F2"),
            0x7a => Some("F1"),
            0x7b => Some("Left"),
            0x7c => Some("Right"),
            0x7d => Some("Down"),
            0x7e => Some("Up"),
            _ => None,
        }
    }

    fn stop_capture_on_main_thread() {
        HOTKEY_CAPTURE_MONITOR.with(|slot| {
            if let Some(existing) = slot.borrow_mut().take() {
                unsafe {
                    NSEvent::removeMonitor(&existing.monitor);
                }
            }
        });
    }

    fn handle_capture_event(
        event_ptr: std::ptr::NonNull<NSEvent>,
        runtime: &Rc<RefCell<CaptureRuntime>>,
    ) -> *mut NSEvent {
        let event = unsafe { event_ptr.as_ref() };
        let event_type = event.r#type();
        let flags = event.modifierFlags();
        let key_code = event.keyCode();
        let main_key = main_key_from_key_code(key_code);

        let (app, window_label, request_id, target, active, last_preview) = {
            let runtime_ref = runtime.borrow();
            (
                runtime_ref.app.clone(),
                runtime_ref.window_label.clone(),
                runtime_ref.request_id.clone(),
                runtime_ref.target.clone(),
                runtime_ref.active,
                runtime_ref.last_preview.clone(),
            )
        };

        if !active {
            return event_ptr.as_ptr();
        }

        if event_type == NSEventType::KeyDown {
            if key_code == 0x35 && !has_any_supported_modifier(flags) {
                {
                    let mut runtime_ref = runtime.borrow_mut();
                    runtime_ref.active = false;
                    runtime_ref.candidate = None;
                    runtime_ref.main_key = None;
                    runtime_ref.main_key_code = None;
                    runtime_ref.main_released = false;
                    runtime_ref.captured_flags = NSEventModifierFlags::empty();
                    runtime_ref.last_preview = None;
                }
                emit_capture_event(
                    &app,
                    &window_label,
                    &request_id,
                    &target,
                    "cancelled",
                    None,
                    Some("Ввод отменен.".to_string()),
                );
                return ptr::null_mut();
            }

            if event.isARepeat() {
                return ptr::null_mut();
            }

            if let Some(main_key) = main_key {
                let candidate = {
                    let mut runtime_ref = runtime.borrow_mut();
                    if runtime_ref.main_key_code.is_some()
                        && runtime_ref.main_key_code != Some(key_code)
                    {
                        return ptr::null_mut();
                    }

                    runtime_ref.main_key = Some(main_key.to_string());
                    runtime_ref.main_key_code = Some(key_code);
                    runtime_ref.main_released = false;
                    runtime_ref.captured_flags =
                        runtime_ref.captured_flags | supported_modifier_flags(flags);
                    let candidate = build_hotkey_string(
                        runtime_ref.captured_flags,
                        runtime_ref.main_key.as_deref(),
                    );
                    runtime_ref.candidate = Some(candidate.clone());
                    runtime_ref.last_preview = Some(candidate.clone());
                    candidate
                };
                emit_capture_event(
                    &app,
                    &window_label,
                    &request_id,
                    &target,
                    "preview",
                    Some(candidate),
                    Some("Отпустите все клавиши, чтобы применить сочетание.".to_string()),
                );
                return ptr::null_mut();
            }

            return ptr::null_mut();
        }

        if event_type == NSEventType::FlagsChanged {
            let normalized_flags = supported_modifier_flags(flags);
            let preview = {
                let mut runtime_ref = runtime.borrow_mut();
                if runtime_ref.main_key.is_some() && !normalized_flags.is_empty() {
                    runtime_ref.captured_flags = runtime_ref.captured_flags | normalized_flags;
                    let candidate = build_hotkey_string(
                        runtime_ref.captured_flags,
                        runtime_ref.main_key.as_deref(),
                    );
                    runtime_ref.candidate = Some(candidate.clone());
                    Some((candidate, true))
                } else if runtime_ref.main_key.is_none() && !normalized_flags.is_empty() {
                    Some((build_hotkey_string(normalized_flags, None), false))
                } else {
                    None
                }
            };

            if let Some((preview, has_main_key)) = preview {
                if Some(preview.clone()) != last_preview {
                    runtime.borrow_mut().last_preview = Some(preview.clone());
                    emit_capture_event(
                        &app,
                        &window_label,
                        &request_id,
                        &target,
                        "preview",
                        Some(preview),
                        Some(
                            if has_main_key {
                                "Отпустите все клавиши, чтобы применить сочетание."
                            } else {
                                "Добавьте основную клавишу."
                            }
                            .to_string(),
                        ),
                    );
                }
                return ptr::null_mut();
            }

            let completion = {
                let mut runtime_ref = runtime.borrow_mut();
                if chord_completion(
                    runtime_ref.main_released,
                    normalized_flags,
                    runtime_ref.captured_flags,
                ) != ChordCompletion::Wait
                {
                    let candidate = runtime_ref.candidate.clone();
                    if chord_completion(
                        runtime_ref.main_released,
                        normalized_flags,
                        runtime_ref.captured_flags,
                    ) == ChordCompletion::Reject
                    {
                        runtime_ref.candidate = None;
                        runtime_ref.main_key = None;
                        runtime_ref.main_key_code = None;
                        runtime_ref.main_released = false;
                        runtime_ref.last_preview = None;
                        Some((candidate, false))
                    } else {
                        runtime_ref.active = false;
                        Some((candidate, true))
                    }
                } else {
                    None
                }
            };
            if let Some((candidate, valid)) = completion {
                emit_capture_event(
                    &app,
                    &window_label,
                    &request_id,
                    &target,
                    if valid { "completed" } else { "preview" },
                    candidate,
                    if valid {
                        None
                    } else {
                        Some("Добавьте хотя бы один модификатор.".to_string())
                    },
                );
            }
            return ptr::null_mut();
        }

        if event_type == NSEventType::KeyUp {
            let completion = {
                let mut runtime_ref = runtime.borrow_mut();
                if runtime_ref.main_key_code != Some(key_code) {
                    None
                } else {
                    runtime_ref.main_released = true;
                    if chord_completion(
                        runtime_ref.main_released,
                        flags,
                        runtime_ref.captured_flags,
                    ) == ChordCompletion::Wait
                    {
                        None
                    } else {
                        let candidate = runtime_ref.candidate.clone();
                        if chord_completion(
                            runtime_ref.main_released,
                            flags,
                            runtime_ref.captured_flags,
                        ) == ChordCompletion::Reject
                        {
                            runtime_ref.candidate = None;
                            runtime_ref.main_key = None;
                            runtime_ref.main_key_code = None;
                            runtime_ref.main_released = false;
                            runtime_ref.last_preview = None;
                            Some((candidate, false))
                        } else {
                            runtime_ref.active = false;
                            Some((candidate, true))
                        }
                    }
                }
            };
            if let Some((candidate, valid)) = completion {
                emit_capture_event(
                    &app,
                    &window_label,
                    &request_id,
                    &target,
                    if valid { "completed" } else { "preview" },
                    candidate,
                    if valid {
                        None
                    } else {
                        Some("Добавьте хотя бы один модификатор.".to_string())
                    },
                );
            }

            return ptr::null_mut();
        }

        event_ptr.as_ptr()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn waits_until_main_key_and_all_modifiers_are_released() {
            let command = NSEventModifierFlags::Command;
            assert_eq!(
                chord_completion(false, NSEventModifierFlags::empty(), command),
                ChordCompletion::Wait
            );
            assert_eq!(
                chord_completion(true, command, command),
                ChordCompletion::Wait
            );
            assert_eq!(
                chord_completion(true, NSEventModifierFlags::empty(), command),
                ChordCompletion::Complete
            );
        }

        #[test]
        fn rejects_a_main_key_without_modifiers() {
            assert_eq!(
                chord_completion(
                    true,
                    NSEventModifierFlags::empty(),
                    NSEventModifierFlags::empty(),
                ),
                ChordCompletion::Reject
            );
        }

        #[test]
        fn supports_only_documented_main_keys() {
            assert_eq!(main_key_from_key_code(0x00), Some("A"));
            assert_eq!(main_key_from_key_code(0x24), Some("Enter"));
            assert_eq!(main_key_from_key_code(0x31), Some("Space"));
            assert_eq!(main_key_from_key_code(0x7b), Some("Left"));
            assert_eq!(main_key_from_key_code(0x7a), Some("F1"));
            assert_eq!(main_key_from_key_code(0x30), None);
            assert_eq!(main_key_from_key_code(0x35), None);
        }
    }

    pub fn start_capture(
        window: &WebviewWindow,
        request_id: String,
        target: String,
    ) -> Result<(), String> {
        if request_id.trim().is_empty() {
            return Err("Hotkey capture requestId is required".to_string());
        }
        if target != "dictation" && target != "selection" {
            return Err(format!("Unsupported hotkey target: {}", target));
        }
        let app = window.app_handle().clone();
        let window_label = window.label().to_string();
        let (tx, rx) = mpsc::channel();
        let app_for_main_thread = app.clone();

        app_for_main_thread
            .run_on_main_thread(move || {
                let result = (|| -> Result<(), String> {
                    stop_capture_on_main_thread();

                    let runtime = Rc::new(RefCell::new(CaptureRuntime {
                        app: app.clone(),
                        window_label: window_label.clone(),
                        request_id: request_id.clone(),
                        target: target.clone(),
                        active: true,
                        candidate: None,
                        main_key: None,
                        main_key_code: None,
                        main_released: false,
                        captured_flags: NSEventModifierFlags::empty(),
                        last_preview: None,
                    }));
                    let runtime_for_block = runtime.clone();
                    let block: RcBlock<dyn Fn(std::ptr::NonNull<NSEvent>) -> *mut NSEvent> =
                        RcBlock::new(move |event| handle_capture_event(event, &runtime_for_block));
                    let monitor = unsafe {
                        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                            NSEventMask::KeyDown | NSEventMask::KeyUp | NSEventMask::FlagsChanged,
                            &block,
                        )
                    }
                    .ok_or_else(|| "Failed to start native hotkey capture".to_string())?;

                    HOTKEY_CAPTURE_MONITOR.with(|slot| {
                        *slot.borrow_mut() = Some(NativeHotkeyCaptureMonitor {
                            monitor,
                            _block: block,
                            _runtime: runtime,
                        });
                    });

                    let (app, window_label, request_id, target) =
                        with_runtime_context(&HOTKEY_CAPTURE_MONITOR.with(|slot| {
                            slot.borrow()
                                .as_ref()
                                .expect("capture monitor just inserted")
                                ._runtime
                                .clone()
                        }));
                    emit_capture_event(
                        &app,
                        &window_label,
                        &request_id,
                        &target,
                        "listening",
                        None,
                        Some("Нажмите новую комбинацию.".to_string()),
                    );

                    Ok(())
                })();

                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;

        rx.recv()
            .map_err(|e| format!("Failed to receive hotkey capture start result: {}", e))?
    }

    pub fn stop_capture(
        window: &WebviewWindow,
        request_id: String,
        target: String,
    ) -> Result<(), String> {
        let app = window.app_handle().clone();
        let window_label = window.label().to_string();
        let (tx, rx) = mpsc::channel();
        let app_for_main_thread = app.clone();

        app_for_main_thread
            .run_on_main_thread(move || {
                stop_capture_on_main_thread();
                emit_capture_event(
                    &app,
                    &window_label,
                    &request_id,
                    &target,
                    "stopped",
                    None,
                    None,
                );
                let _ = tx.send(Ok(()));
            })
            .map_err(|e| e.to_string())?;

        rx.recv()
            .map_err(|e| format!("Failed to receive hotkey capture stop result: {}", e))?
    }
}

#[cfg(target_os = "macos")]
pub use macos::{start_capture, stop_capture};

#[cfg(not(target_os = "macos"))]
pub fn start_capture(
    _window: &tauri::WebviewWindow,
    _request_id: String,
    _target: String,
) -> Result<(), String> {
    Err("Native hotkey capture is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn stop_capture(
    _window: &tauri::WebviewWindow,
    _request_id: String,
    _target: String,
) -> Result<(), String> {
    Ok(())
}
