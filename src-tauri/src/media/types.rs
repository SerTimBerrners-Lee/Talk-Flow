use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct PrepareMediaRequest {
    pub file_base64: String,
    pub file_name: String,
}

#[derive(Serialize)]
pub struct PrepareMediaResponse {
    pub audio_base64: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

pub struct PreparedMediaChunk {
    pub path: PathBuf,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub start_offset_seconds: f64,
}

pub struct PreparedMediaChunks {
    pub temp_dir: PathBuf,
    pub chunks: Vec<PreparedMediaChunk>,
}

pub struct PreparedProxyMedia {
    pub temp_dir: PathBuf,
    pub path: PathBuf,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

pub struct PreparedDiarizationAudio {
    pub temp_dir: PathBuf,
    pub path: PathBuf,
}
