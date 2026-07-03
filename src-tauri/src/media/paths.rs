use std::env;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn file_extension(file_name: &str) -> &str {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin")
}

pub(super) fn unique_temp_path(prefix: &str, extension: &str) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let pid = std::process::id();
    env::temp_dir().join(format!(
        "talkis-{}-{}-{}.{}",
        prefix,
        pid,
        now,
        extension.trim_start_matches('.')
    ))
}
