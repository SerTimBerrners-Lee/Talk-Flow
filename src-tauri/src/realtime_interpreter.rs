use crate::logger;
#[cfg(test)]
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
#[cfg(test)]
use std::collections::VecDeque;
use std::f32::consts::TAU;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DEFAULT_REALTIME_MODEL: &str = "gpt-realtime-translate";
const ESTIMATED_ONE_DIRECTION_USD_PER_MIN: f32 = 0.034;
const ESTIMATED_TWO_DIRECTION_USD_PER_MIN: f32 = ESTIMATED_ONE_DIRECTION_USD_PER_MIN * 2.0;
const TEST_TONE_DURATION_MS: u64 = 650;

static STATUS: OnceLock<Mutex<RealtimeInterpreterStatus>> = OnceLock::new();

fn status_slot() -> &'static Mutex<RealtimeInterpreterStatus> {
    STATUS.get_or_init(|| Mutex::new(RealtimeInterpreterStatus::idle()))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAudioDevices {
    pub platform: String,
    pub virtual_driver_name: String,
    pub real_mics: Vec<RealtimeAudioDevice>,
    pub virtual_mic_outputs: Vec<RealtimeAudioDevice>,
    pub local_playback_outputs: Vec<RealtimeAudioDevice>,
    pub system_audio_sources: Vec<RealtimeAudioDevice>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAudioDevice {
    pub id: String,
    pub label: String,
    pub kind: RealtimeAudioDeviceKind,
    pub platform: String,
    pub is_default: bool,
    pub is_virtual: bool,
    pub driver_hint: Option<String>,
    pub supported: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeAudioDeviceKind {
    RealMic,
    VirtualMicOutput,
    LocalPlayback,
    SystemAudio,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRealtimeInterpreterRequest {
    pub real_mic_device_id: Option<String>,
    pub virtual_mic_output_device_id: String,
    pub local_playback_device_id: Option<String>,
    #[serde(default)]
    pub language_pair: RealtimeLanguagePair,
    #[serde(default)]
    pub api_mode: RealtimeApiMode,
    pub api_key: Option<String>,
    pub device_token: Option<String>,
    pub model: Option<String>,
    pub endpoint: Option<String>,
    #[serde(default)]
    pub headphones_confirmed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeLanguagePair {
    RuEn,
}

impl Default for RealtimeLanguagePair {
    fn default() -> Self {
        Self::RuEn
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeApiMode {
    Api,
    Cloud,
}

impl Default for RealtimeApiMode {
    fn default() -> Self {
        Self::Api
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestVirtualMicOutputRequest {
    pub device_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInterpreterStatus {
    pub active: bool,
    pub state: RealtimeInterpreterState,
    pub session_id: Option<String>,
    pub platform: String,
    pub started_at: Option<String>,
    pub language_pair: RealtimeLanguagePair,
    pub model: String,
    pub endpoint: Option<String>,
    pub message: Option<String>,
    pub last_error: Option<String>,
    pub user_to_remote: RealtimeInterpreterDirectionStatus,
    pub remote_to_user: RealtimeInterpreterDirectionStatus,
    pub estimated_cost_usd_per_minute: f32,
    pub session_restart_at: Option<String>,
}

impl RealtimeInterpreterStatus {
    fn idle() -> Self {
        Self {
            active: false,
            state: RealtimeInterpreterState::Idle,
            session_id: None,
            platform: platform_name().to_string(),
            started_at: None,
            language_pair: RealtimeLanguagePair::RuEn,
            model: DEFAULT_REALTIME_MODEL.to_string(),
            endpoint: None,
            message: Some("Realtime Interpreter не запущен.".to_string()),
            last_error: None,
            user_to_remote: RealtimeInterpreterDirectionStatus::idle(),
            remote_to_user: RealtimeInterpreterDirectionStatus::idle(),
            estimated_cost_usd_per_minute: ESTIMATED_TWO_DIRECTION_USD_PER_MIN,
            session_restart_at: None,
        }
    }

    fn error(message: String, req: Option<&StartRealtimeInterpreterRequest>) -> Self {
        let mut status = Self::idle();
        status.state = RealtimeInterpreterState::Error;
        status.message = Some(message.clone());
        status.last_error = Some(message);

        if let Some(req) = req {
            status.language_pair = req.language_pair.clone();
            status.model = req
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(DEFAULT_REALTIME_MODEL)
                .to_string();
            status.endpoint = req
                .endpoint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
        }

        status
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeInterpreterState {
    Idle,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInterpreterDirectionStatus {
    pub state: RealtimeInterpreterState,
    pub reconnect_attempts: u32,
    pub input_level: f32,
    pub output_level: f32,
    pub last_text: Option<String>,
    pub last_error: Option<String>,
}

impl RealtimeInterpreterDirectionStatus {
    fn idle() -> Self {
        Self {
            state: RealtimeInterpreterState::Idle,
            reconnect_attempts: 0,
            input_level: 0.0,
            output_level: 0.0,
            last_text: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInterpreterErrorEvent {
    pub session_id: Option<String>,
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RealtimeInterpreterPartialTextEvent {
    pub session_id: Option<String>,
    pub direction: RealtimeInterpreterDirection,
    pub text: String,
    pub is_final: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RealtimeInterpreterAudioLevelEvent {
    pub session_id: Option<String>,
    pub direction: RealtimeInterpreterDirection,
    pub input_level: f32,
    pub output_level: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum RealtimeInterpreterDirection {
    UserToRemote,
    RemoteToUser,
}

#[tauri::command]
pub async fn list_realtime_audio_devices() -> Result<RealtimeAudioDevices, String> {
    Ok(discover_realtime_audio_devices())
}

#[tauri::command]
pub async fn get_realtime_interpreter_status() -> Result<RealtimeInterpreterStatus, String> {
    status_slot()
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Не удалось прочитать статус Realtime Interpreter.".to_string())
}

#[tauri::command]
pub async fn start_realtime_interpreter(
    app: AppHandle,
    req: StartRealtimeInterpreterRequest,
) -> Result<RealtimeInterpreterStatus, String> {
    let devices = discover_realtime_audio_devices();
    if let Err(message) = validate_start_request(&req, &devices) {
        return fail_start(&app, &req, "validation_failed", message, true);
    }

    logger::log_info(
        "REALTIME_INTERPRETER",
        &format!(
            "Validated start request: platform={}, model={}, language_pair={:?}, virtual_output={}",
            platform_name(),
            req.model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(DEFAULT_REALTIME_MODEL),
            req.language_pair,
            req.virtual_mic_output_device_id
        ),
    );

    fail_start(
        &app,
        &req,
        "transport_not_enabled",
        "Realtime Interpreter подготовлен как отдельный модуль, но потоковый транспорт OpenAI WebSocket и platform audio routing ещё не включены в этой сборке.".to_string(),
        false,
    )
}

#[tauri::command]
pub async fn stop_realtime_interpreter(
    app: AppHandle,
) -> Result<RealtimeInterpreterStatus, String> {
    let status = RealtimeInterpreterStatus::idle();
    set_status(&app, status.clone())?;
    logger::log_info("REALTIME_INTERPRETER", "Realtime Interpreter stopped");
    Ok(status)
}

#[tauri::command]
pub async fn test_virtual_mic_output(req: TestVirtualMicOutputRequest) -> Result<(), String> {
    let (device, info) = find_output_device(&req.device_id)
        .ok_or_else(|| "Выбранный virtual mic output недоступен.".to_string())?;

    if !info.is_virtual {
        return Err(
            "Выберите виртуальный микрофон: BlackHole, VB-CABLE или PipeWire virtual source."
                .to_string(),
        );
    }

    logger::log_info(
        "REALTIME_INTERPRETER",
        &format!("Playing virtual mic test tone to {}", info.label),
    );
    play_test_tone(&device)
}

fn fail_start(
    app: &AppHandle,
    req: &StartRealtimeInterpreterRequest,
    code: &str,
    message: String,
    recoverable: bool,
) -> Result<RealtimeInterpreterStatus, String> {
    logger::log_error("REALTIME_INTERPRETER", &message);
    let status = RealtimeInterpreterStatus::error(message.clone(), Some(req));
    set_status(app, status)?;
    let _ = app.emit(
        "realtime_interpreter_error",
        RealtimeInterpreterErrorEvent {
            session_id: None,
            code: code.to_string(),
            message: message.clone(),
            recoverable,
        },
    );
    Err(message)
}

fn set_status(app: &AppHandle, status: RealtimeInterpreterStatus) -> Result<(), String> {
    {
        let mut guard = status_slot()
            .lock()
            .map_err(|_| "Не удалось обновить статус Realtime Interpreter.".to_string())?;
        *guard = status.clone();
    }

    let _ = app.emit("realtime_interpreter_status", status);
    Ok(())
}

fn validate_start_request(
    req: &StartRealtimeInterpreterRequest,
    devices: &RealtimeAudioDevices,
) -> Result<(), String> {
    if !req.headphones_confirmed {
        return Err(
            "Подтвердите, что локальный перевод выводится в наушники или отдельное устройство."
                .to_string(),
        );
    }

    match req.api_mode {
        RealtimeApiMode::Api => {
            if req
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
            {
                return Err("Для API-режима укажите OpenAI API key в разделе моделей.".to_string());
            }
        }
        RealtimeApiMode::Cloud => {
            if req
                .device_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
            {
                return Err("Для облачного режима войдите в аккаунт Talkis.".to_string());
            }
        }
    }

    let virtual_output = devices
        .virtual_mic_outputs
        .iter()
        .find(|device| device.id == req.virtual_mic_output_device_id)
        .ok_or_else(|| {
            format!(
                "Не найден virtual mic output. Установите {} и обновите список устройств.",
                devices.virtual_driver_name
            )
        })?;

    if !virtual_output.supported {
        return Err("Выбранный virtual mic output сейчас недоступен.".to_string());
    }

    if let Some(real_mic_id) = req
        .real_mic_device_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !devices
            .real_mics
            .iter()
            .any(|device| device.id == real_mic_id)
        {
            return Err("Выбранный настоящий микрофон недоступен.".to_string());
        }
    }

    if let Some(playback_id) = req
        .local_playback_device_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let playback = devices
            .local_playback_outputs
            .iter()
            .find(|device| device.id == playback_id)
            .ok_or_else(|| {
                "Выбранное устройство локального прослушивания недоступно.".to_string()
            })?;

        if playback.id == virtual_output.id {
            return Err(
                "Локальное прослушивание и virtual mic output должны быть разными устройствами."
                    .to_string(),
            );
        }
    }

    if devices
        .system_audio_sources
        .iter()
        .all(|source| !source.supported)
    {
        return Err(match platform_name() {
            "windows" => "System audio для Realtime Interpreter на Windows будет подключен через WASAPI loopback.".to_string(),
            "linux" => "System audio для Realtime Interpreter на Linux будет подключен через PipeWire monitor source.".to_string(),
            _ => "System audio для Realtime Interpreter не поддерживается на этой платформе.".to_string(),
        });
    }

    Ok(())
}

fn discover_realtime_audio_devices() -> RealtimeAudioDevices {
    let platform = platform_name().to_string();
    let host = cpal::default_host();
    let virtual_driver_name = virtual_driver_name().to_string();
    let mut warnings = Vec::new();
    let mut real_mics = enumerate_input_devices(&host);
    let local_playback_outputs = enumerate_output_devices(&host);
    let virtual_mic_outputs: Vec<RealtimeAudioDevice> = local_playback_outputs
        .iter()
        .filter(|device| device.is_virtual)
        .map(|device| RealtimeAudioDevice {
            kind: RealtimeAudioDeviceKind::VirtualMicOutput,
            ..device.clone()
        })
        .collect();

    real_mics.retain(|device| !device.is_virtual);

    if virtual_mic_outputs.is_empty() {
        warnings.push(format!(
            "Не найден virtual audio driver: {}.",
            virtual_driver_name
        ));
    }

    if real_mics.is_empty() {
        warnings.push("Не найден настоящий микрофон для входящей речи пользователя.".to_string());
    }

    if local_playback_outputs.is_empty() {
        warnings.push("Не найдено устройство локального прослушивания.".to_string());
    }

    RealtimeAudioDevices {
        platform,
        virtual_driver_name,
        real_mics,
        virtual_mic_outputs,
        local_playback_outputs,
        system_audio_sources: system_audio_sources(),
        warnings,
    }
}

fn enumerate_input_devices(host: &cpal::Host) -> Vec<RealtimeAudioDevice> {
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let Ok(devices) = host.input_devices() else {
        return Vec::new();
    };

    devices
        .enumerate()
        .filter_map(|(index, device)| {
            let label = device.name().ok()?;
            let driver_hint = virtual_driver_hint(&label);
            Some(RealtimeAudioDevice {
                id: device_id("input", index, &label),
                label: label.clone(),
                kind: RealtimeAudioDeviceKind::RealMic,
                platform: platform_name().to_string(),
                is_default: default_name.as_deref() == Some(label.as_str()),
                is_virtual: driver_hint.is_some(),
                driver_hint,
                supported: true,
            })
        })
        .collect()
}

fn enumerate_output_devices(host: &cpal::Host) -> Vec<RealtimeAudioDevice> {
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    devices
        .enumerate()
        .filter_map(|(index, device)| {
            let label = device.name().ok()?;
            let driver_hint = virtual_driver_hint(&label);
            Some(RealtimeAudioDevice {
                id: device_id("output", index, &label),
                label: label.clone(),
                kind: RealtimeAudioDeviceKind::LocalPlayback,
                platform: platform_name().to_string(),
                is_default: default_name.as_deref() == Some(label.as_str()),
                is_virtual: driver_hint.is_some(),
                driver_hint,
                supported: true,
            })
        })
        .collect()
}

fn find_output_device(device_id_to_find: &str) -> Option<(cpal::Device, RealtimeAudioDevice)> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let devices = host.output_devices().ok()?;

    for (index, device) in devices.enumerate() {
        let label = device.name().ok()?;
        let id = device_id("output", index, &label);
        if id != device_id_to_find {
            continue;
        }

        let driver_hint = virtual_driver_hint(&label);
        let info = RealtimeAudioDevice {
            id,
            label: label.clone(),
            kind: RealtimeAudioDeviceKind::VirtualMicOutput,
            platform: platform_name().to_string(),
            is_default: default_name.as_deref() == Some(label.as_str()),
            is_virtual: driver_hint.is_some(),
            driver_hint,
            supported: true,
        };
        return Some((device, info));
    }

    None
}

fn system_audio_sources() -> Vec<RealtimeAudioDevice> {
    match platform_name() {
        "macos" => vec![RealtimeAudioDevice {
            id: "macos-coreaudio-system-tap".to_string(),
            label: "Системный звук macOS".to_string(),
            kind: RealtimeAudioDeviceKind::SystemAudio,
            platform: "macos".to_string(),
            is_default: true,
            is_virtual: false,
            driver_hint: Some("CoreAudio Process Tap".to_string()),
            supported: true,
        }],
        "windows" => vec![RealtimeAudioDevice {
            id: "windows-wasapi-loopback".to_string(),
            label: "Системный звук Windows".to_string(),
            kind: RealtimeAudioDeviceKind::SystemAudio,
            platform: "windows".to_string(),
            is_default: true,
            is_virtual: false,
            driver_hint: Some("WASAPI loopback".to_string()),
            supported: false,
        }],
        "linux" => vec![RealtimeAudioDevice {
            id: "linux-pipewire-monitor".to_string(),
            label: "Системный звук Linux".to_string(),
            kind: RealtimeAudioDeviceKind::SystemAudio,
            platform: "linux".to_string(),
            is_default: true,
            is_virtual: false,
            driver_hint: Some("PipeWire monitor source".to_string()),
            supported: false,
        }],
        _ => Vec::new(),
    }
}

fn virtual_driver_name() -> &'static str {
    match platform_name() {
        "macos" => "BlackHole",
        "windows" => "VB-CABLE",
        "linux" => "PipeWire virtual source",
        _ => "virtual audio driver",
    }
}

fn virtual_driver_hint(label: &str) -> Option<String> {
    let normalized = label.to_lowercase();

    if normalized.contains("blackhole") {
        return Some("BlackHole".to_string());
    }
    if normalized.contains("vb-cable")
        || normalized.contains("vb audio")
        || normalized.contains("vb-audio")
        || normalized.contains("cable input")
        || normalized.contains("cable output")
    {
        return Some("VB-CABLE".to_string());
    }
    if normalized.contains("pipewire")
        || normalized.contains("virtual source")
        || normalized.contains("virtual sink")
        || normalized.contains("null sink")
    {
        return Some("PipeWire virtual source".to_string());
    }
    if normalized.contains("soundflower") {
        return Some("Soundflower".to_string());
    }
    if normalized.contains("loopback") {
        return Some("Loopback".to_string());
    }

    None
}

fn device_id(prefix: &str, index: usize, label: &str) -> String {
    format!("{}-{}-{}", prefix, index, slugify(label))
}

fn slugify(value: &str) -> String {
    let mut result = String::new();
    let mut last_dash = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            result.push('-');
            last_dash = true;
        }
    }

    let result = result.trim_matches('-').to_string();
    if result.is_empty() {
        "device".to_string()
    } else {
        result
    }
}

fn play_test_tone(device: &cpal::Device) -> Result<(), String> {
    let supported_config = device
        .default_output_config()
        .map_err(|err| format!("Не удалось прочитать формат output-устройства: {}", err))?;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels as usize;

    if channels == 0 {
        return Err("Output-устройство вернуло аудиоформат без каналов.".to_string());
    }

    let total_frames = ((sample_rate as u64 * TEST_TONE_DURATION_MS) / 1000) as usize;
    let frame_index = Arc::new(AtomicUsize::new(0));
    let err_fn = |err| {
        logger::log_error(
            "REALTIME_INTERPRETER",
            &format!("Virtual mic test output stream error: {}", err),
        );
    };

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let frame_index = Arc::clone(&frame_index);
            device.build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    write_test_tone(
                        data,
                        channels,
                        sample_rate,
                        total_frames,
                        &frame_index,
                        |value| value,
                    );
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let frame_index = Arc::clone(&frame_index);
            device.build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    write_test_tone(
                        data,
                        channels,
                        sample_rate,
                        total_frames,
                        &frame_index,
                        |value| (value * i16::MAX as f32).round() as i16,
                    );
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let frame_index = Arc::clone(&frame_index);
            device.build_output_stream(
                &config,
                move |data: &mut [u16], _| {
                    write_test_tone(
                        data,
                        channels,
                        sample_rate,
                        total_frames,
                        &frame_index,
                        |value| ((value * 0.5 + 0.5) * u16::MAX as f32).round() as u16,
                    );
                },
                err_fn,
                None,
            )
        }
        other => {
            return Err(format!(
                "Тестовый output пока не поддерживает формат {:?}.",
                other
            ));
        }
    }
    .map_err(|err| format!("Не удалось открыть virtual mic output: {}", err))?;

    stream
        .play()
        .map_err(|err| format!("Не удалось запустить тест virtual mic output: {}", err))?;
    std::thread::sleep(Duration::from_millis(TEST_TONE_DURATION_MS + 120));
    drop(stream);

    Ok(())
}

fn write_test_tone<T, F>(
    data: &mut [T],
    channels: usize,
    sample_rate: u32,
    total_frames: usize,
    frame_index: &AtomicUsize,
    convert: F,
) where
    T: Copy,
    F: Fn(f32) -> T,
{
    for frame in data.chunks_mut(channels) {
        let index = frame_index.fetch_add(1, Ordering::Relaxed);
        let sample = if index < total_frames {
            test_tone_sample(index, sample_rate, total_frames)
        } else {
            0.0
        };

        let value = convert(sample);
        for output in frame {
            *output = value;
        }
    }
}

fn test_tone_sample(frame: usize, sample_rate: u32, total_frames: usize) -> f32 {
    let t = frame as f32 / sample_rate.max(1) as f32;
    let progress = frame as f32 / total_frames.max(1) as f32;
    let freq = if progress < 0.52 { 440.0 } else { 660.0 };
    let fade_in = (progress / 0.08).clamp(0.0, 1.0);
    let fade_out = ((1.0 - progress) / 0.1).clamp(0.0, 1.0);
    (t * freq * TAU).sin() * 0.18 * fade_in.min(fade_out)
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unsupported"
    }
}

#[cfg(test)]
fn realtime_append_event(audio_bytes: &[u8]) -> serde_json::Value {
    json!({
        "type": "input_audio_buffer.append",
        "audio": base64::engine::general_purpose::STANDARD.encode(audio_bytes),
    })
}

#[cfg(test)]
fn split_pcm16_bytes_into_chunks(
    bytes: &[u8],
    max_chunk_bytes: usize,
) -> Result<Vec<Vec<u8>>, String> {
    if max_chunk_bytes < 2 {
        return Err("PCM16 chunk size must fit at least one sample.".to_string());
    }
    if bytes.len() % 2 != 0 {
        return Err("PCM16 buffer must contain complete 16-bit samples.".to_string());
    }

    let chunk_size = max_chunk_bytes - (max_chunk_bytes % 2);
    Ok(bytes
        .chunks(chunk_size)
        .map(|chunk| chunk.to_vec())
        .collect())
}

#[cfg(test)]
fn pcm16_rms_level(bytes: &[u8]) -> Result<f32, String> {
    if bytes.len() % 2 != 0 {
        return Err("PCM16 buffer must contain complete 16-bit samples.".to_string());
    }
    if bytes.is_empty() {
        return Ok(0.0);
    }

    let mut sum = 0.0_f64;
    let mut count = 0_u64;
    for pair in bytes.chunks_exact(2) {
        let sample = i16::from_le_bytes([pair[0], pair[1]]) as f64 / i16::MAX as f64;
        sum += sample * sample;
        count += 1;
    }

    Ok((sum / count.max(1) as f64).sqrt() as f32)
}

#[cfg(test)]
fn silence_gate_allows(bytes: &[u8], threshold: f32) -> Result<bool, String> {
    Ok(pcm16_rms_level(bytes)? >= threshold.max(0.0))
}

#[cfg(test)]
struct PcmRingBuffer {
    capacity: usize,
    bytes: VecDeque<u8>,
    dropped_bytes: usize,
}

#[cfg(test)]
impl PcmRingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            bytes: VecDeque::with_capacity(capacity),
            dropped_bytes: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if self.bytes.len() == self.capacity {
                self.bytes.pop_front();
                self.dropped_bytes += 1;
            }
            self.bytes.push_back(*byte);
        }
    }

    fn len(&self) -> usize {
        self.bytes.len()
    }

    fn dropped_bytes(&self) -> usize {
        self.dropped_bytes
    }

    fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_audio_append_event_frames_base64_audio() {
        let event = realtime_append_event(&[0, 1, 2, 3]);

        assert_eq!(event["type"], "input_audio_buffer.append");
        assert_eq!(event["audio"], "AAECAw==");
    }

    #[test]
    fn pcm16_chunking_preserves_sample_boundaries() {
        let bytes = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        let chunks = split_pcm16_bytes_into_chunks(&bytes, 5).unwrap();

        assert_eq!(chunks, vec![vec![0, 1, 2, 3], vec![4, 5, 6, 7], vec![8, 9]]);
    }

    #[test]
    fn pcm16_chunking_rejects_partial_sample() {
        let err = split_pcm16_bytes_into_chunks(&[0, 1, 2], 8).unwrap_err();

        assert!(err.contains("complete 16-bit samples"));
    }

    #[test]
    fn ring_buffer_drops_oldest_bytes_on_overflow() {
        let mut buffer = PcmRingBuffer::new(4);
        buffer.push(&[1, 2, 3]);
        buffer.push(&[4, 5, 6]);

        assert_eq!(buffer.len(), 4);
        assert_eq!(buffer.dropped_bytes(), 2);
        assert_eq!(buffer.snapshot(), vec![3, 4, 5, 6]);
    }

    #[test]
    fn silence_gate_uses_pcm_rms_level() {
        let silence = [0_u8, 0, 0, 0, 0, 0, 0, 0];
        let loud = i16::MAX.to_le_bytes().repeat(4);

        assert!(!silence_gate_allows(&silence, 0.01).unwrap());
        assert!(silence_gate_allows(&loud, 0.5).unwrap());
    }

    #[test]
    fn validation_requires_virtual_output_and_api_key() {
        let devices = RealtimeAudioDevices {
            platform: "macos".to_string(),
            virtual_driver_name: "BlackHole".to_string(),
            real_mics: vec![],
            virtual_mic_outputs: vec![],
            local_playback_outputs: vec![],
            system_audio_sources: vec![RealtimeAudioDevice {
                id: "macos-coreaudio-system-tap".to_string(),
                label: "Системный звук macOS".to_string(),
                kind: RealtimeAudioDeviceKind::SystemAudio,
                platform: "macos".to_string(),
                is_default: true,
                is_virtual: false,
                driver_hint: None,
                supported: true,
            }],
            warnings: vec![],
        };
        let req = StartRealtimeInterpreterRequest {
            real_mic_device_id: None,
            virtual_mic_output_device_id: "missing".to_string(),
            local_playback_device_id: None,
            language_pair: RealtimeLanguagePair::RuEn,
            api_mode: RealtimeApiMode::Api,
            api_key: Some("".to_string()),
            device_token: None,
            model: None,
            endpoint: None,
            headphones_confirmed: true,
        };

        let err = validate_start_request(&req, &devices).unwrap_err();

        assert!(err.contains("OpenAI API key"));
    }

    #[test]
    fn validation_rejects_same_playback_and_virtual_output() {
        let virtual_output = RealtimeAudioDevice {
            id: "output-0-blackhole".to_string(),
            label: "BlackHole 2ch".to_string(),
            kind: RealtimeAudioDeviceKind::VirtualMicOutput,
            platform: "macos".to_string(),
            is_default: false,
            is_virtual: true,
            driver_hint: Some("BlackHole".to_string()),
            supported: true,
        };
        let mut playback = virtual_output.clone();
        playback.kind = RealtimeAudioDeviceKind::LocalPlayback;
        let devices = RealtimeAudioDevices {
            platform: "macos".to_string(),
            virtual_driver_name: "BlackHole".to_string(),
            real_mics: vec![],
            virtual_mic_outputs: vec![virtual_output],
            local_playback_outputs: vec![playback],
            system_audio_sources: vec![RealtimeAudioDevice {
                id: "macos-coreaudio-system-tap".to_string(),
                label: "Системный звук macOS".to_string(),
                kind: RealtimeAudioDeviceKind::SystemAudio,
                platform: "macos".to_string(),
                is_default: true,
                is_virtual: false,
                driver_hint: None,
                supported: true,
            }],
            warnings: vec![],
        };
        let req = StartRealtimeInterpreterRequest {
            real_mic_device_id: None,
            virtual_mic_output_device_id: "output-0-blackhole".to_string(),
            local_playback_device_id: Some("output-0-blackhole".to_string()),
            language_pair: RealtimeLanguagePair::RuEn,
            api_mode: RealtimeApiMode::Api,
            api_key: Some("sk-test".to_string()),
            device_token: None,
            model: None,
            endpoint: None,
            headphones_confirmed: true,
        };

        let err = validate_start_request(&req, &devices).unwrap_err();

        assert!(err.contains("разными устройствами"));
    }
}
