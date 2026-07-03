mod ffmpeg;
mod file_prep;
mod local_stt;
mod paths;
mod probe;
mod types;

pub use file_prep::{
    prepare_media_file_chunks_for_transcription, prepare_media_file_for_diarization,
    prepare_media_file_for_proxy_transcription,
};
pub use local_stt::convert_audio_to_local_stt_wav;
pub use types::{
    PrepareMediaRequest, PrepareMediaResponse, PreparedMediaChunk, PreparedProxyMedia,
};

const MAX_TRANSCRIPTION_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_FILE_TRANSCRIPTION_INPUT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const FILE_TRANSCRIPTION_SEGMENT_SECONDS: u32 = 600;
const LOCAL_STT_FILE_TRANSCRIPTION_SEGMENT_SECONDS: u32 = 240;

#[tauri::command]
pub async fn prepare_media_for_transcription(
    app: tauri::AppHandle,
    req: PrepareMediaRequest,
) -> Result<PrepareMediaResponse, String> {
    file_prep::prepare_media_for_transcription(app, req).await
}
