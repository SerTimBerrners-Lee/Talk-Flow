use hound::{SampleFormat, WavReader};
use std::io::Cursor;

pub(super) fn is_local_stt_ready_wav(input_bytes: &[u8]) -> bool {
    let Ok(reader) = WavReader::new(Cursor::new(input_bytes)) else {
        return false;
    };
    let spec = reader.spec();

    spec.sample_rate == 16000
        && spec.channels == 1
        && spec.bits_per_sample == 16
        && spec.sample_format == SampleFormat::Int
}
