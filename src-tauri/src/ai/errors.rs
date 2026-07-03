pub(super) fn local_stt_runtime_rejected_message(status_code: u16, body: &str) -> String {
    let detail = body
        .chars()
        .take(200)
        .collect::<String>()
        .trim()
        .to_string();
    if detail.is_empty() {
        format!(
            "Локальный STT runtime отклонил запрос ({}). Это не ошибка API-ключа.",
            status_code
        )
    } else {
        format!(
            "Локальный STT runtime отклонил запрос ({}). Это не ошибка API-ключа: {}",
            status_code, detail
        )
    }
}
