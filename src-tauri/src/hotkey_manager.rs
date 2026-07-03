use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};

use handy_keys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::logger;

pub const HANDY_HOTKEY_EVENT: &str = "handy-hotkey-event";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandyHotkeyEventPayload {
    hotkey: String,
    state: String,
}

enum HotkeyCommand {
    Register {
        hotkey: String,
        response: Sender<Result<(), String>>,
    },
    Unregister {
        hotkey: Option<String>,
        response: Sender<Result<(), String>>,
    },
    Shutdown,
}

pub struct HandyHotkeyState {
    command_sender: Mutex<Sender<HotkeyCommand>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

struct ActiveHotkey {
    id: HotkeyId,
    value: String,
}

impl HandyHotkeyState {
    pub fn new(app: AppHandle) -> Self {
        let (command_sender, command_receiver) = mpsc::channel();
        let thread_handle = thread::spawn(move || run_hotkey_thread(app, command_receiver));

        Self {
            command_sender: Mutex::new(command_sender),
            thread_handle: Mutex::new(Some(thread_handle)),
        }
    }

    fn send_command(&self, command: HotkeyCommand) -> Result<(), String> {
        self.command_sender
            .lock()
            .map_err(|_| "Не удалось заблокировать hotkey sender".to_string())?
            .send(command)
            .map_err(|_| "Hotkey manager не запущен".to_string())
    }
}

impl Drop for HandyHotkeyState {
    fn drop(&mut self) {
        if let Ok(sender) = self.command_sender.lock() {
            let _ = sender.send(HotkeyCommand::Shutdown);
        }

        if let Ok(mut handle) = self.thread_handle.lock() {
            if let Some(handle) = handle.take() {
                let _ = handle.join();
            }
        }
    }
}

pub fn init(app: &tauri::App) {
    app.manage(HandyHotkeyState::new(app.handle().clone()));
}

#[tauri::command]
pub fn register_handy_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    let state = app
        .try_state::<HandyHotkeyState>()
        .ok_or_else(|| "Handy hotkey manager не инициализирован".to_string())?;
    let (response_sender, response_receiver) = mpsc::channel();

    state.send_command(HotkeyCommand::Register {
        hotkey,
        response: response_sender,
    })?;

    response_receiver
        .recv()
        .map_err(|_| "Hotkey manager не вернул ответ".to_string())?
}

#[tauri::command]
pub fn unregister_handy_hotkey(app: AppHandle, hotkey: Option<String>) -> Result<(), String> {
    let state = app
        .try_state::<HandyHotkeyState>()
        .ok_or_else(|| "Handy hotkey manager не инициализирован".to_string())?;
    let (response_sender, response_receiver) = mpsc::channel();

    state.send_command(HotkeyCommand::Unregister {
        hotkey,
        response: response_sender,
    })?;

    response_receiver
        .recv()
        .map_err(|_| "Hotkey manager не вернул ответ".to_string())?
}

fn run_hotkey_thread(app: AppHandle, command_receiver: Receiver<HotkeyCommand>) {
    logger::log_info("HOTKEY", "Starting handy-keys manager thread");

    let manager_result = HotkeyManager::new_with_blocking()
        .map_err(|err| format!("Не удалось запустить handy-keys: {}", err));
    let mut active_hotkey: Option<ActiveHotkey> = None;

    loop {
        if let Ok(manager) = manager_result.as_ref() {
            while let Some(event) = manager.try_recv() {
                let Some(active) = active_hotkey.as_ref() else {
                    continue;
                };
                if event.id != active.id {
                    continue;
                }

                let state = match event.state {
                    HotkeyState::Pressed => "Pressed",
                    HotkeyState::Released => "Released",
                };
                let payload = HandyHotkeyEventPayload {
                    hotkey: active.value.clone(),
                    state: state.to_string(),
                };
                let _ = app.emit(HANDY_HOTKEY_EVENT, payload);
            }
        }

        match command_receiver.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(command) => {
                if matches!(command, HotkeyCommand::Shutdown) {
                    break;
                }

                let result = match manager_result.as_ref() {
                    Ok(manager) => handle_command(manager, command, &mut active_hotkey),
                    Err(err) => reply_manager_error(command, err),
                };

                if let Err(err) = result {
                    logger::log_error("HOTKEY", &err);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    logger::log_info("HOTKEY", "Stopped handy-keys manager thread");
}

fn handle_command(
    manager: &HotkeyManager,
    command: HotkeyCommand,
    active_hotkey: &mut Option<ActiveHotkey>,
) -> Result<(), String> {
    match command {
        HotkeyCommand::Register { hotkey, response } => {
            let result = register_hotkey(manager, active_hotkey, &hotkey);
            let _ = response.send(result.clone());
            result
        }
        HotkeyCommand::Unregister { hotkey, response } => {
            let result = unregister_hotkey(manager, active_hotkey, hotkey.as_deref());
            let _ = response.send(result.clone());
            result
        }
        HotkeyCommand::Shutdown => Ok(()),
    }
}

fn reply_manager_error(command: HotkeyCommand, err: &str) -> Result<(), String> {
    let result = Err(err.to_string());
    match command {
        HotkeyCommand::Register { response, .. } | HotkeyCommand::Unregister { response, .. } => {
            let _ = response.send(result.clone());
        }
        HotkeyCommand::Shutdown => {}
    }
    result
}

fn register_hotkey(
    manager: &HotkeyManager,
    active_hotkey: &mut Option<ActiveHotkey>,
    raw_hotkey: &str,
) -> Result<(), String> {
    let hotkey_value = normalize_for_handy_keys(raw_hotkey);
    if active_hotkey
        .as_ref()
        .is_some_and(|active| active.value == hotkey_value)
    {
        return Ok(());
    }

    let hotkey = hotkey_value.parse::<Hotkey>().map_err(|err| {
        format!(
            "Не удалось разобрать горячую клавишу «{}»: {}",
            raw_hotkey, err
        )
    })?;
    let next_id = manager
        .register(hotkey)
        .map_err(|err| format!("Не удалось зарегистрировать «{}»: {}", raw_hotkey, err))?;

    if let Some(previous) = active_hotkey.replace(ActiveHotkey {
        id: next_id,
        value: hotkey_value.clone(),
    }) {
        let _ = manager.unregister(previous.id);
    }

    logger::log_info(
        "HOTKEY",
        &format!("Registered handy-keys hotkey: {}", hotkey_value),
    );
    Ok(())
}

fn unregister_hotkey(
    manager: &HotkeyManager,
    active_hotkey: &mut Option<ActiveHotkey>,
    raw_hotkey: Option<&str>,
) -> Result<(), String> {
    let should_unregister = match (active_hotkey.as_ref(), raw_hotkey) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(active), Some(value)) => active.value == normalize_for_handy_keys(value),
    };

    if !should_unregister {
        return Ok(());
    }

    if let Some(previous) = active_hotkey.take() {
        manager
            .unregister(previous.id)
            .map_err(|err| format!("Не удалось снять hotkey «{}»: {}", previous.value, err))?;
        logger::log_info(
            "HOTKEY",
            &format!("Unregistered handy-keys hotkey: {}", previous.value),
        );
    }

    Ok(())
}

fn normalize_for_handy_keys(raw_hotkey: &str) -> String {
    raw_hotkey
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "control" => "Ctrl".to_string(),
            "command" | "meta" => "Cmd".to_string(),
            "option" => "Alt".to_string(),
            other if other.len() == 1 => other.to_ascii_uppercase(),
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::normalize_for_handy_keys;

    #[test]
    fn normalizes_talkis_hotkey_labels_for_handy_keys() {
        assert_eq!(
            normalize_for_handy_keys("Control+Alt+Shift+Space"),
            "Ctrl+Alt+Shift+Space"
        );
        assert_eq!(normalize_for_handy_keys("Command+K"), "Cmd+K");
    }
}
