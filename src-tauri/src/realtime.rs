use crate::logger;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::time::Duration;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};
use url::Url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const RECONNECT_DELAYS: [Duration; 3] = [
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];
const MAX_REPLAY_CHUNKS: usize = 20;
const OPENAI_SILENCE_COMMIT_CHUNKS: usize = 4;
const OPENAI_MAX_COMMIT_CHUNKS: usize = 20;
const OPENAI_SPEECH_RMS_THRESHOLD: f32 = 0.01;
const COMMON_PCM_RATE: u32 = 16_000;
const OPENAI_PCM_RATE: u32 = 24_000;

#[derive(Debug, Default)]
struct OpenAiCommitTracker {
    active_chunks: usize,
    speech_chunks: usize,
    trailing_silence_chunks: usize,
}

impl OpenAiCommitTracker {
    fn observe(&mut self, pcm: &[u8]) -> bool {
        let is_speech = pcm16_rms(pcm) >= OPENAI_SPEECH_RMS_THRESHOLD;
        if is_speech {
            self.active_chunks += 1;
            self.speech_chunks += 1;
            self.trailing_silence_chunks = 0;
            return true;
        }

        if self.has_speech() {
            self.active_chunks += 1;
            self.trailing_silence_chunks += 1;
            return true;
        }

        false
    }

    fn has_speech(&self) -> bool {
        self.speech_chunks > 0
    }

    fn should_commit(&self) -> bool {
        self.has_speech()
            && (self.trailing_silence_chunks >= OPENAI_SILENCE_COMMIT_CHUNKS
                || self.active_chunks >= OPENAI_MAX_COMMIT_CHUNKS)
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}

#[derive(Debug, Default)]
struct TranslationDraft {
    original: String,
    translated: String,
}

#[derive(Debug, Default)]
struct StableTranslationText {
    drafts: HashMap<String, TranslationDraft>,
    finalized_streams: VecDeque<String>,
}

impl StableTranslationText {
    fn apply(
        &mut self,
        provider: &str,
        payload: &str,
        mut event: NormalizedRealtimeEvent,
    ) -> Option<NormalizedRealtimeEvent> {
        if provider != "openai"
            || matches!(
                event.status,
                NormalizedRealtimeStatus::Started | NormalizedRealtimeStatus::Error
            )
        {
            return Some(event);
        }

        let value = serde_json::from_str::<Value>(payload).ok()?;
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let lane = if !event.translated.is_empty() {
            "translated"
        } else {
            "original"
        };
        let durable_stream_id = value
            .get("response_id")
            .or_else(|| value.get("item_id"))
            .and_then(Value::as_str)
            .map(|id| format!("{}:{}", lane, id));
        if durable_stream_id.as_ref().is_some_and(|stream_id| {
            self.finalized_streams
                .iter()
                .any(|known| known == stream_id)
        }) {
            return None;
        }

        let stream_id = durable_stream_id
            .clone()
            .unwrap_or_else(|| format!("{}:fallback", lane));
        let draft = self.drafts.entry(stream_id.clone()).or_default();
        let is_delta = event_type.ends_with(".delta");
        if !event.original.is_empty() {
            update_stream_text(&mut draft.original, &event.original, is_delta);
            event.original = draft.original.clone();
        }
        if !event.translated.is_empty() {
            update_stream_text(&mut draft.translated, &event.translated, is_delta);
            event.translated = draft.translated.clone();
        }

        if event.status == NormalizedRealtimeStatus::Final {
            if event.original.is_empty() {
                event.original = draft.original.clone();
            }
            if event.translated.is_empty() {
                event.translated = draft.translated.clone();
            }
            self.drafts.remove(&stream_id);
            if let Some(stream_id) = durable_stream_id {
                self.finalized_streams.push_back(stream_id);
                while self.finalized_streams.len() > 16 {
                    self.finalized_streams.pop_front();
                }
            }
        }

        Some(event)
    }
}

fn update_stream_text(buffer: &mut String, incoming: &str, append: bool) {
    if append {
        buffer.push_str(incoming);
    } else {
        buffer.clear();
        buffer.push_str(incoming);
    }
}

fn pcm16_rms(pcm: &[u8]) -> f32 {
    let mut sum_squares = 0.0f64;
    let mut samples = 0usize;
    for bytes in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([bytes[0], bytes[1]]) as f64 / i16::MAX as f64;
        sum_squares += sample * sample;
        samples += 1;
    }
    if samples == 0 {
        return 0.0;
    }
    (sum_squares / samples as f64).sqrt() as f32
}

fn final_transcript(final_parts: &[String]) -> Result<String, String> {
    let transcript = final_parts.join(" ").trim().to_string();
    if transcript.is_empty() {
        Err("Realtime provider returned no final transcript; use batch fallback.".to_string())
    } else {
        Ok(transcript)
    }
}

fn normalized_transcript_word(word: &str) -> String {
    word.trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase()
}

fn merge_transcript_text(existing: &str, incoming: &str) -> String {
    let existing = existing.trim();
    let incoming = incoming.trim();
    if existing.is_empty() {
        return incoming.to_string();
    }
    if incoming.is_empty() {
        return existing.to_string();
    }

    let existing_words = existing.split_whitespace().collect::<Vec<_>>();
    let incoming_words = incoming.split_whitespace().collect::<Vec<_>>();
    let max_overlap = existing_words.len().min(incoming_words.len());
    let overlap = (1..=max_overlap)
        .rev()
        .find(|overlap| {
            existing_words[existing_words.len() - overlap..]
                .iter()
                .zip(incoming_words[..*overlap].iter())
                .all(|(left, right)| {
                    let left = normalized_transcript_word(left);
                    !left.is_empty() && left == normalized_transcript_word(right)
                })
        })
        .unwrap_or(0);

    if overlap == incoming_words.len() {
        return existing.to_string();
    }
    format!("{} {}", existing, incoming_words[overlap..].join(" "))
}

fn remember_replay_chunk(replay: &mut VecDeque<Vec<u8>>, chunk: Vec<u8>) {
    if replay.len() == MAX_REPLAY_CHUNKS {
        replay.pop_front();
    }
    replay.push_back(chunk);
}

fn resample_pcm16_mono(pcm: &[u8], source_rate: u32, target_rate: u32) -> Vec<u8> {
    if source_rate == target_rate || pcm.len() < 4 {
        return pcm.to_vec();
    }
    let samples = pcm
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32)
        .collect::<Vec<_>>();
    let output_len = ((samples.len() as u64 * target_rate as u64) / source_rate as u64) as usize;
    let ratio = source_rate as f64 / target_rate as f64;
    let mut output = Vec::with_capacity(output_len * 2);
    for output_index in 0..output_len {
        let position = output_index as f64 * ratio;
        let index = position.floor() as usize;
        let fraction = (position - index as f64) as f32;
        let current = samples.get(index).copied().unwrap_or_default();
        let next = samples.get(index + 1).copied().unwrap_or(current);
        let sample = (current + (next - current) * fraction)
            .round()
            .clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        output.extend_from_slice(&sample.to_le_bytes());
    }
    output
}

#[derive(Debug)]
pub enum RealtimeAudioCommand {
    Pcm(Vec<u8>),
    Finish,
    Cancel,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeConnectionRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub endpoint: String,
    pub target_language: Option<String>,
    pub purpose: String,
    #[serde(default)]
    pub voice_output: bool,
    pub voice: Option<String>,
    pub voice_speed: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct RealtimeConnectionResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizedRealtimeStatus {
    Started,
    Partial,
    Final,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedRealtimeEvent {
    pub status: NormalizedRealtimeStatus,
    pub original: String,
    pub translated: String,
    pub message: Option<String>,
}

impl NormalizedRealtimeEvent {
    fn started() -> Self {
        Self {
            status: NormalizedRealtimeStatus::Started,
            original: String::new(),
            translated: String::new(),
            message: None,
        }
    }

    fn text(status: NormalizedRealtimeStatus, original: String) -> Self {
        Self {
            status,
            original,
            translated: String::new(),
            message: None,
        }
    }

    pub(crate) fn error(message: String) -> Self {
        Self {
            status: NormalizedRealtimeStatus::Error,
            original: String::new(),
            translated: String::new(),
            message: Some(message),
        }
    }
}

fn value_text(value: &Value, paths: &[&[&str]]) -> String {
    paths
        .iter()
        .find_map(|path| {
            let mut current = value;
            for key in *path {
                current = current.get(*key)?;
            }
            current.as_str().map(str::to_string)
        })
        .unwrap_or_default()
}

pub trait StreamingSttAdapter {
    fn adapter_id(&self) -> &str;
    fn parse_event(&self, payload: &str) -> Result<Option<NormalizedRealtimeEvent>, String>;
}

pub trait RealtimeTranslationAdapter {
    fn adapter_id(&self) -> &str;
    fn parse_event(&self, payload: &str) -> Result<Option<NormalizedRealtimeEvent>, String>;
}

/// Protocol adapter shared by provider transports. Talkis Cloud intentionally
/// implements the same event contract elsewhere, but is not exposed until its
/// realtime proxy exists.
pub struct ProviderRealtimeAdapter<'a> {
    provider: &'a str,
}

impl<'a> ProviderRealtimeAdapter<'a> {
    pub fn new(provider: &'a str) -> Self {
        Self { provider }
    }
}

impl StreamingSttAdapter for ProviderRealtimeAdapter<'_> {
    fn adapter_id(&self) -> &str {
        self.provider
    }

    fn parse_event(&self, payload: &str) -> Result<Option<NormalizedRealtimeEvent>, String> {
        parse_streaming_stt_provider_event(self.provider, payload)
    }
}

impl RealtimeTranslationAdapter for ProviderRealtimeAdapter<'_> {
    fn adapter_id(&self) -> &str {
        self.provider
    }

    fn parse_event(&self, payload: &str) -> Result<Option<NormalizedRealtimeEvent>, String> {
        parse_translation_provider_event(self.provider, payload)
    }
}

/// Frontend-independent contract for the future Talkis Cloud realtime proxy.
/// It deliberately has no connection URL or UI catalog entry in this workspace.
pub struct TalkisCloudRealtimeAdapter;

impl RealtimeTranslationAdapter for TalkisCloudRealtimeAdapter {
    fn adapter_id(&self) -> &str {
        "talkis-cloud"
    }

    fn parse_event(&self, payload: &str) -> Result<Option<NormalizedRealtimeEvent>, String> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|err| format!("Invalid Talkis Cloud realtime event: {}", err))?;
        let status = match value.get("status").and_then(Value::as_str) {
            Some("started") => NormalizedRealtimeStatus::Started,
            Some("partial") => NormalizedRealtimeStatus::Partial,
            Some("final") => NormalizedRealtimeStatus::Final,
            Some("error") => NormalizedRealtimeStatus::Error,
            _ => return Ok(None),
        };
        Ok(Some(NormalizedRealtimeEvent {
            status,
            original: value
                .get("original")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            translated: value
                .get("translated")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            message: value
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string),
        }))
    }
}

pub fn parse_streaming_stt_event(
    provider: &str,
    payload: &str,
) -> Result<Option<NormalizedRealtimeEvent>, String> {
    StreamingSttAdapter::parse_event(&ProviderRealtimeAdapter::new(provider), payload)
}

fn parse_streaming_stt_provider_event(
    provider: &str,
    payload: &str,
) -> Result<Option<NormalizedRealtimeEvent>, String> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|err| format!("Invalid {} realtime event: {}", provider, err))?;
    let event_type = value
        .get("type")
        .or_else(|| value.get("message_type"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    let event = match provider {
        "openai" => {
            if event_type.contains("error") {
                Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["error", "message"], &["message"]],
                )))
            } else if event_type.ends_with(".delta") {
                Some(NormalizedRealtimeEvent::text(
                    NormalizedRealtimeStatus::Partial,
                    value_text(&value, &[&["delta"], &["transcript"], &["text"]]),
                ))
            } else if event_type.ends_with(".completed") || event_type.ends_with(".done") {
                Some(NormalizedRealtimeEvent::text(
                    NormalizedRealtimeStatus::Final,
                    value_text(&value, &[&["transcript"], &["text"]]),
                ))
            } else if event_type.contains("created") || event_type.contains("updated") {
                Some(NormalizedRealtimeEvent::started())
            } else {
                None
            }
        }
        "deepgram" => {
            if event_type == "Results" {
                let text = value_text(&value, &[&["channel", "alternatives", "0", "transcript"]]);
                let text = value
                    .pointer("/channel/alternatives/0/transcript")
                    .and_then(Value::as_str)
                    .unwrap_or(&text)
                    .to_string();
                Some(NormalizedRealtimeEvent::text(
                    if value
                        .get("is_final")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        NormalizedRealtimeStatus::Final
                    } else {
                        NormalizedRealtimeStatus::Partial
                    },
                    text,
                ))
            } else if event_type == "Metadata" {
                Some(NormalizedRealtimeEvent::started())
            } else if event_type == "Error" {
                Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["description"], &["message"]],
                )))
            } else {
                None
            }
        }
        "mistral" => {
            if event_type.contains("error") {
                Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["error", "message"], &["message"]],
                )))
            } else if event_type.contains("text.delta") || event_type.contains("text_delta") {
                Some(NormalizedRealtimeEvent::text(
                    NormalizedRealtimeStatus::Partial,
                    value_text(&value, &[&["text"], &["delta"]]),
                ))
            } else if event_type.contains("done") {
                Some(NormalizedRealtimeEvent::text(
                    NormalizedRealtimeStatus::Final,
                    value_text(&value, &[&["text"], &["transcript"]]),
                ))
            } else if event_type.contains("created") {
                Some(NormalizedRealtimeEvent::started())
            } else {
                None
            }
        }
        "elevenlabs" => match event_type {
            "session_started" => Some(NormalizedRealtimeEvent::started()),
            "partial_transcript" => Some(NormalizedRealtimeEvent::text(
                NormalizedRealtimeStatus::Partial,
                value_text(&value, &[&["text"]]),
            )),
            "committed_transcript" | "committed_transcript_with_timestamps" => {
                Some(NormalizedRealtimeEvent::text(
                    NormalizedRealtimeStatus::Final,
                    value_text(&value, &[&["text"]]),
                ))
            }
            kind if kind.contains("error")
                || kind == "quota_exceeded"
                || kind == "rate_limited" =>
            {
                Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["error"], &["message"]],
                )))
            }
            _ => None,
        },
        "assemblyai" => match event_type {
            "Begin" => Some(NormalizedRealtimeEvent::started()),
            "Turn" => Some(NormalizedRealtimeEvent::text(
                if value
                    .get("end_of_turn")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    NormalizedRealtimeStatus::Final
                } else {
                    NormalizedRealtimeStatus::Partial
                },
                value_text(&value, &[&["transcript"]]),
            )),
            "Termination" => Some(NormalizedRealtimeEvent::text(
                NormalizedRealtimeStatus::Final,
                String::new(),
            )),
            "Error" => Some(NormalizedRealtimeEvent::error(value_text(
                &value,
                &[&["error"], &["message"]],
            ))),
            _ => None,
        },
        "xai" => {
            if event_type.contains("error") {
                Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["error", "message"], &["message"]],
                )))
            } else if event_type.contains("session") {
                Some(NormalizedRealtimeEvent::started())
            } else if event_type.contains("transcript") || value.get("transcript").is_some() {
                Some(NormalizedRealtimeEvent::text(
                    if value
                        .get("is_final")
                        .and_then(Value::as_bool)
                        .unwrap_or(event_type.ends_with("done"))
                    {
                        NormalizedRealtimeStatus::Final
                    } else {
                        NormalizedRealtimeStatus::Partial
                    },
                    value_text(&value, &[&["transcript"], &["text"], &["delta"]]),
                ))
            } else {
                None
            }
        }
        other => return Err(format!("Unsupported realtime STT provider: {}", other)),
    };

    Ok(event)
}

pub fn parse_translation_event(
    provider: &str,
    payload: &str,
) -> Result<Option<NormalizedRealtimeEvent>, String> {
    RealtimeTranslationAdapter::parse_event(&ProviderRealtimeAdapter::new(provider), payload)
}

fn parse_translation_provider_event(
    provider: &str,
    payload: &str,
) -> Result<Option<NormalizedRealtimeEvent>, String> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|err| format!("Invalid {} translation event: {}", provider, err))?;
    match provider {
        "openai" => {
            let event_type = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if event_type.contains("error") {
                return Ok(Some(NormalizedRealtimeEvent::error(value_text(
                    &value,
                    &[&["error", "message"], &["message"]],
                ))));
            }
            if event_type.contains("session")
                && (event_type.contains("created") || event_type.contains("updated"))
            {
                return Ok(Some(NormalizedRealtimeEvent::started()));
            }
            let mut event = NormalizedRealtimeEvent::text(
                if event_type.ends_with(".done") || event_type.ends_with(".completed") {
                    NormalizedRealtimeStatus::Final
                } else {
                    NormalizedRealtimeStatus::Partial
                },
                String::new(),
            );
            if event_type.contains("input_audio_transcription") {
                event.original = value_text(&value, &[&["delta"], &["transcript"], &["text"]]);
            } else if event_type.contains("output_text")
                || event_type.contains("transcript")
                || event_type.contains("translation")
            {
                event.translated = value_text(&value, &[&["delta"], &["transcript"], &["text"]]);
            } else {
                return Ok(None);
            }
            Ok(Some(event))
        }
        "gemini" => {
            if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
                return Ok(Some(NormalizedRealtimeEvent::error(message.to_string())));
            }
            if value.get("setupComplete").is_some() {
                return Ok(Some(NormalizedRealtimeEvent::started()));
            }
            let original = value
                .pointer("/serverContent/inputTranscription/text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let translated = value
                .pointer("/serverContent/outputTranscription/text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if original.is_empty() && translated.is_empty() {
                return Ok(None);
            }
            Ok(Some(NormalizedRealtimeEvent {
                status: if value
                    .pointer("/serverContent/turnComplete")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    NormalizedRealtimeStatus::Final
                } else {
                    NormalizedRealtimeStatus::Partial
                },
                original,
                translated,
                message: None,
            }))
        }
        other => Err(format!(
            "Unsupported realtime translation provider: {}",
            other
        )),
    }
}

fn websocket_scheme(endpoint: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(endpoint).map_err(|err| format!("Invalid realtime endpoint: {}", err))?;
    match url.scheme() {
        "http" => url
            .set_scheme("ws")
            .map_err(|_| "Invalid realtime endpoint scheme".to_string())?,
        "https" => url
            .set_scheme("wss")
            .map_err(|_| "Invalid realtime endpoint scheme".to_string())?,
        "ws" | "wss" => {}
        _ => return Err("Realtime endpoint must use http(s) or ws(s).".to_string()),
    }
    Ok(url)
}

fn resolved_openai_realtime_model(req: &RealtimeConnectionRequest) -> &str {
    if req.purpose == "translation" && req.model.trim() == "gpt-realtime-translate" {
        return "gpt-realtime";
    }

    req.model.trim()
}

fn resolved_openai_transcription_model(model: &str) -> &str {
    if model.trim() == "gpt-realtime-whisper" {
        return "gpt-4o-mini-transcribe";
    }

    model.trim()
}

fn connection_url(req: &RealtimeConnectionRequest) -> Result<Url, String> {
    let mut url = websocket_scheme(req.endpoint.trim())?;
    match req.provider.as_str() {
        "openai" => {
            url.set_path("/v1/realtime");
            let mut query = url.query_pairs_mut();
            query.clear();
            if req.purpose == "stt" {
                query.append_pair("intent", "transcription");
            } else {
                query.append_pair("model", resolved_openai_realtime_model(req));
            }
        }
        "gemini" => {
            url.set_path(
                "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
            );
            url.query_pairs_mut()
                .clear()
                .append_pair("key", req.api_key.trim());
        }
        "deepgram" => {
            url.set_path("/v1/listen");
            url.query_pairs_mut()
                .clear()
                .append_pair("model", req.model.trim())
                .append_pair("encoding", "linear16")
                .append_pair("sample_rate", "16000")
                .append_pair("channels", "1")
                .append_pair("interim_results", "true")
                .append_pair("endpointing", "300");
        }
        "mistral" => {
            url.set_path("/v1/audio/transcriptions/realtime");
            url.query_pairs_mut()
                .clear()
                .append_pair("model", req.model.trim())
                .append_pair("encoding", "pcm_s16le")
                .append_pair("sample_rate", "16000");
        }
        "elevenlabs" => {
            url.set_path("/v1/speech-to-text/realtime");
            url.query_pairs_mut()
                .clear()
                .append_pair("model_id", req.model.trim());
        }
        "assemblyai" => {
            url.set_path("/v3/ws");
            url.query_pairs_mut()
                .clear()
                .append_pair("speech_model", req.model.trim())
                .append_pair("sample_rate", "16000");
        }
        "xai" => {
            url.set_path("/v1/stt");
            url.query_pairs_mut()
                .clear()
                .append_pair("sample_rate", "16000")
                .append_pair("encoding", "pcm")
                .append_pair("interim_results", "true");
        }
        other => return Err(format!("Unsupported realtime provider: {}", other)),
    }
    Ok(url)
}

fn setup_message(req: &RealtimeConnectionRequest) -> Option<Value> {
    if req.provider == "gemini" {
        return Some(json!({
            "setup": {
                "model": format!("models/{}", req.model.trim()),
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "inputAudioTranscription": {},
                    "outputAudioTranscription": {},
                    "translationConfig": {
                        "targetLanguageCode": req.target_language.as_deref().unwrap_or("en"),
                        "echoTargetLanguage": true
                    }
                }
            }
        }));
    }
    if req.provider == "openai" && req.purpose == "translation" {
        let output_modality = if req.voice_output { "audio" } else { "text" };
        let mut message = json!({
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": resolved_openai_realtime_model(req),
                "output_modalities": [output_modality],
                "instructions": format!(
                    "Translate all spoken input into {}. Output only the translation.",
                    req.target_language.as_deref().unwrap_or("en")
                ),
                "audio": {
                    "input": {
                        "format": { "type": "audio/pcm", "rate": OPENAI_PCM_RATE },
                        "transcription": { "model": "gpt-4o-mini-transcribe" },
                        // Video can contain uninterrupted speech for minutes.
                        // Talkis commits short turns itself so translation does
                        // not wait for server-side end-of-speech detection.
                        "turn_detection": null
                    }
                }
            }
        });
        if req.voice_output {
            message["session"]["audio"]["output"] = json!({
                "format": { "type": "audio/pcm", "rate": OPENAI_PCM_RATE },
                "voice": req.voice.as_deref().unwrap_or("marin"),
                "speed": req.voice_speed.unwrap_or(1.05).clamp(0.25, 1.5)
            });
        }
        return Some(message);
    }
    if req.provider == "openai" {
        let mut transcription = json!({
            "model": resolved_openai_transcription_model(&req.model)
        });
        if let Some(language) = req
            .target_language
            .as_deref()
            .map(str::trim)
            .filter(|language| !language.is_empty())
        {
            transcription["language"] = Value::String(language.to_string());
        }
        return Some(json!({
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": { "type": "audio/pcm", "rate": OPENAI_PCM_RATE },
                        "transcription": transcription
                    }
                }
            }
        }));
    }
    None
}

fn audio_message(provider: &str, pcm: Vec<u8>, commit: bool) -> Message {
    use base64::Engine;
    match provider {
        "openai" => {
            let pcm = resample_pcm16_mono(&pcm, COMMON_PCM_RATE, OPENAI_PCM_RATE);
            Message::Text(
                json!({
                    "type": "input_audio_buffer.append",
                    "audio": base64::engine::general_purpose::STANDARD.encode(pcm)
                })
                .to_string()
                .into(),
            )
        }
        "elevenlabs" => Message::Text(
            json!({
                "message_type": "input_audio_chunk",
                "audio_base_64": base64::engine::general_purpose::STANDARD.encode(pcm),
                "sample_rate": 16000,
                "commit": commit
            })
            .to_string()
            .into(),
        ),
        _ => Message::Binary(pcm.into()),
    }
}

fn translation_audio_message(provider: &str, pcm: Vec<u8>) -> Message {
    use base64::Engine;
    if provider == "gemini" {
        return Message::Text(
            json!({
                "realtimeInput": {
                    "audio": {
                        "data": base64::engine::general_purpose::STANDARD.encode(pcm),
                        "mimeType": "audio/pcm;rate=16000"
                    }
                }
            })
            .to_string()
            .into(),
        );
    }
    audio_message(provider, pcm, false)
}

fn translation_finish_message(provider: &str) -> Option<Message> {
    if provider == "gemini" {
        return Some(Message::Text(
            json!({ "realtimeInput": { "audioStreamEnd": true } })
                .to_string()
                .into(),
        ));
    }

    // OpenAI commits are coordinated with response completion in
    // `run_translation`, including the final short segment.
    if provider == "openai" {
        return None;
    }

    finish_message(provider)
}

fn openai_translation_commit_messages(voice_output: bool) -> [Message; 2] {
    [
        Message::Text(
            json!({ "type": "input_audio_buffer.commit" })
                .to_string()
                .into(),
        ),
        Message::Text(
            json!({
                "type": "response.create",
                "response": {
                    "output_modalities": [if voice_output { "audio" } else { "text" }]
                }
            })
            .to_string()
            .into(),
        ),
    ]
}

fn openai_output_audio(payload: &str) -> Result<Option<Vec<u8>>, String> {
    use base64::Engine;

    let value: Value = serde_json::from_str(payload)
        .map_err(|error| format!("Invalid OpenAI realtime event: {}", error))?;
    if value.get("type").and_then(Value::as_str) != Some("response.output_audio.delta") {
        return Ok(None);
    }
    let encoded = value
        .get("delta")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenAI audio delta did not contain PCM data.".to_string())?;
    let pcm = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("OpenAI audio delta is not valid base64: {}", error))?;
    if pcm.len() % 2 != 0 {
        return Err("OpenAI audio delta contained incomplete PCM16 data.".to_string());
    }
    Ok(Some(pcm))
}

fn finish_message(provider: &str) -> Option<Message> {
    match provider {
        "openai" => Some(Message::Text(
            json!({ "type": "input_audio_buffer.commit" })
                .to_string()
                .into(),
        )),
        "deepgram" => Some(Message::Text(
            json!({ "type": "CloseStream" }).to_string().into(),
        )),
        "elevenlabs" => Some(audio_message(provider, Vec::new(), true)),
        "assemblyai" => Some(Message::Text(
            json!({ "type": "Terminate" }).to_string().into(),
        )),
        "xai" => Some(Message::Text(
            json!({ "type": "audio.done" }).to_string().into(),
        )),
        _ => None,
    }
}

async fn connect_realtime_socket(
    req: &RealtimeConnectionRequest,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    String,
> {
    let request = client_request(req)?;
    let (mut socket, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| "Realtime connection timed out.".to_string())?
        .map_err(|err| format!("Realtime connection failed: {}", err))?;
    if let Some(setup) = setup_message(req) {
        if req.provider == "openai" {
            let initial = tokio::time::timeout(CONNECT_TIMEOUT, socket.next())
                .await
                .map_err(|_| "OpenAI did not create the realtime session in time.".to_string())?;
            match initial {
                Some(Ok(Message::Text(text))) => {
                    if let Some(event) = if req.purpose == "translation" {
                        parse_translation_event(&req.provider, &text)?
                    } else {
                        parse_streaming_stt_event(&req.provider, &text)?
                    } {
                        if event.status == NormalizedRealtimeStatus::Error {
                            return Err(event.message.unwrap_or_else(|| {
                                "OpenAI rejected the realtime session.".to_string()
                            }));
                        }
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => {
                    return Err(format!("OpenAI realtime session failed: {}", error))
                }
                None => return Err("OpenAI closed the realtime session.".to_string()),
            }
        }
        socket
            .send(Message::Text(setup.to_string().into()))
            .await
            .map_err(|err| format!("Realtime setup failed: {}", err))?;
        let confirmation = tokio::time::timeout(CONNECT_TIMEOUT, socket.next())
            .await
            .map_err(|_| {
                "Realtime provider did not accept the session setup in time.".to_string()
            })?;
        match confirmation {
            Some(Ok(Message::Text(text))) => {
                let event = if req.purpose == "translation" {
                    parse_translation_event(&req.provider, &text)?
                } else {
                    parse_streaming_stt_event(&req.provider, &text)?
                };
                if let Some(event) = event {
                    if event.status == NormalizedRealtimeStatus::Error {
                        return Err(event.message.unwrap_or_else(|| {
                            "Realtime provider rejected the session setup.".to_string()
                        }));
                    }
                }
            }
            Some(Ok(_)) => {}
            Some(Err(error)) => return Err(format!("Realtime setup failed: {}", error)),
            None => return Err("Realtime provider closed during setup.".to_string()),
        }
    }
    Ok(socket)
}

/// Runs one remote STT stream. The bounded producer drops old callback-time audio
/// rather than ever blocking the platform audio thread; reconnect replays at most 2s.
pub async fn run_streaming_stt<F>(
    req: RealtimeConnectionRequest,
    mut commands: tokio::sync::mpsc::Receiver<RealtimeAudioCommand>,
    mut on_event: F,
) -> Result<String, String>
where
    F: FnMut(NormalizedRealtimeEvent),
{
    let mut replay = VecDeque::<Vec<u8>>::with_capacity(MAX_REPLAY_CHUNKS);
    let mut reconnect_index = 0usize;
    let mut final_parts = Vec::<String>::new();
    let mut openai_partial = String::new();
    let mut finishing = false;

    loop {
        let connection = connect_realtime_socket(&req);
        tokio::pin!(connection);
        let connection_result = loop {
            tokio::select! {
                result = &mut connection => break result,
                command = commands.recv() => {
                    match command {
                        Some(RealtimeAudioCommand::Pcm(chunk)) => {
                            remember_replay_chunk(&mut replay, chunk);
                        }
                        Some(RealtimeAudioCommand::Finish) | None => {
                            return Err("Realtime connection was unavailable when recording stopped; use batch fallback.".to_string());
                        }
                        Some(RealtimeAudioCommand::Cancel) => {
                            return Err("Realtime transcription cancelled.".to_string());
                        }
                    }
                }
            }
        };
        let mut socket = match connection_result {
            Ok(socket) => {
                logger::log_info(
                    "REALTIME_STT",
                    &format!("Realtime transport connected: provider={}", req.provider),
                );
                socket
            }
            Err(error) if reconnect_index < RECONNECT_DELAYS.len() => {
                logger::log_error(
                    "REALTIME_STT",
                    &format!(
                        "Realtime connection failed: provider={}, attempt={}, error={}",
                        req.provider,
                        reconnect_index + 1,
                        error
                    ),
                );
                tokio::time::sleep(RECONNECT_DELAYS[reconnect_index]).await;
                reconnect_index += 1;
                continue;
            }
            Err(error) => return Err(error),
        };
        reconnect_index = 0;
        on_event(NormalizedRealtimeEvent::started());
        let mut openai_commit_tracker = OpenAiCommitTracker::default();
        let mut openai_pending_commits = 0usize;
        for chunk in &replay {
            if req.provider == "openai" && !openai_commit_tracker.observe(chunk) {
                continue;
            }
            socket
                .send(audio_message(&req.provider, chunk.clone(), false))
                .await
                .map_err(|err| format!("Realtime replay failed: {}", err))?;
        }
        if req.provider == "openai" && openai_commit_tracker.should_commit() {
            socket
                .send(finish_message(&req.provider).expect("OpenAI commit message"))
                .await
                .map_err(|err| format!("Realtime replay commit failed: {}", err))?;
            openai_commit_tracker.reset();
            openai_pending_commits = 1;
        }

        let connection_result: Result<bool, String> = loop {
            tokio::select! {
                command = commands.recv(), if !finishing => {
                    match command {
                        Some(RealtimeAudioCommand::Pcm(chunk)) => {
                        remember_replay_chunk(&mut replay, chunk.clone());
                            if req.provider == "openai" && !openai_commit_tracker.observe(&chunk) {
                                continue;
                            }
                            if let Err(err) = socket.send(audio_message(&req.provider, chunk, false)).await {
                                break Err(format!("Realtime audio send failed: {}", err));
                            }
                            if req.provider == "openai" {
                                if openai_commit_tracker.should_commit()
                                    && openai_pending_commits == 0
                                {
                                    if let Some(message) = finish_message(&req.provider) {
                                        if let Err(err) = socket.send(message).await {
                                            break Err(format!("Realtime audio commit failed: {}", err));
                                        }
                                        openai_commit_tracker.reset();
                                        openai_pending_commits += 1;
                                    }
                                }
                            }
                        }
                        Some(RealtimeAudioCommand::Finish) | None => {
                            finishing = true;
                            if req.provider == "openai" {
                                if openai_pending_commits == 0 {
                                    if !openai_commit_tracker.has_speech() {
                                        break Ok(true);
                                    }
                                    if let Some(message) = finish_message(&req.provider) {
                                        let _ = socket.send(message).await;
                                        openai_commit_tracker.reset();
                                        openai_pending_commits = 1;
                                    }
                                }
                            } else if let Some(message) = finish_message(&req.provider) {
                                let _ = socket.send(message).await;
                            }
                        }
                        Some(RealtimeAudioCommand::Cancel) => {
                            let _ = socket.close(None).await;
                            return Err("Realtime transcription cancelled.".to_string());
                        }
                    }
                }
                incoming = socket.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if let Some(mut event) = parse_streaming_stt_event(&req.provider, &text)? {
                                if event.status == NormalizedRealtimeStatus::Error {
                                    break Err(event.message.clone().unwrap_or_else(|| "Realtime provider error.".to_string()));
                                }
                                if event.status == NormalizedRealtimeStatus::Partial && req.provider == "openai" {
                                    openai_partial.push_str(&event.original);
                                    event.original = merge_transcript_text(
                                        &final_parts.join(" "),
                                        &openai_partial,
                                    );
                                }
                                if event.status == NormalizedRealtimeStatus::Final {
                                    let final_text = if event.original.trim().is_empty() && req.provider == "openai" {
                                        openai_partial.trim()
                                    } else {
                                        event.original.trim()
                                    };
                                    if req.provider == "openai" {
                                        let merged = merge_transcript_text(
                                            &final_parts.join(" "),
                                            final_text,
                                        );
                                        final_parts.clear();
                                        if !merged.is_empty() {
                                            final_parts.push(merged);
                                        }
                                        openai_partial.clear();
                                        openai_pending_commits = openai_pending_commits.saturating_sub(1);
                                        event.original = final_parts.join(" ");
                                    } else if !final_text.is_empty() {
                                        final_parts.push(final_text.to_string());
                                    }
                                }
                                let is_final = event.status == NormalizedRealtimeStatus::Final;
                                on_event(event);
                                if finishing && is_final {
                                    if req.provider != "openai" {
                                        break Ok(true);
                                    }
                                    if openai_pending_commits == 0 && openai_commit_tracker.has_speech() {
                                        if let Some(message) = finish_message(&req.provider) {
                                            if let Err(err) = socket.send(message).await {
                                                break Err(format!("Realtime audio commit failed: {}", err));
                                            }
                                            openai_commit_tracker.reset();
                                            openai_pending_commits = 1;
                                        }
                                    } else if openai_pending_commits == 0 {
                                        break Ok(true);
                                    }
                                } else if req.provider == "openai"
                                    && is_final
                                    && openai_pending_commits == 0
                                    && openai_commit_tracker.should_commit()
                                {
                                    if let Some(message) = finish_message(&req.provider) {
                                        if let Err(err) = socket.send(message).await {
                                            break Err(format!("Realtime audio commit failed: {}", err));
                                        }
                                        openai_commit_tracker.reset();
                                        openai_pending_commits = 1;
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            if finishing { break Ok(true); }
                            break Err("Realtime stream closed unexpectedly.".to_string());
                        }
                        Some(Ok(_)) => {}
                        Some(Err(err)) => break Err(format!("Realtime receive failed: {}", err)),
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(12)), if finishing => {
                    break Ok(true);
                }
            }
        };

        match connection_result {
            Ok(done) if done => {
                let _ = socket.close(None).await;
                return final_transcript(&final_parts);
            }
            Err(_error) if !finishing && reconnect_index < RECONNECT_DELAYS.len() => {
                tokio::time::sleep(RECONNECT_DELAYS[reconnect_index]).await;
                reconnect_index += 1;
                continue;
            }
            Err(error) => return Err(error),
            _ => return final_transcript(&final_parts),
        }
    }
}

pub async fn run_translation<F, G>(
    req: RealtimeConnectionRequest,
    mut commands: tokio::sync::mpsc::Receiver<RealtimeAudioCommand>,
    mut on_event: F,
    mut on_audio: G,
) -> Result<(), String>
where
    F: FnMut(NormalizedRealtimeEvent),
    G: FnMut(Vec<u8>),
{
    let mut replay = VecDeque::<Vec<u8>>::with_capacity(MAX_REPLAY_CHUNKS);
    let mut reconnect_index = 0usize;
    let mut finishing = false;
    let mut stable_text = StableTranslationText::default();

    loop {
        let mut socket = match connect_realtime_socket(&req).await {
            Ok(socket) => socket,
            Err(error) if reconnect_index < RECONNECT_DELAYS.len() => {
                logger::log_error(
                    "LIVE_TRANSLATION",
                    &format!(
                        "provider={} stage=connect attempt={} error={}",
                        req.provider,
                        reconnect_index + 1,
                        error
                    ),
                );
                tokio::time::sleep(RECONNECT_DELAYS[reconnect_index]).await;
                reconnect_index += 1;
                continue;
            }
            Err(error) => return Err(error),
        };
        reconnect_index = 0;
        on_event(NormalizedRealtimeEvent::started());
        let mut openai_commit_tracker = OpenAiCommitTracker::default();
        let mut openai_response_active = false;
        for chunk in &replay {
            if req.provider == "openai" {
                openai_commit_tracker.observe(chunk);
            }
            socket
                .send(translation_audio_message(&req.provider, chunk.clone()))
                .await
                .map_err(|err| format!("Translation replay failed: {}", err))?;
        }

        let result: Result<(), String> = 'stream: loop {
            tokio::select! {
                command = commands.recv(), if !finishing => match command {
                    Some(RealtimeAudioCommand::Pcm(chunk)) => {
                        if req.provider == "openai" {
                            openai_commit_tracker.observe(&chunk);
                        }
                            remember_replay_chunk(&mut replay, chunk.clone());
                        if let Err(err) = socket.send(translation_audio_message(&req.provider, chunk)).await {
                            break Err(format!("Translation audio send failed: {}", err));
                        }
                        if req.provider == "openai"
                            && openai_commit_tracker.should_commit()
                            && !openai_response_active
                        {
                            logger::log_info(
                                "LIVE_TRANSLATION",
                                &format!(
                                    "provider=openai stage=segment_commit reason=duration chunks={}",
                                    openai_commit_tracker.active_chunks
                                ),
                            );
                            for message in openai_translation_commit_messages(req.voice_output) {
                                if let Err(err) = socket.send(message).await {
                                    break 'stream Err(format!("Translation segment commit failed: {}", err));
                                }
                            }
                            openai_commit_tracker.reset();
                            openai_response_active = true;
                        }
                    }
                    Some(RealtimeAudioCommand::Finish) | None => {
                        finishing = true;
                        if req.provider == "openai"
                            && openai_commit_tracker.has_speech()
                            && !openai_response_active
                        {
                            logger::log_info(
                                "LIVE_TRANSLATION",
                                &format!(
                                    "provider=openai stage=segment_commit reason=finish chunks={}",
                                    openai_commit_tracker.active_chunks
                                ),
                            );
                            for message in openai_translation_commit_messages(req.voice_output) {
                                if let Err(err) = socket.send(message).await {
                                    break 'stream Err(format!("Final translation segment commit failed: {}", err));
                                }
                            }
                            openai_commit_tracker.reset();
                            openai_response_active = true;
                        } else if req.provider == "openai" && !openai_response_active {
                            break Ok(());
                        } else if let Some(message) = translation_finish_message(&req.provider) {
                            let _ = socket.send(message).await;
                        }
                    }
                    Some(RealtimeAudioCommand::Cancel) => {
                        let _ = socket.close(None).await;
                        return Err("Realtime translation cancelled.".to_string());
                    }
                },
                incoming = socket.next() => match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if req.provider == "openai" && req.voice_output {
                            if let Some(pcm) = openai_output_audio(&text)? {
                                on_audio(pcm);
                            }
                        }
                        if req.provider == "gemini" {
                            let rotate = serde_json::from_str::<Value>(&text)
                                .ok()
                                .is_some_and(|value| value.get("goAway").is_some());
                            if rotate {
                                break Err("Gemini requested session rotation.".to_string());
                            }
                        }
                        let openai_response_done = req.provider == "openai"
                            && serde_json::from_str::<Value>(&text)
                                .ok()
                                .and_then(|value| value.get("type").and_then(Value::as_str).map(str::to_owned))
                                .is_some_and(|event_type| event_type == "response.done");
                        if let Some(event) = parse_translation_event(&req.provider, &text)?
                            .and_then(|event| stable_text.apply(&req.provider, &text, event))
                        {
                            if event.status == NormalizedRealtimeStatus::Error {
                                break Err(event.message.clone().unwrap_or_else(|| "Translation provider error.".to_string()));
                            }
                            on_event(event);
                        }
                        if openai_response_done {
                            openai_response_active = false;
                            if openai_commit_tracker.has_speech()
                                && (finishing || openai_commit_tracker.should_commit())
                            {
                                logger::log_info(
                                    "LIVE_TRANSLATION",
                                    &format!(
                                        "provider=openai stage=segment_commit reason=response_done chunks={} finishing={}",
                                        openai_commit_tracker.active_chunks, finishing
                                    ),
                                );
                                for message in openai_translation_commit_messages(req.voice_output) {
                                    if let Err(err) = socket.send(message).await {
                                        break 'stream Err(format!("Queued translation segment commit failed: {}", err));
                                    }
                                }
                                openai_commit_tracker.reset();
                                openai_response_active = true;
                            } else if finishing {
                                break Ok(());
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        if finishing { break Ok(()); }
                        break Err("Translation stream closed unexpectedly.".to_string());
                    }
                    Some(Ok(_)) => {}
                    Some(Err(err)) => break Err(format!("Translation receive failed: {}", err)),
                },
                _ = tokio::time::sleep(Duration::from_secs(12)), if finishing => break Ok(()),
            }
        };

        match result {
            Ok(()) => {
                let _ = socket.close(None).await;
                return Ok(());
            }
            Err(error) if !finishing && reconnect_index < RECONNECT_DELAYS.len() => {
                logger::log_error(
                    "LIVE_TRANSLATION",
                    &format!(
                        "provider={} stage=stream_reconnect attempt={} error={}",
                        req.provider,
                        reconnect_index + 1,
                        error
                    ),
                );
                tokio::time::sleep(RECONNECT_DELAYS[reconnect_index]).await;
                reconnect_index += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn client_request(
    req: &RealtimeConnectionRequest,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let url = connection_url(req)?;
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|err| format!("Invalid WebSocket request: {}", err))?;
    let headers = request.headers_mut();
    let key = req.api_key.trim();
    match req.provider.as_str() {
        "gemini" => {}
        "deepgram" => {
            headers.insert(
                "Authorization",
                format!("Token {}", key)
                    .parse()
                    .map_err(|_| "Invalid API key".to_string())?,
            );
        }
        "elevenlabs" => {
            headers.insert(
                "xi-api-key",
                key.parse().map_err(|_| "Invalid API key".to_string())?,
            );
        }
        _ => {
            headers.insert(
                "Authorization",
                format!("Bearer {}", key)
                    .parse()
                    .map_err(|_| "Invalid API key".to_string())?,
            );
        }
    }
    Ok(request)
}

#[tauri::command]
pub async fn test_realtime_connection(
    req: RealtimeConnectionRequest,
) -> Result<RealtimeConnectionResult, String> {
    if req.api_key.trim().is_empty() || req.model.trim().is_empty() {
        return Ok(RealtimeConnectionResult {
            success: false,
            message: "Укажите API-ключ и модель.".to_string(),
        });
    }
    let has_setup = setup_message(&req).is_some();
    let mut socket = match connect_realtime_socket(&req).await {
        Ok(socket) => socket,
        Err(message) => {
            return Ok(RealtimeConnectionResult {
                success: false,
                message,
            })
        }
    };

    if has_setup {
        let _ = socket.close(None).await;
        return Ok(RealtimeConnectionResult {
            success: true,
            message: "Realtime session verified.".to_string(),
        });
    }

    let first = tokio::time::timeout(CONNECT_TIMEOUT, socket.next()).await;
    let result = match first {
        Ok(Some(Ok(Message::Text(text)))) => {
            let parsed = if req.purpose == "translation" {
                parse_translation_event(&req.provider, &text)
            } else {
                parse_streaming_stt_event(&req.provider, &text)
            };
            match parsed {
                Ok(Some(event)) if event.status == NormalizedRealtimeStatus::Error => {
                    RealtimeConnectionResult {
                        success: false,
                        message: event.message.unwrap_or_else(|| {
                            "Realtime provider rejected the session.".to_string()
                        }),
                    }
                }
                Ok(_) => RealtimeConnectionResult {
                    success: true,
                    message: "Realtime session verified.".to_string(),
                },
                Err(message) => RealtimeConnectionResult {
                    success: false,
                    message,
                },
            }
        }
        Ok(Some(Ok(_))) => RealtimeConnectionResult {
            success: true,
            message: "Realtime session verified.".to_string(),
        },
        Ok(Some(Err(err))) => RealtimeConnectionResult {
            success: false,
            message: format!("Realtime session failed: {}", err),
        },
        Ok(None) => RealtimeConnectionResult {
            success: false,
            message: "Realtime session closed during verification.".to_string(),
        },
        Err(_) => RealtimeConnectionResult {
            success: false,
            message: "Realtime provider did not confirm the session in time.".to_string(),
        },
    };
    let _ = socket.close(None).await;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    fn voiced_pcm_chunk() -> Vec<u8> {
        let sample = 1_200i16.to_le_bytes();
        (0..COMMON_PCM_RATE / 10)
            .flat_map(|_| sample)
            .collect::<Vec<_>>()
    }

    #[test]
    fn parses_all_stt_provider_events() {
        let cases = [
            (
                "openai",
                r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"hello"}"#,
            ),
            (
                "deepgram",
                r#"{"type":"Results","is_final":false,"channel":{"alternatives":[{"transcript":"hello"}]}}"#,
            ),
            (
                "mistral",
                r#"{"type":"transcription.text.delta","text":"hello"}"#,
            ),
            (
                "elevenlabs",
                r#"{"message_type":"partial_transcript","text":"hello"}"#,
            ),
            (
                "assemblyai",
                r#"{"type":"Turn","transcript":"hello","end_of_turn":false}"#,
            ),
            (
                "xai",
                r#"{"type":"transcript.delta","transcript":"hello","is_final":false}"#,
            ),
        ];
        for (provider, payload) in cases {
            let event = parse_streaming_stt_event(provider, payload)
                .expect("parse")
                .expect("event");
            assert_eq!(
                event.status,
                NormalizedRealtimeStatus::Partial,
                "provider={}",
                provider
            );
            assert_eq!(event.original, "hello", "provider={}", provider);
        }
    }

    #[test]
    fn parses_both_translation_providers() {
        let openai = parse_translation_event(
            "openai",
            r#"{"type":"response.output_audio_transcript.delta","delta":"bonjour"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(openai.translated, "bonjour");
        let gemini = parse_translation_event("gemini", r#"{"serverContent":{"inputTranscription":{"text":"hello"},"outputTranscription":{"text":"bonjour"},"turnComplete":true}}"#).unwrap().unwrap();
        assert_eq!(gemini.original, "hello");
        assert_eq!(gemini.translated, "bonjour");
        assert_eq!(gemini.status, NormalizedRealtimeStatus::Final);
    }

    #[test]
    fn parses_openai_text_translation_events() {
        let partial = parse_translation_event(
            "openai",
            r#"{"type":"response.output_text.delta","delta":"Привет"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(partial.status, NormalizedRealtimeStatus::Partial);
        assert_eq!(partial.translated, "Привет");

        let final_event = parse_translation_event(
            "openai",
            r#"{"type":"response.output_text.done","text":"Привет, мир"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(final_event.status, NormalizedRealtimeStatus::Final);
        assert_eq!(final_event.translated, "Привет, мир");
    }

    #[test]
    fn decodes_openai_pcm_audio_deltas() {
        use base64::Engine;

        let pcm = [1u8, 0, 255, 127];
        let payload = json!({
            "type": "response.output_audio.delta",
            "delta": base64::engine::general_purpose::STANDARD.encode(pcm)
        })
        .to_string();
        assert_eq!(openai_output_audio(&payload).unwrap(), Some(pcm.to_vec()));
        assert_eq!(
            openai_output_audio(r#"{"type":"response.output_audio.done"}"#).unwrap(),
            None
        );
    }

    #[test]
    fn stabilizes_openai_translation_deltas_and_ignores_late_events() {
        let mut stable = StableTranslationText::default();
        let payloads = [
            r#"{"type":"response.output_text.delta","response_id":"response-1","delta":"Это"}"#,
            r#"{"type":"response.output_text.delta","response_id":"response-1","delta":" плавный"}"#,
            r#"{"type":"response.output_text.done","response_id":"response-1","text":"Это плавный текст"}"#,
        ];
        let expected = ["Это", "Это плавный", "Это плавный текст"];
        for (payload, expected) in payloads.into_iter().zip(expected) {
            let event = parse_translation_event("openai", payload)
                .unwrap()
                .and_then(|event| stable.apply("openai", payload, event))
                .expect("stabilized event");
            assert_eq!(event.translated, expected);
        }

        let late = r#"{"type":"response.output_text.delta","response_id":"response-1","delta":" опоздал"}"#;
        let late_event = parse_translation_event("openai", late)
            .unwrap()
            .and_then(|event| stable.apply("openai", late, event));
        assert!(late_event.is_none());

        let next = r#"{"type":"response.output_text.delta","response_id":"response-2","delta":"Следующая"}"#;
        let next_event = parse_translation_event("openai", next)
            .unwrap()
            .and_then(|event| stable.apply("openai", next, event))
            .expect("next response");
        assert_eq!(next_event.translated, "Следующая");
    }

    #[test]
    fn openai_translation_finish_is_coordinated_by_the_stream_loop() {
        assert!(translation_finish_message("openai").is_none());
        assert!(translation_finish_message("gemini").is_some());

        let messages = openai_translation_commit_messages(false);
        for (message, expected_type) in messages
            .iter()
            .zip(["input_audio_buffer.commit", "response.create"])
        {
            let Message::Text(payload) = message else {
                panic!("OpenAI commit message must be text")
            };
            let value: Value = serde_json::from_str(payload).unwrap();
            assert_eq!(
                value.get("type").and_then(Value::as_str),
                Some(expected_type)
            );
        }
        let audio_messages = openai_translation_commit_messages(true);
        let Message::Text(response) = &audio_messages[1] else {
            panic!("OpenAI response message must be text")
        };
        assert_eq!(
            serde_json::from_str::<Value>(response).unwrap()["response"]["output_modalities"][0],
            "audio"
        );
    }

    #[test]
    fn builds_provider_specific_urls_without_audio() {
        for provider in [
            "openai",
            "deepgram",
            "mistral",
            "elevenlabs",
            "assemblyai",
            "xai",
        ] {
            let request = RealtimeConnectionRequest {
                provider: provider.to_string(),
                api_key: "secret".to_string(),
                model: "model".to_string(),
                endpoint: match provider {
                    "deepgram" => "https://api.deepgram.com",
                    "mistral" => "https://api.mistral.ai",
                    "elevenlabs" => "https://api.elevenlabs.io",
                    "assemblyai" => "https://streaming.assemblyai.com",
                    "xai" => "https://api.x.ai",
                    _ => "https://api.openai.com",
                }
                .to_string(),
                target_language: None,
                purpose: "stt".to_string(),
                voice_output: false,
                voice: None,
                voice_speed: None,
            };
            assert_eq!(connection_url(&request).unwrap().scheme(), "wss");
        }
    }

    #[test]
    fn builds_openai_translation_with_ga_realtime_protocol() {
        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "secret".to_string(),
            model: "gpt-realtime-translate".to_string(),
            endpoint: "https://api.openai.com".to_string(),
            target_language: Some("ru".to_string()),
            purpose: "translation".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };

        let url = connection_url(&request).expect("OpenAI realtime URL");
        assert_eq!(url.path(), "/v1/realtime");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "model")
                .map(|(_, value)| value.into_owned()),
            Some("gpt-realtime".to_string())
        );

        let setup = setup_message(&request).expect("OpenAI session setup");
        assert_eq!(
            setup.pointer("/type").and_then(Value::as_str),
            Some("session.update")
        );
        assert_eq!(
            setup.pointer("/session/type").and_then(Value::as_str),
            Some("realtime")
        );
        assert_eq!(
            setup
                .pointer("/session/output_modalities/0")
                .and_then(Value::as_str),
            Some("text")
        );
        assert_eq!(
            setup.pointer("/session/model").and_then(Value::as_str),
            Some("gpt-realtime")
        );
        assert_eq!(
            setup.pointer("/session/audio/input/turn_detection"),
            Some(&Value::Null)
        );

        let audio_setup = setup_message(&RealtimeConnectionRequest {
            voice_output: true,
            voice: Some("cedar".to_string()),
            voice_speed: Some(1.1),
            ..request.clone()
        })
        .expect("OpenAI audio session setup");
        assert_eq!(
            audio_setup
                .pointer("/session/output_modalities/0")
                .and_then(Value::as_str),
            Some("audio")
        );
        assert_eq!(
            audio_setup
                .pointer("/session/audio/output/voice")
                .and_then(Value::as_str),
            Some("cedar")
        );
        assert_eq!(
            audio_setup
                .pointer("/session/audio/output/format/rate")
                .and_then(Value::as_u64),
            Some(24_000)
        );

        let websocket_request = client_request(&request).expect("OpenAI websocket request");
        assert!(!websocket_request.headers().contains_key("OpenAI-Beta"));
    }

    #[test]
    fn builds_openai_stt_as_a_transcription_session() {
        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "secret".to_string(),
            model: "gpt-realtime-whisper".to_string(),
            endpoint: "https://api.openai.com".to_string(),
            target_language: Some("ru".to_string()),
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };

        let url = connection_url(&request).expect("OpenAI transcription URL");
        assert_eq!(url.path(), "/v1/realtime");
        assert_eq!(url.query(), Some("intent=transcription"));

        let setup = setup_message(&request).expect("OpenAI transcription setup");
        assert_eq!(
            setup.pointer("/session/type").and_then(Value::as_str),
            Some("transcription")
        );
        assert_eq!(
            setup
                .pointer("/session/audio/input/transcription/model")
                .and_then(Value::as_str),
            Some("gpt-4o-mini-transcribe")
        );
        assert_eq!(
            setup
                .pointer("/session/audio/input/transcription/language")
                .and_then(Value::as_str),
            Some("ru")
        );
        assert!(setup
            .pointer("/session/audio/input/transcription/delay")
            .is_none());
    }

    #[test]
    fn replay_buffer_keeps_only_the_latest_two_seconds() {
        let mut replay = VecDeque::new();
        for index in 0..25u8 {
            remember_replay_chunk(&mut replay, vec![index]);
        }
        assert_eq!(replay.len(), MAX_REPLAY_CHUNKS);
        assert_eq!(replay.front(), Some(&vec![5]));
        assert_eq!(replay.back(), Some(&vec![24]));
    }

    #[test]
    fn resamples_common_pcm_to_openai_24khz() {
        let input = vec![0u8; (COMMON_PCM_RATE as usize / 10) * 2];
        let output = resample_pcm16_mono(&input, COMMON_PCM_RATE, OPENAI_PCM_RATE);
        assert_eq!(output.len(), (OPENAI_PCM_RATE as usize / 10) * 2);
    }

    #[test]
    fn openai_commit_tracker_ignores_silence_and_commits_at_phrase_end() {
        let mut tracker = OpenAiCommitTracker::default();
        assert!(!tracker.observe(&vec![0; 3_200]));
        assert!(!tracker.should_commit());

        assert!(tracker.observe(&voiced_pcm_chunk()));
        for _ in 0..OPENAI_SILENCE_COMMIT_CHUNKS {
            assert!(tracker.observe(&vec![0; 3_200]));
        }
        assert!(tracker.should_commit());
    }

    #[test]
    fn empty_realtime_result_requests_batch_fallback() {
        assert!(final_transcript(&[]).is_err());
    }

    #[test]
    fn merges_repeated_words_at_committed_audio_boundaries() {
        assert_eq!(
            merge_transcript_text("скачет очень сильно", "Очень сильно вот это да"),
            "скачет очень сильно вот это да"
        );
        assert_eq!(
            merge_transcript_text("текст в виджете", "виджете отображается стабильно"),
            "текст в виджете отображается стабильно"
        );
        assert_eq!(
            merge_transcript_text("первая фраза", "совсем другой текст"),
            "первая фраза совсем другой текст"
        );
    }

    #[tokio::test]
    async fn openai_translation_commits_continuous_audio_before_finish() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            socket
                .send(Message::Text(r#"{"type":"session.updated"}"#.into()))
                .await
                .unwrap();

            for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
                assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            }
            for expected_type in ["input_audio_buffer.commit", "response.create"] {
                let Some(Ok(Message::Text(payload))) = socket.next().await else {
                    panic!("missing OpenAI translation commit message")
                };
                let value: Value = serde_json::from_str(&payload).unwrap();
                assert_eq!(
                    value.get("type").and_then(Value::as_str),
                    Some(expected_type)
                );
            }

            socket
                .send(Message::Text(
                    r#"{"type":"response.output_text.delta","delta":"Привет"}"#.into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"type":"response.output_text.done","text":"Привет, мир"}"#.into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(r#"{"type":"response.done"}"#.into()))
                .await
                .unwrap();
            let _ = socket.next().await;
        });

        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-realtime".to_string(),
            endpoint: format!("http://{}", address),
            target_language: Some("ru".to_string()),
            purpose: "translation".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(OPENAI_MAX_COMMIT_CHUNKS + 1);
        let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run_translation(
            request,
            receiver,
            move |event| {
                if !event.translated.is_empty() {
                    let _ = event_sender.send((event.status, event.translated));
                }
            },
            |_| {},
        ));

        for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
            sender
                .send(RealtimeAudioCommand::Pcm(voiced_pcm_chunk()))
                .await
                .unwrap();
        }
        let partial = tokio::time::timeout(Duration::from_secs(3), event_receiver.recv())
            .await
            .expect("translation partial timeout")
            .expect("translation partial");
        let final_event = event_receiver.recv().await.expect("translation final");
        assert_eq!(partial.1, "Привет");
        assert_eq!(
            final_event,
            (NormalizedRealtimeStatus::Final, "Привет, мир".to_string())
        );

        sender.send(RealtimeAudioCommand::Finish).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("translation finish timeout")
            .expect("translation task")
            .expect("translation result");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn finish_interrupts_a_pending_websocket_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (accepted_sender, accepted_receiver) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            let _ = accepted_sender.send(());
            tokio::time::sleep(Duration::from_secs(2)).await;
        });
        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-realtime-whisper".to_string(),
            endpoint: format!("http://{}", address),
            target_language: None,
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        let task = tokio::spawn(run_streaming_stt(request, receiver, |_| {}));
        tokio::time::timeout(Duration::from_secs(1), accepted_receiver)
            .await
            .expect("server accept timeout")
            .expect("server accept signal");
        sender.send(RealtimeAudioCommand::Finish).await.unwrap();

        let error = tokio::time::timeout(Duration::from_millis(500), task)
            .await
            .expect("finish must interrupt connect")
            .expect("stream task")
            .expect_err("pending connection must fall back");
        assert!(error.contains("recording stopped"));
        server.abort();
    }

    #[test]
    fn parses_future_talkis_cloud_contract_without_exposing_transport() {
        let adapter = TalkisCloudRealtimeAdapter;
        assert_eq!(adapter.adapter_id(), "talkis-cloud");
        let event = adapter
            .parse_event(r#"{"status":"final","original":"hello","translated":"привет"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(event.status, NormalizedRealtimeStatus::Final);
        assert_eq!(event.translated, "привет");
    }

    #[tokio::test]
    async fn reconnects_with_recent_pcm_and_closes_gracefully() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (reconnected_sender, reconnected_receiver) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (first_stream, _) = listener.accept().await.unwrap();
            let mut first = accept_async(first_stream).await.unwrap();
            first
                .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(first.next().await, Some(Ok(Message::Text(_)))));
            first
                .send(Message::Text(r#"{"type":"session.updated"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(first.next().await, Some(Ok(Message::Text(_)))));
            first.close(None).await.unwrap();

            let (second_stream, _) = listener.accept().await.unwrap();
            let mut second = accept_async(second_stream).await.unwrap();
            second
                .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(second.next().await, Some(Ok(Message::Text(_)))));
            second
                .send(Message::Text(r#"{"type":"session.updated"}"#.into()))
                .await
                .unwrap();
            let replay = second.next().await;
            assert!(matches!(replay, Some(Ok(Message::Text(_)))));
            let _ = reconnected_sender.send(());
            let finish = second.next().await;
            assert!(matches!(finish, Some(Ok(Message::Text(_)))));
            second
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"hello"}"#.into(),
                ))
                .await
                .unwrap();
            let _ = second.next().await;
        });

        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            endpoint: format!("http://{}", address),
            target_language: None,
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        let task = tokio::spawn(run_streaming_stt(request, receiver, |_| {}));
        sender
            .send(RealtimeAudioCommand::Pcm(voiced_pcm_chunk()))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), reconnected_receiver)
            .await
            .expect("reconnect timeout")
            .expect("reconnect signal");
        sender.send(RealtimeAudioCommand::Finish).await.unwrap();

        let transcript = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("stream timeout")
            .expect("stream task")
            .expect("stream result");
        assert_eq!(transcript, "hello");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn openai_commits_audio_and_emits_cumulative_text_before_finish() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            socket
                .send(Message::Text(r#"{"type":"session.updated"}"#.into()))
                .await
                .unwrap();

            for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
                let audio = socket.next().await;
                assert!(matches!(audio, Some(Ok(Message::Text(_)))));
            }
            let commit = socket.next().await;
            let commit = match commit {
                Some(Ok(Message::Text(text))) => text,
                other => panic!("expected OpenAI commit, got {other:?}"),
            };
            assert_eq!(
                serde_json::from_str::<Value>(&commit).unwrap()["type"],
                "input_audio_buffer.commit"
            );

            socket
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"При"}"#
                        .into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"вет"}"#
                        .into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Привет"}"#
                        .into(),
                ))
                .await
                .unwrap();
            let _ = socket.next().await;
        });

        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-realtime-whisper".to_string(),
            endpoint: format!("http://{}", address),
            target_language: None,
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(OPENAI_MAX_COMMIT_CHUNKS + 1);
        let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
        let mut started_sender = Some(started_sender);
        let task = tokio::spawn(run_streaming_stt(request, receiver, move |event| {
            if event.status == NormalizedRealtimeStatus::Started {
                if let Some(sender) = started_sender.take() {
                    let _ = sender.send(());
                }
            } else if matches!(
                event.status,
                NormalizedRealtimeStatus::Partial | NormalizedRealtimeStatus::Final
            ) {
                let _ = event_sender.send((event.status, event.original));
            }
        }));
        tokio::time::timeout(Duration::from_secs(3), started_receiver)
            .await
            .expect("session start timeout")
            .expect("session start signal");

        for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
            sender
                .send(RealtimeAudioCommand::Pcm(voiced_pcm_chunk()))
                .await
                .unwrap();
        }

        let first = tokio::time::timeout(Duration::from_secs(3), event_receiver.recv())
            .await
            .expect("first partial timeout")
            .expect("first partial");
        let second = event_receiver.recv().await.expect("second partial");
        let final_event = event_receiver.recv().await.expect("final event");
        assert_eq!(first.1, "При");
        assert_eq!(second.1, "Привет");
        assert_eq!(
            final_event,
            (NormalizedRealtimeStatus::Final, "Привет".to_string())
        );

        sender.send(RealtimeAudioCommand::Finish).await.unwrap();
        let transcript = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("stream timeout")
            .expect("stream task")
            .expect("stream result");
        assert_eq!(transcript, "Привет");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn openai_serializes_commits_and_removes_boundary_overlap() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            socket
                .send(Message::Text(r#"{"type":"session.updated"}"#.into()))
                .await
                .unwrap();

            for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
                assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            }
            assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            for _ in 0..OPENAI_MAX_COMMIT_CHUNKS {
                assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            }
            assert!(
                tokio::time::timeout(Duration::from_millis(100), socket.next())
                    .await
                    .is_err()
            );

            socket
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"скачет очень сильно"}"#
                        .into(),
                ))
                .await
                .unwrap();
            let second_commit = socket.next().await;
            assert!(matches!(second_commit, Some(Ok(Message::Text(_)))));
            socket
                .send(Message::Text(
                    r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"очень сильно вот это да"}"#
                        .into(),
                ))
                .await
                .unwrap();
            let _ = socket.next().await;
        });

        let request = RealtimeConnectionRequest {
            provider: "openai".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-realtime-whisper".to_string(),
            endpoint: format!("http://{}", address),
            target_language: Some("ru".to_string()),
            purpose: "stt".to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(OPENAI_MAX_COMMIT_CHUNKS * 2 + 1);
        let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
        let mut started_sender = Some(started_sender);
        let task = tokio::spawn(run_streaming_stt(
            request,
            receiver,
            move |event| match event.status {
                NormalizedRealtimeStatus::Started => {
                    if let Some(sender) = started_sender.take() {
                        let _ = sender.send(());
                    }
                }
                NormalizedRealtimeStatus::Final => {
                    let _ = event_sender.send(event.original);
                }
                _ => {}
            },
        ));
        tokio::time::timeout(Duration::from_secs(3), started_receiver)
            .await
            .expect("session start timeout")
            .expect("session start signal");
        for _ in 0..OPENAI_MAX_COMMIT_CHUNKS * 2 {
            sender
                .send(RealtimeAudioCommand::Pcm(voiced_pcm_chunk()))
                .await
                .unwrap();
        }

        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), event_receiver.recv())
                .await
                .expect("first final timeout")
                .expect("first final"),
            "скачет очень сильно"
        );
        assert_eq!(
            event_receiver.recv().await.expect("second final"),
            "скачет очень сильно вот это да"
        );
        sender.send(RealtimeAudioCommand::Finish).await.unwrap();
        let transcript = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("stream timeout")
            .expect("stream task")
            .expect("stream result");
        assert_eq!(transcript, "скачет очень сильно вот это да");
        server.await.unwrap();
    }

    async fn verify_mock_handshake(
        provider: &str,
        purpose: &str,
        server_event: &'static str,
        expects_setup: bool,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let is_openai = provider == "openai";
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            if is_openai {
                socket
                    .send(Message::Text(r#"{"type":"session.created"}"#.into()))
                    .await
                    .unwrap();
            }
            if expects_setup {
                assert!(matches!(socket.next().await, Some(Ok(Message::Text(_)))));
            }
            socket
                .send(Message::Text(server_event.into()))
                .await
                .unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Close(_)))));
        });
        let result = test_realtime_connection(RealtimeConnectionRequest {
            provider: provider.to_string(),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            endpoint: format!("http://{}", address),
            target_language: Some("ru".to_string()),
            purpose: purpose.to_string(),
            voice_output: false,
            voice: None,
            voice_speed: None,
        })
        .await
        .unwrap();
        assert!(result.success, "provider={}: {}", provider, result.message);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn verifies_all_provider_parsers_through_local_websockets() {
        for (provider, event, setup) in [
            ("openai", r#"{"type":"session.updated"}"#, true),
            ("deepgram", r#"{"type":"Metadata"}"#, false),
            ("mistral", r#"{"type":"session.created"}"#, false),
            ("elevenlabs", r#"{"message_type":"session_started"}"#, false),
            ("assemblyai", r#"{"type":"Begin"}"#, false),
            ("xai", r#"{"type":"transcript.created"}"#, false),
        ] {
            verify_mock_handshake(provider, "stt", event, setup).await;
        }
        verify_mock_handshake(
            "openai",
            "translation",
            r#"{"type":"session.updated"}"#,
            true,
        )
        .await;
        verify_mock_handshake("gemini", "translation", r#"{"setupComplete":{}}"#, true).await;
    }
}
