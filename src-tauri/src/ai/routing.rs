use crate::local_stt;

pub(super) fn is_likely_local_url(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.contains("127.0.0.1") || normalized.contains("localhost")
}

pub(super) fn local_runtime_kind_from_endpoint(
    endpoint: Option<&str>,
) -> Option<local_stt::LocalRuntimeKind> {
    let whisper_url = resolve_whisper_url(endpoint);
    let models_url = resolve_whisper_models_url(&whisper_url);
    local_stt::managed_runtime_kind(&models_url)
}

pub(super) fn port_from_url(value: &str) -> Option<u16> {
    reqwest::Url::parse(value)
        .ok()
        .and_then(|url| url.port_or_known_default())
}

pub(super) fn resolve_whisper_url(endpoint: Option<&str>) -> String {
    endpoint
        .filter(|s| !s.is_empty())
        .map(|s| {
            let base = s.trim_end_matches('/');
            if base.ends_with("/transcriptions") {
                base.to_string()
            } else if base.ends_with("/audio") {
                format!("{}/transcriptions", base)
            } else {
                format!("{}/v1/audio/transcriptions", base)
            }
        })
        .unwrap_or_else(|| "https://api.openai.com/v1/audio/transcriptions".to_string())
}

pub(super) fn resolve_managed_transcription_url(base_url: &str) -> String {
    format!("{}/v1/audio/transcriptions", base_url.trim_end_matches('/'))
}

pub(super) fn resolve_managed_models_url(base_url: &str) -> String {
    format!("{}/v1/models", base_url.trim_end_matches('/'))
}

pub(super) fn resolve_whisper_models_url(whisper_url: &str) -> String {
    if let Some(base) = whisper_url.strip_suffix("/v1/audio/transcriptions") {
        return format!("{}/v1/models", base);
    }

    if let Some(base) = whisper_url.strip_suffix("/audio/transcriptions") {
        return format!("{}/models", base);
    }

    if let Some(base) = whisper_url.strip_suffix("/transcriptions") {
        return format!("{}/models", base);
    }

    format!("{}/v1/models", whisper_url.trim_end_matches('/'))
}

/// Resolve a user/runtime endpoint to an OpenAI-compatible chat-completions URL.
/// Empty endpoint falls back to OpenAI. Accepts a base, a `/v1` base, or a full
/// `/chat/completions` URL.
pub(super) fn resolve_chat_completions_url(endpoint: Option<&str>) -> String {
    endpoint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let base = value.trim_end_matches('/');
            if base.ends_with("/chat/completions") {
                base.to_string()
            } else if base.ends_with("/v1") {
                format!("{}/chat/completions", base)
            } else {
                format!("{}/v1/chat/completions", base)
            }
        })
        .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string())
}

pub(super) fn resolve_whisper_model_download_url(models_url: &str, model: &str) -> String {
    let encoded_model = percent_encode_path_segment(model);
    format!("{}/{}", models_url.trim_end_matches('/'), encoded_model)
}

fn percent_encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if is_unreserved {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{:02X}", byte));
        }
    }

    encoded
}
