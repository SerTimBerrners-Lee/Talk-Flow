use hound::WavReader;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Once;
use transcribe_cpp::{
    CommitPolicy, ExtSlot, Model, MoonshineStreamingOptions, ParakeetBufferedStreamOptions,
    ParakeetStreamOptions, RunExtension, RunOptions, Stream, StreamExtension, StreamOptions,
    TimestampKind, VoxtralRealtimeStreamOptions, WhisperRunOptions,
};

const SERVER_NAME: &str = "talkis-stt";
const RUNTIME_API_VERSION: u32 = 2;
const MAX_REQUEST_BYTES: usize = 128 * 1024 * 1024;
const WHISPER_RUN_EXT_KIND: u32 = 0x4E524857;
const PARAKEET_STREAM_EXT_KIND: u32 = 0x54534B50;
const PARAKEET_BUFFERED_STREAM_EXT_KIND: u32 = 0x53424B50;
const MOONSHINE_STREAMING_EXT_KIND: u32 = 0x5453534D;
const VOXTRAL_REALTIME_EXT_KIND: u32 = 0x54535256;
static INIT_TRANSCRIBE_CPP: Once = Once::new();

#[derive(Clone)]
struct RuntimeConfig {
    host: String,
    port: u16,
    data_dir: PathBuf,
    models_dir: PathBuf,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct WhisperModel {
    id: &'static str,
    aliases: &'static [&'static str],
    file_name: &'static str,
    gguf_file_name: &'static str,
    url: &'static str,
    supports_streaming: bool,
}

struct MultipartData {
    fields: HashMap<String, String>,
    file: Vec<u8>,
}

#[derive(Serialize)]
struct StreamingTranscriptionEvent<'a> {
    status: &'a str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

const WHISPER_MODELS: &[WhisperModel] = &[
    WhisperModel {
        id: "whisper-tiny",
        aliases: &[
            "tiny",
            "Systran/faster-whisper-tiny",
            "openai/whisper-tiny",
            "whisper-tiny-q4_k.gguf",
        ],
        file_name: "whisper-tiny-q4_k.gguf",
        gguf_file_name: "whisper-tiny-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-tiny-GGUF/resolve/main/whisper.cpp/whisper-tiny-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "whisper-base",
        aliases: &[
            "base",
            "Systran/faster-whisper-base",
            "openai/whisper-base",
            "whisper-base-q4_k.gguf",
        ],
        file_name: "whisper-base-q4_k.gguf",
        gguf_file_name: "whisper-base-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-base-GGUF/resolve/main/whisper.cpp/whisper-base-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "whisper-small",
        aliases: &[
            "small",
            "Systran/faster-whisper-small",
            "openai/whisper-small",
            "whisper-small-q4_k.gguf",
        ],
        file_name: "whisper-small-q4_k.gguf",
        gguf_file_name: "whisper-small-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-small-GGUF/resolve/main/whisper.cpp/whisper-small-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "whisper-medium",
        aliases: &[
            "medium",
            "Systran/faster-whisper-medium",
            "openai/whisper-medium",
            "whisper-medium-q4_k.gguf",
        ],
        file_name: "whisper-medium-q4_k.gguf",
        gguf_file_name: "whisper-medium-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-medium-GGUF/resolve/main/whisper.cpp/whisper-medium-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "whisper-large-v3",
        aliases: &[
            "large-v3",
            "Systran/faster-whisper-large-v3",
            "openai/whisper-large-v3",
            "whisper-large-v3-q4_k.gguf",
        ],
        file_name: "whisper-large-v3-q4_k.gguf",
        gguf_file_name: "whisper-large-v3-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-large-v3-GGUF/resolve/main/whisper.cpp/whisper-large-v3-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "whisper-large-v3-turbo",
        aliases: &[
            "large-v3-turbo",
            "Systran/faster-whisper-large-v3-turbo",
            "mlx-community/whisper-large-v3-turbo-4bit",
            "openai/whisper-large-v3-turbo",
            "whisper-large-v3-turbo-q4_k.gguf",
        ],
        file_name: "whisper-large-v3-turbo-q4_k.gguf",
        gguf_file_name: "whisper-large-v3-turbo-q4_k.gguf",
        url: "https://huggingface.co/oxide-lab/whisper-large-v3-turbo-GGUF/resolve/main/whisper.cpp/whisper-large-v3-turbo-q4_k.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "nvidia/parakeet-tdt-0.6b-v3",
        aliases: &[
            "mlx-community/parakeet-tdt-0.6b-v3",
            "parakeet-tdt-06b-v3",
            "parakeet-tdt-0.6b-v3",
            "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        ],
        file_name: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        gguf_file_name: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "nvidia/parakeet-tdt-0.6b-v2",
        aliases: &[
            "mlx-community/parakeet-tdt-0.6b-v2",
            "parakeet-tdt-06b-v2",
            "parakeet-tdt-0.6b-v2",
            "parakeet-tdt-0.6b-v2-Q8_0.gguf",
        ],
        file_name: "parakeet-tdt-0.6b-v2-Q8_0.gguf",
        gguf_file_name: "parakeet-tdt-0.6b-v2-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v2-gguf/resolve/main/parakeet-tdt-0.6b-v2-Q8_0.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "nvidia/nemotron-3.5-asr-streaming-0.6b",
        aliases: &[
            "nemotron-35-asr-streaming-06b",
            "nemotron-3.5-asr-streaming-0.6b",
            "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        ],
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        gguf_file_name: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        supports_streaming: true,
    },
    WhisperModel {
        id: "nvidia/nemotron-speech-streaming-en-0.6b",
        aliases: &[
            "nemotron-speech-streaming-en-06b",
            "nemotron-speech-streaming-en-0.6b",
            "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
        ],
        file_name: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
        gguf_file_name: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/main/nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
        supports_streaming: true,
    },
    WhisperModel {
        id: "moonshine-streaming-tiny",
        aliases: &["moonshine-streaming-tiny-Q8_0.gguf"],
        file_name: "moonshine-streaming-tiny-Q8_0.gguf",
        gguf_file_name: "moonshine-streaming-tiny-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/main/moonshine-streaming-tiny-Q8_0.gguf",
        supports_streaming: true,
    },
    WhisperModel {
        id: "moonshine-streaming-small",
        aliases: &["moonshine-streaming-small-Q8_0.gguf"],
        file_name: "moonshine-streaming-small-Q8_0.gguf",
        gguf_file_name: "moonshine-streaming-small-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/moonshine-streaming-small-gguf/resolve/main/moonshine-streaming-small-Q8_0.gguf",
        supports_streaming: true,
    },
    WhisperModel {
        id: "Qwen/Qwen3-ASR-0.6B",
        aliases: &[
            "qwen3-asr-06b",
            "Qwen3-ASR-0.6B",
            "qwen3-asr-0.6b",
            "Qwen3-ASR-0.6B-Q8_0.gguf",
        ],
        file_name: "Qwen3-ASR-0.6B-Q8_0.gguf",
        gguf_file_name: "Qwen3-ASR-0.6B-Q8_0.gguf",
        url: "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/main/Qwen3-ASR-0.6B-Q8_0.gguf",
        supports_streaming: false,
    },
    WhisperModel {
        id: "ai-sage/GigaAM-v3",
        aliases: &[
            "gigaam-v3",
            "gigaam-v3-e2e-rnnt",
            "gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
        ],
        file_name: "gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
        gguf_file_name: "gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
        url: "https://huggingface.co/handy-computer/gigaam-v3-e2e-rnnt-gguf/resolve/main/gigaam-v3-e2e-rnnt-Q4_K_M.gguf",
        supports_streaming: false,
    },
];

fn main() {
    init_transcribe_cpp();

    let config = parse_args();
    if let Err(err) = fs::create_dir_all(&config.data_dir) {
        eprintln!("failed to prepare data dir: {}", err);
        std::process::exit(1);
    }

    if let Err(err) = fs::create_dir_all(&config.models_dir) {
        eprintln!("failed to prepare model dir: {}", err);
        std::process::exit(1);
    }

    let bind_addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&bind_addr).unwrap_or_else(|err| {
        eprintln!("failed to bind {}: {}", bind_addr, err);
        std::process::exit(1);
    });

    eprintln!("{} listening on {}", SERVER_NAME, bind_addr);
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let connection_config = config.clone();
                if let Err(error) = std::thread::Builder::new()
                    .name("talkis-stt-connection".to_string())
                    .spawn(move || handle_connection(stream, &connection_config))
                {
                    eprintln!("failed to spawn connection worker: {}", error);
                }
            }
            Err(err) => eprintln!("connection error: {}", err),
        }
    }
}

fn parse_args() -> RuntimeConfig {
    let mut host = "127.0.0.1".to_string();
    let mut port = 8000;
    let mut data_dir = default_data_dir();
    let mut custom_models_dir: Option<PathBuf> = None;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                if let Some(value) = args.next() {
                    host = value;
                }
            }
            "--port" => {
                if let Some(value) = args.next() {
                    port = value.parse().unwrap_or(port);
                }
            }
            "--data-dir" => {
                if let Some(value) = args.next() {
                    data_dir = PathBuf::from(value);
                }
            }
            "--models-dir" => {
                if let Some(value) = args.next() {
                    custom_models_dir = Some(PathBuf::from(value));
                }
            }
            _ => {}
        }
    }

    let models_dir = custom_models_dir.unwrap_or_else(|| data_dir.join("models"));

    RuntimeConfig {
        host,
        port,
        data_dir,
        models_dir,
    }
}

fn default_data_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir())
        .join("Library")
        .join("Application Support")
        .join("com.trixter.talkis")
        .join("local-stt")
}

fn handle_connection(mut stream: TcpStream, config: &RuntimeConfig) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(message) => {
            let _ = write_json(&mut stream, 400, json!({ "error": message }).to_string());
            return;
        }
    };

    if is_live_transcription_request(&request) {
        if let Err((status, message)) = transcribe_live(&request, config, &mut stream) {
            let _ = write_json(
                &mut stream,
                status,
                json!({ "error": { "message": message, "type": "local_stt_error" } }).to_string(),
            );
        }
        return;
    }

    if is_streaming_transcription_request(&request) {
        if let Err((status, message)) = transcribe_streaming(&request, config, &mut stream) {
            let _ = write_json(
                &mut stream,
                status,
                json!({ "error": { "message": message, "type": "local_stt_error" } }).to_string(),
            );
        }
        return;
    }

    let response = route_request(&request, config);
    let _ = write_json(&mut stream, response.0, response.1);
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut temp = [0u8; 8192];
    let header_end;

    loop {
        let bytes_read = stream
            .read(&mut temp)
            .map_err(|err| format!("read error: {}", err))?;
        if bytes_read == 0 {
            return Err("empty request".to_string());
        }
        buffer.extend_from_slice(&temp[..bytes_read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
        if let Some(index) = find_subsequence(&buffer, b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let first_line = lines.next().ok_or_else(|| "bad request".to_string())?;
    let mut first_parts = first_line.split_whitespace();
    let method = first_parts
        .next()
        .ok_or_else(|| "missing method".to_string())?
        .to_string();
    let path = first_parts
        .next()
        .ok_or_else(|| "missing path".to_string())?
        .to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let path_only = path.split('?').next().unwrap_or(&path);
    let is_live_request = method == "POST" && path_only == "/v1/audio/transcriptions/live";

    if is_live_request {
        return Ok(HttpRequest {
            method,
            path,
            headers,
            body: buffer[header_end..].to_vec(),
        });
    }

    while buffer.len() < header_end + content_length {
        let bytes_read = stream
            .read(&mut temp)
            .map_err(|err| format!("read body error: {}", err))?;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..bytes_read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
    }

    let body_end = (header_end + content_length).min(buffer.len());
    Ok(HttpRequest {
        method,
        path,
        headers,
        body: buffer[header_end..body_end].to_vec(),
    })
}

fn route_request(request: &HttpRequest, config: &RuntimeConfig) -> (u16, String) {
    let path = request.path.split('?').next().unwrap_or(&request.path);

    match (request.method.as_str(), path) {
        ("GET", "/health") => (
            200,
            json!({
                "status": "ok",
                "runtime": SERVER_NAME,
                "engine": "transcribe.cpp",
                "api_version": RUNTIME_API_VERSION
            })
            .to_string(),
        ),
        ("GET", "/v1/models") => (
            200,
            json!({
                "object": "list",
                "data": installed_models(config)
                    .into_iter()
                    .map(|id| json!({ "id": id, "object": "model" }))
                    .collect::<Vec<_>>()
            })
            .to_string(),
        ),
        ("POST", "/v1/audio/transcriptions") => match transcribe(request, config) {
            Ok(body) => (200, body),
            Err((status, message)) => (
                status,
                json!({ "error": { "message": message, "type": "local_stt_error" } }).to_string(),
            ),
        },
        _ if request.method == "POST" && path.starts_with("/v1/models/") => {
            let encoded_model = path.trim_start_matches("/v1/models/");
            let model = percent_decode(encoded_model);
            match install_model(config, &model) {
                Ok(id) => (
                    200,
                    json!({
                        "id": id,
                        "object": "model",
                        "status": "downloaded"
                    })
                    .to_string(),
                ),
                Err((status, message)) => (
                    status,
                    json!({ "error": { "message": message, "type": "local_stt_error" } })
                        .to_string(),
                ),
            }
        }
        _ if request.method == "DELETE" && path.starts_with("/v1/models/") => {
            let encoded_model = path.trim_start_matches("/v1/models/");
            let model = percent_decode(encoded_model);
            match delete_model(config, &model) {
                Ok(id) => (
                    200,
                    json!({
                        "id": id,
                        "object": "model",
                        "status": "deleted"
                    })
                    .to_string(),
                ),
                Err((status, message)) => (
                    status,
                    json!({ "error": { "message": message, "type": "local_stt_error" } })
                        .to_string(),
                ),
            }
        }
        _ => (
            404,
            json!({ "error": "Not found", "path": path }).to_string(),
        ),
    }
}

fn is_streaming_transcription_request(request: &HttpRequest) -> bool {
    let path = request.path.split('?').next().unwrap_or(&request.path);
    request.method == "POST" && path == "/v1/audio/transcriptions/stream"
}

fn is_live_transcription_request(request: &HttpRequest) -> bool {
    let path = request.path.split('?').next().unwrap_or(&request.path);
    request.method == "POST" && path == "/v1/audio/transcriptions/live"
}

fn find_model(value: &str) -> Option<&'static WhisperModel> {
    WHISPER_MODELS.iter().find(|model| {
        model.id.eq_ignore_ascii_case(value)
            || model.file_name.eq_ignore_ascii_case(value)
            || model
                .aliases
                .iter()
                .any(|alias| alias.eq_ignore_ascii_case(value))
    })
}

fn model_path(config: &RuntimeConfig, model: &WhisperModel) -> PathBuf {
    config.models_dir.join(model.gguf_file_name)
}

fn marker_path(config: &RuntimeConfig, model: &WhisperModel) -> PathBuf {
    config
        .models_dir
        .join(format!("{}.json", safe_marker_file_stem(model.id)))
}

fn download_model_path(config: &RuntimeConfig, model: &WhisperModel) -> PathBuf {
    model_path(config, model)
}

fn safe_marker_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn install_model(config: &RuntimeConfig, requested: &str) -> Result<String, (u16, String)> {
    let model = find_model(requested).ok_or_else(|| {
        (
            404,
            format!(
                "Модель «{}» не поддерживается встроенным transcribe.cpp runtime.",
                requested
            ),
        )
    })?;

    fs::create_dir_all(&config.models_dir).map_err(|err| {
        (
            500,
            format!("Не удалось подготовить директорию моделей: {}", err),
        )
    })?;

    let path = download_model_path(config, model);
    if !path.is_file() {
        let temp_path = path.with_extension("download");
        let mut response = reqwest::blocking::get(model.url)
            .and_then(|response| response.error_for_status())
            .map_err(|err| {
                (
                    502,
                    format!("Не удалось скачать модель «{}»: {}", model.id, err),
                )
            })?;

        let mut file = fs::File::create(&temp_path).map_err(|err| {
            (
                500,
                format!("Не удалось сохранить модель «{}»: {}", model.id, err),
            )
        })?;
        std::io::copy(&mut response, &mut file).map_err(|err| {
            let _ = fs::remove_file(&temp_path);
            (
                502,
                format!("Не удалось записать модель «{}»: {}", model.id, err),
            )
        })?;
        file.flush().map_err(|err| {
            let _ = fs::remove_file(&temp_path);
            (
                500,
                format!("Не удалось завершить запись модели «{}»: {}", model.id, err),
            )
        })?;
        fs::rename(&temp_path, &path).map_err(|err| {
            let _ = fs::remove_file(&temp_path);
            (
                500,
                format!("Не удалось установить модель «{}»: {}", model.id, err),
            )
        })?;
    }

    write_model_marker(config, model)?;
    Ok(model.id.to_string())
}

fn delete_model(config: &RuntimeConfig, requested: &str) -> Result<String, (u16, String)> {
    let model = find_model(requested).ok_or_else(|| {
        (
            404,
            format!(
                "Модель «{}» не поддерживается встроенным transcribe.cpp runtime.",
                requested
            ),
        )
    })?;

    let path = download_model_path(config, model);
    if path.is_file() {
        fs::remove_file(&path).map_err(|err| {
            (
                500,
                format!("Не удалось удалить модель «{}»: {}", model.id, err),
            )
        })?;
    }

    let marker = marker_path(config, model);
    if marker.is_file() {
        fs::remove_file(&marker).map_err(|err| {
            (
                500,
                format!(
                    "Не удалось удалить состояние модели «{}»: {}",
                    model.id, err
                ),
            )
        })?;
    }

    let temp_path = path.with_extension("download");
    if temp_path.is_file() {
        let _ = fs::remove_file(temp_path);
    }

    Ok(model.id.to_string())
}

fn write_model_marker(config: &RuntimeConfig, model: &WhisperModel) -> Result<(), (u16, String)> {
    let marker = json!({
        "id": model.id,
        "file": model.file_name,
        "engine": "transcribe.cpp"
    });
    fs::write(marker_path(config, model), marker.to_string()).map_err(|err| {
        (
            500,
            format!(
                "Не удалось сохранить состояние модели «{}»: {}",
                model.id, err
            ),
        )
    })
}

fn installed_models(config: &RuntimeConfig) -> Vec<String> {
    let mut models = WHISPER_MODELS
        .iter()
        .filter(|model| model_path(config, model).is_file())
        .map(|model| model.id.to_string())
        .collect::<Vec<_>>();
    models.sort();
    models
}

fn transcribe(request: &HttpRequest, config: &RuntimeConfig) -> Result<String, (u16, String)> {
    let multipart = parse_multipart(request)?;
    let requested_model = multipart
        .fields
        .get("model")
        .map(String::as_str)
        .unwrap_or("whisper-tiny");
    let model = find_model(requested_model).ok_or_else(|| {
        (
            404,
            format!(
                "Модель «{}» не поддерживается встроенным transcribe.cpp runtime.",
                requested_model
            ),
        )
    })?;

    let path = model_path(config, model);
    if !path.is_file() {
        return Err((404, format!("Модель «{}» ещё не скачана.", model.id)));
    }

    let audio = read_wav_mono_16k(&multipart.file)?;
    if is_low_signal_audio(&audio) {
        return transcription_response(String::new(), Vec::new(), &multipart.fields);
    }

    let loaded_model = Model::load(&path).map_err(|err| {
        (
            500,
            format!(
                "Не удалось загрузить модель «{}» через transcribe.cpp: {}",
                model.id, err
            ),
        )
    })?;
    let capabilities = loaded_model.capabilities();
    let supports_whisper_options = loaded_model.accepts_ext(ExtSlot::Run, WHISPER_RUN_EXT_KIND);
    let mut session = loaded_model.session().map_err(|err| {
        (
            500,
            format!("Не удалось создать transcribe.cpp session: {}", err),
        )
    })?;
    let streaming_requested = streaming_requested_from_fields(&multipart.fields);
    let mut options = if streaming_requested {
        run_options_from_fields_with_auto(
            &multipart.fields,
            capabilities.max_timestamp_kind,
            supports_whisper_options,
            true,
        )
    } else {
        run_options_from_fields(
            &multipart.fields,
            capabilities.max_timestamp_kind,
            supports_whisper_options,
        )
    };
    if streaming_requested {
        options.language = normalize_streaming_language(model, options.language.as_deref());
        if !model.supports_streaming {
            return Err((
                400,
                format!("Модель «{}» не поддерживает streaming-режим.", model.id),
            ));
        }

        let Some(stream_extension) = stream_extension_for_model(&loaded_model) else {
            return Err((
                400,
                format!(
                    "transcribe.cpp не сообщил streaming extension для модели «{}».",
                    model.id
                ),
            ));
        };
        let text = run_streaming_transcription(&mut session, &audio, &options, stream_extension)?;
        return transcription_response(text, Vec::new(), &multipart.fields);
    }

    let transcript = session.run(&audio, &options).map_err(|err| {
        (
            500,
            format!("transcribe.cpp не смог распознать аудио: {}", err),
        )
    })?;

    let segments = transcript
        .segments
        .iter()
        .map(|segment| {
            json!({
                "start": segment.t0_ms as f64 / 1000.0,
                "end": segment.t1_ms as f64 / 1000.0,
                "text": segment.text.trim()
            })
        })
        .collect::<Vec<_>>();
    let text = transcript.text.trim().to_string();
    transcription_response(text, segments, &multipart.fields)
}

fn transcribe_streaming(
    request: &HttpRequest,
    config: &RuntimeConfig,
    writer: &mut impl Write,
) -> Result<(), (u16, String)> {
    let multipart = parse_multipart(request)?;
    let requested_model = multipart
        .fields
        .get("model")
        .map(String::as_str)
        .unwrap_or("whisper-tiny");
    let model = find_model(requested_model).ok_or_else(|| {
        (
            404,
            format!(
                "Модель «{}» не поддерживается встроенным transcribe.cpp runtime.",
                requested_model
            ),
        )
    })?;

    let path = model_path(config, model);
    if !path.is_file() {
        return Err((404, format!("Модель «{}» ещё не скачана.", model.id)));
    }

    let audio = read_wav_mono_16k(&multipart.file)?;
    if is_low_signal_audio(&audio) {
        write_ndjson_headers(writer)?;
        write_streaming_event(writer, "started", "", None)?;
        write_streaming_event(writer, "final", "", None)?;
        return Ok(());
    }

    let loaded_model = Model::load(&path).map_err(|err| {
        (
            500,
            format!(
                "Не удалось загрузить модель «{}» через transcribe.cpp: {}",
                model.id, err
            ),
        )
    })?;
    let capabilities = loaded_model.capabilities();
    let supports_whisper_options = loaded_model.accepts_ext(ExtSlot::Run, WHISPER_RUN_EXT_KIND);
    let mut session = loaded_model.session().map_err(|err| {
        (
            500,
            format!("Не удалось создать transcribe.cpp session: {}", err),
        )
    })?;
    let mut options = run_options_from_fields_with_auto(
        &multipart.fields,
        capabilities.max_timestamp_kind,
        supports_whisper_options,
        true,
    );
    options.language = normalize_streaming_language(model, options.language.as_deref());

    if !model.supports_streaming {
        return Err((
            400,
            format!("Модель «{}» не поддерживает streaming-режим.", model.id),
        ));
    }

    let Some(stream_extension) = stream_extension_for_model(&loaded_model) else {
        return Err((
            400,
            format!(
                "transcribe.cpp не сообщил streaming extension для модели «{}».",
                model.id
            ),
        ));
    };

    write_ndjson_headers(writer)?;
    write_streaming_event(writer, "started", "", None)?;

    if let Err((_, message)) = run_streaming_transcription_with_events(
        &mut session,
        &audio,
        &options,
        stream_extension,
        writer,
    ) {
        let _ = write_streaming_event(writer, "error", "", Some(&message));
    }

    Ok(())
}

fn transcribe_live(
    request: &HttpRequest,
    config: &RuntimeConfig,
    connection: &mut TcpStream,
) -> Result<(), (u16, String)> {
    let fields = live_fields_from_query(&request.path);
    let requested_model = fields
        .get("model")
        .map(String::as_str)
        .unwrap_or("whisper-tiny");
    let model = find_model(requested_model).ok_or_else(|| {
        (
            404,
            format!(
                "Модель «{}» не поддерживается встроенным transcribe.cpp runtime.",
                requested_model
            ),
        )
    })?;

    if !model.supports_streaming {
        return Err((
            400,
            format!(
                "Модель «{}» не поддерживает live streaming-режим.",
                model.id
            ),
        ));
    }

    let path = model_path(config, model);
    if !path.is_file() {
        return Err((404, format!("Модель «{}» ещё не скачана.", model.id)));
    }

    let loaded_model = Model::load(&path).map_err(|err| {
        (
            500,
            format!(
                "Не удалось загрузить модель «{}» через transcribe.cpp: {}",
                model.id, err
            ),
        )
    })?;
    let capabilities = loaded_model.capabilities();
    let supports_whisper_options = loaded_model.accepts_ext(ExtSlot::Run, WHISPER_RUN_EXT_KIND);
    let mut session = loaded_model.session().map_err(|err| {
        (
            500,
            format!("Не удалось создать transcribe.cpp session: {}", err),
        )
    })?;
    let mut options = run_options_from_fields_with_auto(
        &fields,
        capabilities.max_timestamp_kind,
        supports_whisper_options,
        true,
    );
    options.language = normalize_streaming_language(model, options.language.as_deref());

    let Some(stream_extension) = stream_extension_for_model(&loaded_model) else {
        return Err((
            400,
            format!(
                "transcribe.cpp не сообщил streaming extension для модели «{}».",
                model.id
            ),
        ));
    };

    write_ndjson_headers(connection)?;
    write_streaming_event(connection, "started", "", None)?;

    let stream_options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        family: Some(stream_extension),
        ..Default::default()
    };
    let mut transcribe_stream = session.stream(&options, &stream_options).map_err(|err| {
        (
            500,
            format!("transcribe.cpp не смог начать live streaming: {}", err),
        )
    })?;

    let mut last_text = String::new();
    let mut pending_pcm = Vec::new();
    let initial_audio = take_live_pcm16_samples(&mut pending_pcm, &request.body);
    if !initial_audio.is_empty() {
        feed_live_audio(
            &mut transcribe_stream,
            &initial_audio,
            connection,
            &mut last_text,
        )?;
    }

    let mut buffer = [0u8; 8192];
    loop {
        let read = connection.read(&mut buffer).map_err(|err| {
            (
                500,
                format!("Не удалось прочитать live audio stream: {}", err),
            )
        })?;
        if read == 0 {
            break;
        }

        let audio = take_live_pcm16_samples(&mut pending_pcm, &buffer[..read]);
        if audio.is_empty() {
            continue;
        }

        feed_live_audio(&mut transcribe_stream, &audio, connection, &mut last_text)?;
    }

    transcribe_stream.finalize().map_err(|err| {
        (
            500,
            format!("transcribe.cpp live streaming finalize failed: {}", err),
        )
    })?;

    let final_text = transcribe_stream.text().display().trim().to_string();
    if final_text != last_text {
        write_streaming_partial_if_changed(connection, &mut last_text, &final_text)?;
    }
    write_streaming_event(connection, "final", &final_text, None)?;

    Ok(())
}

fn live_fields_from_query(path: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let Some((_, query)) = path.split_once('?') else {
        return fields;
    };

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        fields.insert(
            percent_decode(&key.replace('+', " ")),
            percent_decode(&value.replace('+', " ")),
        );
    }

    fields
}

fn take_live_pcm16_samples(pending: &mut Vec<u8>, bytes: &[u8]) -> Vec<f32> {
    pending.extend_from_slice(bytes);
    let sample_bytes = pending.len() - (pending.len() % 2);
    if sample_bytes == 0 {
        return Vec::new();
    }

    let audio = pending[..sample_bytes]
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
        .collect::<Vec<_>>();
    pending.drain(..sample_bytes);
    audio
}

fn feed_live_audio(
    stream: &mut Stream<'_>,
    audio: &[f32],
    writer: &mut impl Write,
    last_text: &mut String,
) -> Result<(), (u16, String)> {
    stream.feed(audio).map_err(|err| {
        (
            500,
            format!("transcribe.cpp live streaming feed failed: {}", err),
        )
    })?;

    let current_text = stream.text().display().trim().to_string();
    write_streaming_partial_if_changed(writer, last_text, &current_text)?;
    Ok(())
}

fn init_transcribe_cpp() {
    INIT_TRANSCRIBE_CPP.call_once(|| {
        transcribe_cpp::init_logging();
        if let Err(err) = transcribe_cpp::init_backends_default() {
            eprintln!("failed to initialize transcribe.cpp backends: {}", err);
            return;
        }

        let devices = transcribe_cpp::devices()
            .into_iter()
            .map(|device| format!("{} ({})", device.name, device.kind))
            .collect::<Vec<_>>()
            .join(", ");
        eprintln!(
            "{} using transcribe.cpp {} devices=[{}]",
            SERVER_NAME,
            transcribe_cpp::version(),
            devices
        );
    });
}

fn run_options_from_fields(
    fields: &HashMap<String, String>,
    max_timestamp_kind: TimestampKind,
    supports_whisper_options: bool,
) -> RunOptions {
    run_options_from_fields_with_auto(fields, max_timestamp_kind, supports_whisper_options, false)
}

fn run_options_from_fields_with_auto(
    fields: &HashMap<String, String>,
    max_timestamp_kind: TimestampKind,
    supports_whisper_options: bool,
    keep_auto_language: bool,
) -> RunOptions {
    let language = fields
        .get("language")
        .map(|language| language.trim())
        .filter(|language| !language.is_empty() && (keep_auto_language || *language != "auto"))
        .map(ToString::to_string);

    RunOptions {
        timestamps: match max_timestamp_kind {
            TimestampKind::None => TimestampKind::None,
            _ => TimestampKind::Segment,
        },
        language,
        family: supports_whisper_options.then(|| {
            RunExtension::Whisper(WhisperRunOptions {
                condition_on_prev_tokens: Some(false),
                temperature: Some(0.0),
                temperature_inc: Some(0.0),
                compression_ratio_thold: Some(2.2),
                logprob_thold: Some(-1.0),
                no_speech_thold: Some(0.6),
                max_prev_context_tokens: Some(0),
                ..Default::default()
            })
        }),
        ..Default::default()
    }
}

fn streaming_requested_from_fields(fields: &HashMap<String, String>) -> bool {
    fields
        .get("streaming")
        .map(|value| {
            matches!(
                value.trim().to_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn normalize_streaming_language(model: &WhisperModel, language: Option<&str>) -> Option<String> {
    let trimmed = language.map(str::trim).filter(|value| !value.is_empty());

    if model.id == "nvidia/nemotron-3.5-asr-streaming-0.6b" {
        return Some(
            match trimmed.unwrap_or("auto") {
                "auto" => "auto",
                "ru" => "ru-RU",
                "en" => "en-US",
                "de" => "de-DE",
                "fr" => "fr-FR",
                "es" => "es-ES",
                "it" => "it-IT",
                "pt" => "pt-BR",
                "zh" | "zh-Hans" => "zh-CN",
                "ja" => "ja-JP",
                "ko" => "ko-KR",
                "hi" => "hi-IN",
                "ar" => "ar-AR",
                value => value,
            }
            .to_string(),
        );
    }

    if model.id == "nvidia/nemotron-speech-streaming-en-0.6b" {
        return Some("en-US".to_string());
    }

    if model.id.starts_with("moonshine-streaming-") {
        return None;
    }

    trimmed.map(ToString::to_string)
}

fn stream_extension_for_model(model: &Model) -> Option<StreamExtension> {
    if model.accepts_ext(ExtSlot::Stream, PARAKEET_STREAM_EXT_KIND) {
        return Some(StreamExtension::ParakeetStream(
            ParakeetStreamOptions::default(),
        ));
    }

    if model.accepts_ext(ExtSlot::Stream, PARAKEET_BUFFERED_STREAM_EXT_KIND) {
        return Some(StreamExtension::ParakeetBuffered(
            ParakeetBufferedStreamOptions::default(),
        ));
    }

    if model.accepts_ext(ExtSlot::Stream, MOONSHINE_STREAMING_EXT_KIND) {
        return Some(StreamExtension::MoonshineStreaming(
            MoonshineStreamingOptions::default(),
        ));
    }

    if model.accepts_ext(ExtSlot::Stream, VOXTRAL_REALTIME_EXT_KIND) {
        return Some(StreamExtension::VoxtralRealtime(
            VoxtralRealtimeStreamOptions::default(),
        ));
    }

    None
}

fn run_streaming_transcription(
    session: &mut transcribe_cpp::Session,
    audio: &[f32],
    run_options: &RunOptions,
    stream_extension: StreamExtension,
) -> Result<String, (u16, String)> {
    let stream_options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        family: Some(stream_extension),
        ..Default::default()
    };
    let mut stream = session
        .stream(run_options, &stream_options)
        .map_err(|err| {
            (
                500,
                format!("transcribe.cpp не смог начать streaming: {}", err),
            )
        })?;

    for chunk in audio.chunks(1600) {
        stream.feed(chunk).map_err(|err| {
            (
                500,
                format!("transcribe.cpp streaming feed failed: {}", err),
            )
        })?;
    }

    stream.finalize().map_err(|err| {
        (
            500,
            format!("transcribe.cpp streaming finalize failed: {}", err),
        )
    })?;

    Ok(stream.text().display().trim().to_string())
}

fn run_streaming_transcription_with_events(
    session: &mut transcribe_cpp::Session,
    audio: &[f32],
    run_options: &RunOptions,
    stream_extension: StreamExtension,
    writer: &mut impl Write,
) -> Result<String, (u16, String)> {
    let stream_options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        family: Some(stream_extension),
        ..Default::default()
    };
    let mut stream = session
        .stream(run_options, &stream_options)
        .map_err(|err| {
            (
                500,
                format!("transcribe.cpp не смог начать streaming: {}", err),
            )
        })?;

    let mut last_text = String::new();
    for chunk in audio.chunks(1600) {
        stream.feed(chunk).map_err(|err| {
            (
                500,
                format!("transcribe.cpp streaming feed failed: {}", err),
            )
        })?;

        let current_text = stream.text().display().trim().to_string();
        write_streaming_partial_if_changed(writer, &mut last_text, &current_text)?;
    }

    stream.finalize().map_err(|err| {
        (
            500,
            format!("transcribe.cpp streaming finalize failed: {}", err),
        )
    })?;

    let final_text = stream.text().display().trim().to_string();
    if final_text != last_text {
        write_streaming_partial_if_changed(writer, &mut last_text, &final_text)?;
    }
    write_streaming_event(writer, "final", &final_text, None)?;

    Ok(final_text)
}

fn write_streaming_partial_if_changed(
    writer: &mut impl Write,
    last_text: &mut String,
    text: &str,
) -> Result<bool, (u16, String)> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == last_text {
        return Ok(false);
    }

    write_streaming_event(writer, "partial", trimmed, None)?;
    *last_text = trimmed.to_string();
    Ok(true)
}

fn write_streaming_event(
    writer: &mut impl Write,
    status: &str,
    text: &str,
    message: Option<&str>,
) -> Result<(), (u16, String)> {
    let event = StreamingTranscriptionEvent {
        status,
        text,
        message,
    };
    let line = serde_json::to_string(&event).map_err(|err| {
        (
            500,
            format!("Не удалось сериализовать streaming event: {}", err),
        )
    })?;
    writer
        .write_all(line.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|err| {
            (
                500,
                format!("Не удалось отправить streaming event: {}", err),
            )
        })
}

fn write_ndjson_headers(writer: &mut impl Write) -> Result<(), (u16, String)> {
    writer
        .write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        )
        .and_then(|_| writer.flush())
        .map_err(|err| (500, format!("Не удалось открыть streaming response: {}", err)))
}

fn transcription_response(
    text: String,
    segments: Vec<serde_json::Value>,
    fields: &HashMap<String, String>,
) -> Result<String, (u16, String)> {
    let response_format = fields
        .get("response_format")
        .map(|value| value.trim())
        .unwrap_or("json");

    if response_format == "verbose_json" {
        Ok(json!({ "text": text, "segments": segments }).to_string())
    } else {
        Ok(json!({ "text": text }).to_string())
    }
}

fn is_low_signal_audio(audio: &[f32]) -> bool {
    if audio.is_empty() {
        return true;
    }

    let mut peak = 0.0f32;
    let mut sum_squares = 0.0f64;
    for sample in audio {
        let abs = sample.abs();
        peak = peak.max(abs);
        sum_squares += (*sample as f64) * (*sample as f64);
    }
    let rms = (sum_squares / audio.len() as f64).sqrt() as f32;

    peak < 0.001 && rms < 0.0001
}

fn parse_multipart(request: &HttpRequest) -> Result<MultipartData, (u16, String)> {
    let content_type = request.headers.get("content-type").ok_or_else(|| {
        (
            400,
            "Для локальной транскрипции нужен multipart/form-data.".to_string(),
        )
    })?;
    let boundary = content_type
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("boundary="))
        .map(|value| value.trim_matches('"').as_bytes().to_vec())
        .ok_or_else(|| (400, "В multipart/form-data нет boundary.".to_string()))?;
    let boundary_marker = [b"--".as_slice(), boundary.as_slice()].concat();

    let mut fields = HashMap::new();
    let mut file = Vec::new();

    for part in split_by_subsequence(&request.body, &boundary_marker) {
        if part.is_empty() || part == b"--" || part == b"--\r\n" {
            continue;
        }
        let part = trim_part(part);
        let Some(header_end) = find_subsequence(part, b"\r\n\r\n") else {
            continue;
        };
        let header_text = String::from_utf8_lossy(&part[..header_end]);
        let body = trim_trailing_crlf(&part[header_end + 4..]);
        let name = header_text
            .lines()
            .find(|line| line.to_lowercase().starts_with("content-disposition:"))
            .and_then(extract_multipart_name);

        match name.as_deref() {
            Some("file") => file = body.to_vec(),
            Some(name) => {
                fields.insert(name.to_string(), String::from_utf8_lossy(body).to_string());
            }
            None => {}
        }
    }

    if file.is_empty() {
        return Err((400, "В запросе нет аудиофайла.".to_string()));
    }

    Ok(MultipartData { fields, file })
}

fn read_wav_mono_16k(bytes: &[u8]) -> Result<Vec<f32>, (u16, String)> {
    let reader = WavReader::new(Cursor::new(bytes))
        .map_err(|err| (400, format!("Локальный STT ожидает WAV audio: {}", err)))?;
    let spec = reader.spec();
    if spec.sample_rate != 16000 {
        return Err((400, "WAV должен быть 16 kHz.".to_string()));
    }
    if spec.channels != 1 && spec.channels != 2 {
        return Err((400, "WAV должен быть mono или stereo.".to_string()));
    }
    if spec.bits_per_sample != 16 {
        return Err((400, "WAV должен быть PCM 16-bit.".to_string()));
    }

    let channels = spec.channels;
    let samples = reader
        .into_samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| (400, format!("Не удалось прочитать WAV samples: {}", err)))?;
    if channels == 1 {
        Ok(samples
            .into_iter()
            .map(|sample| sample as f32 / i16::MAX as f32)
            .collect())
    } else {
        Ok(samples
            .chunks_exact(2)
            .map(|frame| {
                let left = frame[0] as f32 / i16::MAX as f32;
                let right = frame[1] as f32 / i16::MAX as f32;
                (left + right) * 0.5
            })
            .collect())
    }
}

fn extract_multipart_name(line: &str) -> Option<String> {
    line.split(';').map(str::trim).find_map(|part| {
        part.strip_prefix("name=")
            .map(|value| value.trim_matches('"').to_string())
    })
}

fn split_by_subsequence<'a>(bytes: &'a [u8], needle: &[u8]) -> Vec<&'a [u8]> {
    let mut parts = Vec::new();
    let mut start = 0;
    while let Some(relative) = find_subsequence(&bytes[start..], needle) {
        parts.push(&bytes[start..start + relative]);
        start += relative + needle.len();
    }
    parts.push(&bytes[start..]);
    parts
}

fn trim_part(bytes: &[u8]) -> &[u8] {
    let bytes = bytes.strip_prefix(b"\r\n").unwrap_or(bytes);
    trim_trailing_crlf(bytes)
}

fn trim_trailing_crlf(bytes: &[u8]) -> &[u8] {
    bytes
        .strip_suffix(b"\r\n")
        .or_else(|| bytes.strip_suffix(b"\n"))
        .unwrap_or(bytes)
}

fn find_subsequence(bytes: &[u8], needle: &[u8]) -> Option<usize> {
    bytes
        .windows(needle.len())
        .position(|window| window == needle)
}

fn write_json(stream: &mut TcpStream, status: u16, body: String) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        _ => "Internal Server Error",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    decoded.push(byte);
                    index += 3;
                    continue;
                }
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn low_signal_audio_is_detected_before_model_run() {
        assert!(is_low_signal_audio(&vec![0.0; 16_000]));
        assert!(is_low_signal_audio(&vec![0.00005; 16_000]));
        assert!(!is_low_signal_audio(&vec![0.01; 16_000]));
    }

    #[test]
    fn run_options_keep_auto_language_empty() {
        let mut fields = HashMap::new();
        fields.insert("language".to_string(), "auto".to_string());

        let options = run_options_from_fields(&fields, TimestampKind::Segment, true);

        assert_eq!(options.language, None);
        assert_eq!(options.timestamps, TimestampKind::Segment);
    }

    #[test]
    fn run_options_pass_explicit_language() {
        let mut fields = HashMap::new();
        fields.insert("language".to_string(), "ru".to_string());

        let options = run_options_from_fields(&fields, TimestampKind::Segment, true);

        assert_eq!(options.language.as_deref(), Some("ru"));
    }

    #[test]
    fn streaming_fields_parse_boolean_values() {
        let mut fields = HashMap::new();
        assert!(!streaming_requested_from_fields(&fields));

        fields.insert("streaming".to_string(), "true".to_string());
        assert!(streaming_requested_from_fields(&fields));

        fields.insert("streaming".to_string(), "0".to_string());
        assert!(!streaming_requested_from_fields(&fields));
    }

    #[test]
    fn live_query_fields_are_decoded() {
        let fields = live_fields_from_query(
            "/v1/audio/transcriptions/live?model=nvidia%2Fnemotron-3.5-asr-streaming-0.6b&language=ru-RU",
        );

        assert_eq!(
            fields.get("model").map(String::as_str),
            Some("nvidia/nemotron-3.5-asr-streaming-0.6b"),
        );
        assert_eq!(fields.get("language").map(String::as_str), Some("ru-RU"));
    }

    #[test]
    fn live_pcm16_decoder_keeps_odd_byte_for_next_chunk() {
        let mut pending = Vec::new();
        let first = take_live_pcm16_samples(&mut pending, &[0x00, 0x40, 0x00]);
        assert_eq!(first.len(), 1);
        assert!((first[0] - 0.50001526).abs() < 0.0001);
        assert_eq!(pending, vec![0x00]);

        let second = take_live_pcm16_samples(&mut pending, &[0xC0]);
        assert_eq!(second.len(), 1);
        assert!((second[0] + 0.50001526).abs() < 0.0001);
        assert!(pending.is_empty());
    }

    #[test]
    fn streaming_partial_events_are_deduplicated_before_final() {
        let mut output = Vec::new();
        let mut last_text = String::new();

        assert!(
            write_streaming_partial_if_changed(&mut output, &mut last_text, "Привет")
                .expect("first partial")
        );
        assert!(
            !write_streaming_partial_if_changed(&mut output, &mut last_text, "Привет")
                .expect("duplicate partial")
        );
        assert!(
            write_streaming_partial_if_changed(&mut output, &mut last_text, "Привет, мир",)
                .expect("second partial")
        );
        write_streaming_event(&mut output, "final", &last_text, None).expect("final");

        let lines = String::from_utf8(output).expect("utf8");
        let events = lines
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("json"))
            .collect::<Vec<_>>();

        assert_eq!(events.len(), 3);
        assert_eq!(events[0]["status"], "partial");
        assert_eq!(events[0]["text"], "Привет");
        assert_eq!(events[1]["status"], "partial");
        assert_eq!(events[1]["text"], "Привет, мир");
        assert_eq!(events[2]["status"], "final");
        assert_eq!(events[2]["text"], events[1]["text"]);
    }

    #[test]
    fn streaming_run_options_keep_auto_language() {
        let mut fields = HashMap::new();
        fields.insert("language".to_string(), "auto".to_string());

        let options =
            run_options_from_fields_with_auto(&fields, TimestampKind::Segment, false, true);

        assert_eq!(options.language.as_deref(), Some("auto"));
        assert_eq!(options.timestamps, TimestampKind::Segment);
    }

    #[test]
    fn marker_path_sanitizes_model_ids_with_slashes() {
        let root = env::temp_dir().join("talkis-stt-marker-test");
        let config = RuntimeConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            data_dir: root.clone(),
            models_dir: root.join("models"),
        };
        let model = find_model("nvidia/nemotron-3.5-asr-streaming-0.6b").expect("model");

        assert_eq!(
            marker_path(&config, model),
            config
                .models_dir
                .join("nvidia_nemotron-3.5-asr-streaming-0.6b.json")
        );
    }

    #[test]
    fn new_streaming_models_resolve_aliases_and_marker_paths() {
        let root = env::temp_dir().join("talkis-stt-new-streaming-test");
        let config = RuntimeConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            data_dir: root.clone(),
            models_dir: root.join("models"),
        };
        let cases = [
            (
                "nemotron-35-asr-streaming-06b",
                "nvidia/nemotron-3.5-asr-streaming-0.6b",
                "nvidia_nemotron-3.5-asr-streaming-0.6b.json",
            ),
            (
                "nemotron-speech-streaming-en-06b",
                "nvidia/nemotron-speech-streaming-en-0.6b",
                "nvidia_nemotron-speech-streaming-en-0.6b.json",
            ),
            (
                "moonshine-streaming-tiny-Q8_0.gguf",
                "moonshine-streaming-tiny",
                "moonshine-streaming-tiny.json",
            ),
            (
                "moonshine-streaming-small-Q8_0.gguf",
                "moonshine-streaming-small",
                "moonshine-streaming-small.json",
            ),
        ];

        for (requested, expected_id, expected_marker) in cases {
            let model = find_model(requested).expect("model");
            assert_eq!(model.id, expected_id);
            assert!(model.supports_streaming);
            assert_eq!(
                marker_path(&config, model),
                config.models_dir.join(expected_marker)
            );
        }
    }

    #[test]
    fn nemotron_streaming_normalizes_simple_language_to_locale() {
        let model = find_model("nvidia/nemotron-3.5-asr-streaming-0.6b").expect("model");

        assert_eq!(
            normalize_streaming_language(model, Some("ru")).as_deref(),
            Some("ru-RU")
        );
        assert_eq!(
            normalize_streaming_language(model, Some("auto")).as_deref(),
            Some("auto")
        );
    }

    #[test]
    fn english_nemotron_streaming_forces_english_locale() {
        let model = find_model("nvidia/nemotron-speech-streaming-en-0.6b").expect("model");

        assert_eq!(
            normalize_streaming_language(model, Some("ru")).as_deref(),
            Some("en-US")
        );
    }

    #[test]
    fn moonshine_streaming_omits_language_hint() {
        let model = find_model("moonshine-streaming-tiny").expect("model");

        assert_eq!(normalize_streaming_language(model, Some("ru")), None);
    }

    #[test]
    fn gigaam_resolves_base_model_and_gguf_aliases() {
        let model = find_model("ai-sage/GigaAM-v3").expect("model");

        assert_eq!(model.id, "ai-sage/GigaAM-v3");
        assert_eq!(model.file_name, "gigaam-v3-e2e-rnnt-Q4_K_M.gguf");
        assert!(!model.supports_streaming);
        assert_eq!(
            find_model("gigaam-v3-e2e-rnnt-Q4_K_M.gguf")
                .expect("gguf alias")
                .id,
            model.id
        );
    }

    #[test]
    fn model_path_uses_gguf_only() {
        let root = env::temp_dir().join(format!(
            "talkis-stt-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let models_dir = root.join("models");
        fs::create_dir_all(&models_dir).expect("models dir");

        let model = find_model("whisper-base").expect("model");
        let gguf_path = models_dir.join(model.gguf_file_name);
        fs::write(&gguf_path, b"gguf").expect("gguf");

        let config = RuntimeConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            data_dir: root.clone(),
            models_dir,
        };

        assert_eq!(model_path(&config, model), gguf_path);
        assert_eq!(download_model_path(&config, model), gguf_path);

        let _ = fs::remove_dir_all(root);
    }
}
