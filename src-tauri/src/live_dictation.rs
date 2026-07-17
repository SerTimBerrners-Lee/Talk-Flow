use crate::logger;
use crate::realtime::{self, RealtimeAudioCommand, RealtimeConnectionRequest};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use url::Url;

const DICTATION_STREAM_UPDATE_EVENT: &str = "dictation-stream:update";
const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;
const LIVE_FINISH_TIMEOUT: Duration = Duration::from_secs(12);
const PCM_CHUNK_BYTES: usize = (TARGET_SAMPLE_RATE as usize / 10) * 2;
const LIVE_QUEUE_CHUNKS: usize = 24;
const TALKIS_CLOUD_PROVIDER: &str = "talkis-cloud";
const TALKIS_CLOUD_REALTIME_PATH: &str = "/api/realtime/client-secret";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDictationStartRequest {
    pub request_id: String,
    pub model: String,
    pub language: String,
    pub endpoint: String,
    pub streaming_enabled: bool,
    pub provider: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDictationFinal {
    pub request_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudRealtimeClientSecret {
    client_secret: String,
    provider: String,
    model: String,
    endpoint: String,
}

#[derive(Clone)]
pub struct LiveDictationFeeder {
    request_id: String,
    tx: tokio::sync::mpsc::Sender<RealtimeAudioCommand>,
    encoder: Arc<Mutex<LivePcmEncoder>>,
    closed: Arc<AtomicBool>,
}

pub struct LiveDictationSession {
    request_id: String,
    tx: tokio::sync::mpsc::Sender<RealtimeAudioCommand>,
    result_rx: mpsc::Receiver<Result<LiveDictationFinal, String>>,
    encoder: Arc<Mutex<LivePcmEncoder>>,
    closed: Arc<AtomicBool>,
}

#[derive(Deserialize)]
struct LiveDictationEvent {
    status: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DictationStreamUpdatePayload {
    request_id: String,
    status: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

struct LiveEndpoint {
    host: String,
    port: u16,
    path_and_query: String,
}

struct LivePcmEncoder {
    source_sample_rate: u32,
    pending: Vec<f32>,
    next_source_pos: f64,
    pending_pcm: Vec<u8>,
}

impl LiveDictationSession {
    pub fn feeder(&self) -> LiveDictationFeeder {
        LiveDictationFeeder {
            request_id: self.request_id.clone(),
            tx: self.tx.clone(),
            encoder: Arc::clone(&self.encoder),
            closed: Arc::clone(&self.closed),
        }
    }
}

impl LivePcmEncoder {
    fn new(source_sample_rate: u32) -> Self {
        Self {
            source_sample_rate: source_sample_rate.max(1),
            pending: Vec::new(),
            next_source_pos: 0.0,
            pending_pcm: Vec::with_capacity(PCM_CHUNK_BYTES * 2),
        }
    }

    fn encode(&mut self, samples: &[f32]) -> Vec<Vec<u8>> {
        if samples.is_empty() {
            return Vec::new();
        }

        self.pending.extend_from_slice(samples);
        let ratio = self.source_sample_rate as f64 / TARGET_SAMPLE_RATE as f64;
        let mut pcm = Vec::new();

        while self.next_source_pos + 1.0 < self.pending.len() as f64 {
            let index = self.next_source_pos.floor() as usize;
            let frac = (self.next_source_pos - index as f64) as f32;
            let current = self.pending.get(index).copied().unwrap_or(0.0);
            let next = self.pending.get(index + 1).copied().unwrap_or(current);
            let sample = current + (next - current) * frac;
            pcm.extend_from_slice(&float_sample_to_i16(sample).to_le_bytes());
            self.next_source_pos += ratio;
        }

        let drain = self.next_source_pos.floor() as usize;
        if drain > 0 {
            let drain = drain.min(self.pending.len());
            self.pending.drain(..drain);
            self.next_source_pos -= drain as f64;
        }

        self.pending_pcm.extend_from_slice(&pcm);
        let mut chunks = Vec::new();
        while self.pending_pcm.len() >= PCM_CHUNK_BYTES {
            chunks.push(self.pending_pcm.drain(..PCM_CHUNK_BYTES).collect());
        }
        chunks
    }

    fn flush(&mut self) -> Option<Vec<u8>> {
        if self.pending_pcm.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending_pcm))
        }
    }
}

fn float_sample_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 32_768.0).round() as i16
    } else {
        (clamped * 32_767.0).round() as i16
    }
}

pub fn start_live_dictation_session(
    app: AppHandle,
    req: Option<LiveDictationStartRequest>,
    source_sample_rate: u32,
) -> Option<LiveDictationSession> {
    let Some(req) = req else {
        return None;
    };

    if !req.streaming_enabled {
        return None;
    }

    let request_id = req.request_id.trim().to_string();
    if request_id.is_empty() {
        logger::log_error("LIVE_DICTATION", "Live dictation request id is empty");
        return None;
    }

    let provider = req
        .provider
        .as_deref()
        .unwrap_or("local")
        .trim()
        .to_lowercase();
    let endpoint = if provider == "local" {
        match resolve_live_endpoint(&req) {
            Ok(endpoint) => Some(endpoint),
            Err(message) => {
                emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
                logger::log_error("LIVE_DICTATION", &message);
                return None;
            }
        }
    } else {
        None
    };

    let (tx, rx) = tokio::sync::mpsc::channel(LIVE_QUEUE_CHUNKS);
    let (result_tx, result_rx) = mpsc::channel();
    let encoder = Arc::new(Mutex::new(LivePcmEncoder::new(source_sample_rate)));
    let closed = Arc::new(AtomicBool::new(false));
    let thread_request_id = request_id.clone();
    let thread_closed = Arc::clone(&closed);

    logger::log_info(
        "LIVE_DICTATION",
        &format!(
            "Starting live dictation session: request_id={}, provider={}, model={}, language={}, source_sample_rate={}",
            request_id,
            provider,
            req.model,
            req.language,
            source_sample_rate
        ),
    );

    thread::Builder::new()
        .name("talkis-live-dictation".to_string())
        .spawn(move || {
            let result = if let Some(endpoint) = endpoint {
                run_live_dictation_client(app, thread_request_id, endpoint, rx)
            } else {
                run_remote_live_dictation_client(app, thread_request_id, req, provider, rx)
            };
            if let Err(message) = &result {
                logger::log_error(
                    "LIVE_DICTATION",
                    &format!("Live dictation session ended with error: {}", message),
                );
            }
            thread_closed.store(true, Ordering::Relaxed);
            let _ = result_tx.send(result);
        })
        .map_err(|err| {
            logger::log_error(
                "LIVE_DICTATION",
                &format!("Failed to spawn live dictation thread: {}", err),
            );
        })
        .ok()?;

    Some(LiveDictationSession {
        request_id,
        tx,
        result_rx,
        encoder,
        closed,
    })
}

pub fn feed_source_samples(feeder: &LiveDictationFeeder, samples: &[f32]) {
    if feeder.closed.load(Ordering::Relaxed) {
        return;
    }

    let chunks = {
        let mut encoder = match feeder.encoder.lock() {
            Ok(encoder) => encoder,
            Err(err) => err.into_inner(),
        };
        encoder.encode(samples)
    };

    if chunks.is_empty() {
        return;
    }

    for pcm in chunks {
        match feeder.tx.try_send(RealtimeAudioCommand::Pcm(pcm)) {
            Ok(()) | Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {}
            Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                if !feeder.closed.swap(true, Ordering::Relaxed) {
                    logger::log_error("LIVE_DICTATION", &format!("Live dictation feed channel closed; disabling live feed for this recording: request_id={}", feeder.request_id));
                }
                break;
            }
        }
    }
}

pub fn finish_live_dictation_session(
    session: LiveDictationSession,
) -> Result<LiveDictationFinal, String> {
    let LiveDictationSession {
        request_id,
        tx,
        result_rx,
        encoder,
        closed,
    } = session;
    if let Ok(mut encoder) = encoder.lock() {
        if let Some(pcm) = encoder.flush() {
            let _ = tx.try_send(RealtimeAudioCommand::Pcm(pcm));
        }
    }
    let _ = tx.try_send(RealtimeAudioCommand::Finish);
    closed.store(true, Ordering::Relaxed);
    drop(tx);
    match result_rx.recv_timeout(LIVE_FINISH_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "Live dictation session timed out waiting for final text: request_id={}",
            request_id
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!(
            "Live dictation session ended before final text: request_id={}",
            request_id
        )),
    }
}

pub fn cancel_live_dictation_session(session: LiveDictationSession) {
    session.closed.store(true, Ordering::Relaxed);
    let _ = session.tx.try_send(RealtimeAudioCommand::Cancel);
}

fn resolve_live_endpoint(req: &LiveDictationStartRequest) -> Result<LiveEndpoint, String> {
    let mut url = Url::parse(req.endpoint.trim())
        .map_err(|err| format!("Invalid live STT endpoint: {}", err))?;
    if url.scheme() != "http" {
        return Err("Live dictation supports only local HTTP STT endpoints.".to_string());
    }

    url.set_path("/v1/audio/transcriptions/live");
    url.query_pairs_mut()
        .clear()
        .append_pair("model", req.model.trim())
        .append_pair("language", req.language.trim());

    let host = url
        .host_str()
        .ok_or_else(|| "Live STT endpoint host is missing.".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Live STT endpoint port is missing.".to_string())?;
    let path = url.path().to_string();
    let path_and_query = match url.query() {
        Some(query) if !query.is_empty() => format!("{}?{}", path, query),
        _ => path,
    };

    Ok(LiveEndpoint {
        host,
        port,
        path_and_query,
    })
}

fn run_remote_live_dictation_client(
    app: AppHandle,
    request_id: String,
    req: LiveDictationStartRequest,
    provider: String,
    rx: tokio::sync::mpsc::Receiver<RealtimeAudioCommand>,
) -> Result<LiveDictationFinal, String> {
    let language = req.language.trim().to_string();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| format!("Failed to start realtime runtime: {}", err))?;
    let connection = if provider == TALKIS_CLOUD_PROVIDER {
        runtime.block_on(resolve_cloud_live_dictation_connection(&req))?
    } else {
        RealtimeConnectionRequest {
            provider,
            api_key: req.api_key.unwrap_or_default(),
            model: req.model,
            endpoint: req.endpoint,
            target_language: if language.is_empty() {
                None
            } else {
                Some(language)
            },
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        }
    };
    let event_app = app.clone();
    let event_request_id = request_id.clone();
    let text =
        runtime.block_on(realtime::run_streaming_stt(
            connection,
            rx,
            move |event| match event.status {
                realtime::NormalizedRealtimeStatus::Started => {
                    emit_dictation_stream_update(&event_app, &event_request_id, "started", "", None)
                }
                realtime::NormalizedRealtimeStatus::Partial => emit_dictation_stream_update(
                    &event_app,
                    &event_request_id,
                    "partial",
                    &event.original,
                    None,
                ),
                realtime::NormalizedRealtimeStatus::Final => emit_dictation_stream_update(
                    &event_app,
                    &event_request_id,
                    "final",
                    &event.original,
                    None,
                ),
                realtime::NormalizedRealtimeStatus::Error => emit_dictation_stream_update(
                    &event_app,
                    &event_request_id,
                    "error",
                    "",
                    event.message.as_deref(),
                ),
            },
        ))?;

    Ok(LiveDictationFinal { request_id, text })
}

fn cloud_live_dictation_request_body(language: &str) -> serde_json::Value {
    serde_json::json!({
        "purpose": "stt",
        "language": language,
    })
}

async fn resolve_cloud_live_dictation_connection(
    req: &LiveDictationStartRequest,
) -> Result<RealtimeConnectionRequest, String> {
    let device_token = req.api_key.as_deref().unwrap_or_default().trim();
    if device_token.is_empty() {
        return Err("Войдите в Talkis и проверьте облачный баланс.".to_string());
    }
    let url = format!(
        "{}{}",
        req.endpoint.trim().trim_end_matches('/'),
        TALKIS_CLOUD_REALTIME_PATH
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Не удалось подготовить облачную транскрибацию: {}", error))?;
    logger::log_info(
        "LIVE_DICTATION",
        "provider=talkis-cloud stage=client_secret_request purpose=stt",
    );
    let response = client
        .post(url)
        .bearer_auth(device_token)
        .json(&cloud_live_dictation_request_body(req.language.trim()))
        .send()
        .await
        .map_err(|error| format!("Облако Talkis недоступно: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Некорректный ответ облака Talkis: {}", error))?;
    if !status.is_success() {
        let upstream_message = serde_json::from_str::<serde_json::Value>(&response_text)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.as_str())
                    .map(str::to_string)
            });
        let message =
            match status.as_u16() {
                401 => "Сессия Talkis истекла. Войдите в облако повторно.".to_string(),
                402 => "Облачный баланс закончился. Пополните его в личном кабинете Talkis."
                    .to_string(),
                403 => "Облачный доступ Talkis сейчас недоступен.".to_string(),
                429 => "Слишком много запусков realtime-транскрибации. Повторите через минуту."
                    .to_string(),
                _ => upstream_message.unwrap_or_else(|| {
                    format!(
                        "Облако Talkis не запустило realtime-транскрибацию ({})",
                        status
                    )
                }),
            };
        logger::log_error(
            "LIVE_DICTATION",
            &format!(
                "provider=talkis-cloud stage=client_secret_failed purpose=stt status={}",
                status
            ),
        );
        return Err(message);
    }

    let secret: CloudRealtimeClientSecret = serde_json::from_str(&response_text)
        .map_err(|error| format!("Некорректный ответ облака Talkis: {}", error))?;
    if secret.client_secret.trim().is_empty()
        || secret.provider != "openai"
        || secret.model.trim().is_empty()
        || secret.endpoint.trim().is_empty()
    {
        return Err("Облако Talkis вернуло неполные данные Realtime-сессии.".to_string());
    }
    logger::log_info(
        "LIVE_DICTATION",
        &format!(
            "provider=talkis-cloud stage=client_secret_ready purpose=stt model={}",
            secret.model
        ),
    );

    Ok(RealtimeConnectionRequest {
        provider: secret.provider,
        api_key: secret.client_secret,
        model: secret.model,
        endpoint: secret.endpoint,
        target_language: Some(req.language.trim().to_string()),
        purpose: "stt".to_string(),
        voice_output: false,
        voice: None,
        voice_speed: None,
    })
}

fn run_live_dictation_client(
    app: AppHandle,
    request_id: String,
    endpoint: LiveEndpoint,
    mut rx: tokio::sync::mpsc::Receiver<RealtimeAudioCommand>,
) -> Result<LiveDictationFinal, String> {
    let mut stream =
        TcpStream::connect((endpoint.host.as_str(), endpoint.port)).map_err(|err| {
            let message = format!("Failed to connect live STT endpoint: {}", err);
            emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
            message
        })?;
    let _ = stream.set_nodelay(true);

    let reader_stream = stream.try_clone().map_err(|err| {
        let message = format!("Failed to clone live STT stream: {}", err);
        emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
        message
    })?;

    let headers = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/octet-stream\r\nX-Talkis-Audio-Format: pcm_s16le;rate={};channels={}\r\nConnection: close\r\n\r\n",
        endpoint.path_and_query,
        endpoint.host,
        endpoint.port,
        TARGET_SAMPLE_RATE,
        TARGET_CHANNELS
    );
    stream.write_all(headers.as_bytes()).map_err(|err| {
        let message = format!("Failed to open live STT request: {}", err);
        emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
        message
    })?;
    stream.flush().map_err(|err| {
        let message = format!("Failed to flush live STT request headers: {}", err);
        emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
        message
    })?;

    let reader_app = app.clone();
    let reader_request_id = request_id.clone();
    let reader = thread::Builder::new()
        .name("talkis-live-dictation-reader".to_string())
        .spawn(move || read_live_response(reader_stream, reader_app, reader_request_id))
        .map_err(|err| {
            let message = format!("Failed to spawn live STT reader: {}", err);
            emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
            message
        })?;

    let mut write_error: Option<String> = None;
    let mut write_closed = false;
    while let Some(command) = rx.blocking_recv() {
        match command {
            RealtimeAudioCommand::Pcm(bytes) => {
                if let Err(err) = stream.write_all(&bytes) {
                    write_error = Some(format!("Failed to feed live STT audio: {}", err));
                    let _ = stream.shutdown(Shutdown::Write);
                    write_closed = true;
                    break;
                }
            }
            RealtimeAudioCommand::Finish => {
                let _ = stream.shutdown(Shutdown::Write);
                write_closed = true;
                break;
            }
            RealtimeAudioCommand::Cancel => {
                let _ = stream.shutdown(Shutdown::Both);
                return Err("Live dictation session cancelled.".to_string());
            }
        }
    }
    if !write_closed {
        let _ = stream.shutdown(Shutdown::Write);
    }

    let read_result = reader
        .join()
        .map_err(|_| "Live STT reader thread panicked.".to_string())?;
    match (write_error, read_result) {
        (Some(message), Ok(_)) => Err(message),
        (Some(message), Err(read_message)) => Err(format!("{}; {}", message, read_message)),
        (None, result) => result,
    }
}

fn read_live_response(
    stream: TcpStream,
    app: AppHandle,
    request_id: String,
) -> Result<LiveDictationFinal, String> {
    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|err| format!("Failed to read live STT response: {}", err))?;

    if !status_line.contains(" 200 ") {
        let mut body = String::new();
        let _ = reader.read_to_string(&mut body);
        let message = format!(
            "Live STT endpoint rejected request: {} {}",
            status_line.trim(),
            body.trim()
        );
        emit_dictation_stream_update(&app, &request_id, "error", "", Some(&message));
        return Err(message);
    }

    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to read live STT response headers: {}", err))?;
        if read == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }

    let mut latest_text = String::new();
    let mut final_text: Option<String> = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to read live STT event: {}", err))?;
        if read == 0 {
            break;
        }

        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let event: LiveDictationEvent = serde_json::from_str(line)
            .map_err(|err| format!("Failed to parse live STT event: {}; line={}", err, line))?;
        match event.status.as_str() {
            "started" => {
                emit_dictation_stream_update(&app, &request_id, "started", &event.text, None);
            }
            "partial" => {
                latest_text = event.text.trim().to_string();
                emit_dictation_stream_update(&app, &request_id, "partial", &event.text, None);
            }
            "final" => {
                let text = event.text.trim().to_string();
                final_text = Some(text.clone());
                emit_dictation_stream_update(&app, &request_id, "final", &text, None);
            }
            "error" => {
                let message = event
                    .message
                    .unwrap_or_else(|| "Live STT returned an error.".to_string());
                emit_dictation_stream_update(
                    &app,
                    &request_id,
                    "error",
                    &event.text,
                    Some(&message),
                );
                return Err(message);
            }
            other => {
                logger::log_info(
                    "LIVE_DICTATION",
                    &format!("Ignoring unknown live STT event status: {}", other),
                );
            }
        }
    }

    match final_text {
        Some(text) => Ok(LiveDictationFinal { request_id, text }),
        None if !latest_text.is_empty() => Err(
            "Live STT stream closed before final event; falling back to full transcription."
                .to_string(),
        ),
        None => Err("Live STT stream closed without transcription.".to_string()),
    }
}

fn emit_dictation_stream_update(
    app: &AppHandle,
    request_id: &str,
    status: &str,
    text: &str,
    message: Option<&str>,
) {
    let payload = DictationStreamUpdatePayload {
        request_id: request_id.to_string(),
        status: status.to_string(),
        text: text.to_string(),
        message: message.map(ToString::to_string),
    };

    if let Err(err) = app.emit(DICTATION_STREAM_UPDATE_EVENT, payload) {
        logger::log_error(
            "LIVE_DICTATION",
            &format!("Failed to emit live dictation event: {}", err),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_pcm_encoder_resamples_to_16khz_pcm16() {
        let mut encoder = LivePcmEncoder::new(48_000);
        let input = vec![0.5; 4_800];
        let output = encoder.encode(&input);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].len(), 1_600 * 2);
        assert_eq!(i16::from_le_bytes([output[0][0], output[0][1]]), 16_384);
    }

    #[test]
    fn live_endpoint_rewrites_transcription_path() {
        let endpoint = resolve_live_endpoint(&LiveDictationStartRequest {
            request_id: "req-1".to_string(),
            model: "nvidia/nemotron-3.5-asr-streaming-0.6b".to_string(),
            language: "ru".to_string(),
            endpoint: "http://127.0.0.1:15223/v1/audio/transcriptions".to_string(),
            streaming_enabled: true,
            provider: None,
            api_key: None,
        })
        .expect("endpoint");

        assert_eq!(endpoint.host, "127.0.0.1");
        assert_eq!(endpoint.port, 15223);
        assert!(endpoint
            .path_and_query
            .starts_with("/v1/audio/transcriptions/live?"));
        assert!(endpoint
            .path_and_query
            .contains("model=nvidia%2Fnemotron-3.5-asr-streaming-0.6b"));
        assert!(endpoint.path_and_query.contains("language=ru"));
    }

    #[test]
    fn finish_does_not_block_when_audio_queue_is_full() {
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        tx.try_send(RealtimeAudioCommand::Pcm(vec![0; PCM_CHUNK_BYTES]))
            .unwrap();
        let (result_tx, result_rx) = mpsc::channel();
        result_tx
            .send(Err("mock realtime failure".to_string()))
            .unwrap();
        let session = LiveDictationSession {
            request_id: "req-full-queue".to_string(),
            tx,
            result_rx,
            encoder: Arc::new(Mutex::new(LivePcmEncoder::new(TARGET_SAMPLE_RATE))),
            closed: Arc::new(AtomicBool::new(false)),
        };

        assert_eq!(
            finish_live_dictation_session(session).unwrap_err(),
            "mock realtime failure"
        );
    }

    #[test]
    fn cloud_live_dictation_requests_an_stt_session() {
        assert_eq!(
            cloud_live_dictation_request_body("ru"),
            serde_json::json!({
                "purpose": "stt",
                "language": "ru",
            })
        );
    }
}
