//! Bundled local LLM runtime (`talkis-llm` sidecar). Mirrors `talkis-stt`: a tiny
//! raw-TCP HTTP server, but backed by llama.cpp (via `llama-cpp-2`) and exposing
//! an OpenAI-compatible `/v1/chat/completions` endpoint so the desktop app can
//! run summary locally. The GGUF model path is passed with `-m`.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Mutex;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;

const SERVER_NAME: &str = "talkis-llm";
const ENGINE_NAME: &str = "llama.cpp";
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_CTX: u32 = 8192;
const DEFAULT_MAX_TOKENS: i32 = 1024;

struct Config {
    host: String,
    port: u16,
    model_path: PathBuf,
    ctx_size: u32,
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn main() {
    let config = parse_args();

    let backend = match LlamaBackend::init() {
        Ok(backend) => backend,
        Err(err) => {
            eprintln!("failed to init llama backend: {}", err);
            std::process::exit(1);
        }
    };

    let mut model_params = LlamaModelParams::default();
    // Offload everything to the GPU where available (Metal on macOS).
    model_params = model_params.with_n_gpu_layers(999);

    let model = match LlamaModel::load_from_file(&backend, &config.model_path, &model_params) {
        Ok(model) => model,
        Err(err) => {
            eprintln!(
                "failed to load model {}: {}",
                config.model_path.display(),
                err
            );
            std::process::exit(1);
        }
    };

    // llama contexts are not Sync; the server is single-threaded like talkis-stt,
    // and the Mutex keeps the model usable from the connection loop.
    let model = Mutex::new(model);

    let bind_addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&bind_addr).unwrap_or_else(|err| {
        eprintln!("failed to bind {}: {}", bind_addr, err);
        std::process::exit(1);
    });

    eprintln!("{} listening on {}", SERVER_NAME, bind_addr);
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_connection(stream, &backend, &model, &config),
            Err(err) => eprintln!("connection error: {}", err),
        }
    }
}

fn parse_args() -> Config {
    let mut host = "127.0.0.1".to_string();
    let mut port: u16 = 8011;
    let mut model_path: Option<PathBuf> = None;
    let mut ctx_size = DEFAULT_CTX;

    let mut args = std::env::args().skip(1);
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
            "-m" | "--model" => {
                if let Some(value) = args.next() {
                    model_path = Some(PathBuf::from(value));
                }
            }
            "-c" | "--ctx-size" => {
                if let Some(value) = args.next() {
                    ctx_size = value.parse().unwrap_or(ctx_size);
                }
            }
            // Ignore unknown flags (e.g. --jinja, --data-dir, --models-dir).
            _ => {}
        }
    }

    let model_path = model_path.unwrap_or_else(|| {
        eprintln!("missing required -m <model.gguf>");
        std::process::exit(2);
    });

    Config {
        host,
        port,
        model_path,
        ctx_size,
    }
}

fn handle_connection(
    mut stream: TcpStream,
    backend: &LlamaBackend,
    model: &Mutex<LlamaModel>,
    config: &Config,
) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(message) => {
            let _ = write_json(&mut stream, 400, &json!({ "error": message }));
            return;
        }
    };

    let (status, body) = route_request(&request, backend, model, config);
    let _ = write_json(&mut stream, status, &body);
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

    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some(value) = line
            .to_ascii_lowercase()
            .strip_prefix("content-length:")
            .map(|value| value.trim().to_string())
        {
            content_length = value.parse().unwrap_or(0);
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let bytes_read = stream
            .read(&mut temp)
            .map_err(|err| format!("read error: {}", err))?;
        if bytes_read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..bytes_read]);
        if body.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
    }

    Ok(HttpRequest { method, path, body })
}

fn route_request(
    request: &HttpRequest,
    backend: &LlamaBackend,
    model: &Mutex<LlamaModel>,
    config: &Config,
) -> (u16, Value) {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => (
            200,
            json!({ "status": "ok", "runtime": SERVER_NAME, "engine": ENGINE_NAME }),
        ),
        ("GET", "/v1/models") => (
            200,
            json!({
                "object": "list",
                "data": [{ "id": SERVER_NAME, "object": "model", "owned_by": "talkis" }]
            }),
        ),
        ("POST", "/v1/chat/completions") => {
            match chat_completion(&request.body, backend, model, config) {
                Ok(value) => (200, value),
                Err(message) => (500, json!({ "error": message })),
            }
        }
        _ => (404, json!({ "error": "not found" })),
    }
}

fn chat_completion(
    body: &[u8],
    backend: &LlamaBackend,
    model: &Mutex<LlamaModel>,
    config: &Config,
) -> Result<Value, String> {
    let payload: Value =
        serde_json::from_slice(body).map_err(|err| format!("invalid json: {}", err))?;
    let messages = payload
        .get("messages")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "missing messages".to_string())?;
    let temperature = payload
        .get("temperature")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.3) as f32;
    let max_tokens = payload
        .get("max_tokens")
        .and_then(|value| value.as_i64())
        .map(|value| value as i32)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    let prompt = build_chatml(messages);

    let model = model.lock().unwrap_or_else(|err| err.into_inner());
    let content = generate(
        backend,
        &model,
        &prompt,
        temperature,
        max_tokens,
        config.ctx_size,
    )?;

    Ok(json!({
        "id": "chatcmpl-talkis-llm",
        "object": "chat.completion",
        "model": SERVER_NAME,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content.trim() },
            "finish_reason": "stop"
        }]
    }))
}

/// Build a Qwen2.5 ChatML prompt from OpenAI-style messages.
fn build_chatml(messages: &[Value]) -> String {
    let mut prompt = String::new();
    for message in messages {
        let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        let content = message
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        prompt.push_str(&format!(
            "<|im_start|>{}\n{}<|im_end|>\n",
            role, content
        ));
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

fn generate(
    backend: &LlamaBackend,
    model: &LlamaModel,
    prompt: &str,
    temperature: f32,
    max_tokens: i32,
    ctx_size: u32,
) -> Result<String, String> {
    let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(ctx_size));
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|err| format!("context error: {}", err))?;

    let tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|err| format!("tokenize error: {}", err))?;

    let batch_capacity = tokens.len().max(512);
    let mut batch = LlamaBatch::new(batch_capacity, 1);
    let last_index = tokens.len() as i32 - 1;
    for (i, token) in tokens.iter().enumerate() {
        batch
            .add(*token, i as i32, &[0], i as i32 == last_index)
            .map_err(|err| format!("batch error: {}", err))?;
    }
    ctx.decode(&mut batch)
        .map_err(|err| format!("decode error: {}", err))?;

    let mut sampler = if temperature <= 0.0 {
        LlamaSampler::greedy()
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::temp(temperature),
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::dist(1234),
        ])
    };

    let mut n_cur = batch.n_tokens();
    let limit = n_cur + max_tokens;
    let mut output = String::new();
    let mut pending: Vec<u8> = Vec::new();

    while n_cur < limit {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        // Accumulate raw token bytes and emit only COMPLETE UTF-8 sequences. A
        // single token can carry a partial multibyte char (Cyrillic spans token
        // boundaries), so decoding tokens one-by-one yielded garbled glyphs.
        if let Ok(bytes) = model.token_to_bytes(token, Special::Tokenize) {
            pending.extend_from_slice(&bytes);
            loop {
                match std::str::from_utf8(&pending) {
                    Ok(text) => {
                        output.push_str(text);
                        pending.clear();
                        break;
                    }
                    Err(err) => {
                        let valid = err.valid_up_to();
                        if valid > 0 {
                            output.push_str(
                                std::str::from_utf8(&pending[..valid])
                                    .expect("valid_up_to bytes are valid UTF-8"),
                            );
                            pending.drain(..valid);
                        }
                        match err.error_len() {
                            // Genuinely invalid bytes — drop them so we don't stall.
                            Some(bad) => {
                                pending.drain(..bad.max(1));
                            }
                            // Just an incomplete tail — wait for the next token.
                            None => break,
                        }
                    }
                }
            }
        }

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|err| format!("batch error: {}", err))?;
        n_cur += 1;
        ctx.decode(&mut batch)
            .map_err(|err| format!("decode error: {}", err))?;
    }

    // Flush any complete trailing bytes (a dangling partial sequence is dropped).
    match std::str::from_utf8(&pending) {
        Ok(text) => output.push_str(text),
        Err(err) => output.push_str(
            std::str::from_utf8(&pending[..err.valid_up_to()])
                .expect("valid_up_to bytes are valid UTF-8"),
        ),
    }

    Ok(output)
}

fn write_json(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let body = body.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.as_bytes().len(),
        body
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
