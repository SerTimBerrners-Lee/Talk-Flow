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

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(sample_rate: u32, channels: u16, bits_per_sample: u16) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let spec = hound::WavSpec {
                channels,
                sample_rate,
                bits_per_sample,
                sample_format: SampleFormat::Int,
            };
            let cursor = Cursor::new(&mut bytes);
            let mut writer = hound::WavWriter::new(cursor, spec).expect("wav writer");
            for _ in 0..channels {
                writer.write_sample(0i16).expect("wav sample");
            }
            writer.finalize().expect("wav finalize");
        }
        bytes
    }

    #[test]
    fn detects_local_stt_ready_wav() {
        assert!(is_local_stt_ready_wav(&wav_bytes(16000, 1, 16)));
    }

    #[test]
    fn rejects_wav_that_needs_local_stt_conversion() {
        assert!(!is_local_stt_ready_wav(&wav_bytes(48000, 2, 16)));
        assert!(!is_local_stt_ready_wav(b"not a wav"));
    }
}
