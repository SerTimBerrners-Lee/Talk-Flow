export const onboarding = {
  "onboarding.progressLabel": {
    ru: "Прогресс настройки",
    en: "Setup progress",
  },
  "onboarding.model.title": {
    ru: "Скачайте модель распознавания",
    en: "Download a speech recognition model",
  },
  "onboarding.model.subtitle": {
    ru: "Начните с NVIDIA Nemotron, быстрой локальной модели для диктовки. Позже модель можно заменить в настройках.",
    en: "Start with NVIDIA Nemotron, a fast local dictation model. You can replace it later in Settings.",
  },
  "onboarding.model.checking": {
    ru: "Проверяем установленные модели…",
    en: "Checking installed models…",
  },
  "onboarding.model.recommended": { ru: "Рекомендуем", en: "Recommended" },
  "onboarding.model.installed": { ru: "Скачана", en: "Downloaded" },
  "onboarding.model.selected": { ru: "Активна", en: "Active" },
  "onboarding.model.notInstalled": { ru: "Не скачана", en: "Not downloaded" },
  "onboarding.model.languages": {
    ru: "Языки: {value}",
    en: "Languages: {value}",
  },
  "onboarding.model.downloadAndContinue": {
    ru: "Скачать и продолжить",
    en: "Download and continue",
  },
  "onboarding.model.activateAndContinue": {
    ru: "Активировать и продолжить",
    en: "Activate and continue",
  },
  "onboarding.model.continue": { ru: "Продолжить", en: "Continue" },
  "onboarding.model.skip": { ru: "Пропустить", en: "Skip for now" },
  "onboarding.model.download": { ru: "Скачать", en: "Download" },
  "onboarding.model.delete": { ru: "Удалить", en: "Delete" },
  "onboarding.model.select": { ru: "Выбрать", en: "Select" },
  "onboarding.model.expand": { ru: "Развернуть модель", en: "Expand model" },
  "onboarding.model.collapse": { ru: "Свернуть модель", en: "Collapse model" },
  "onboarding.model.ready": {
    ru: "Модель скачана и используется для распознавания",
    en: "Downloaded and selected for speech recognition",
  },
  "onboarding.model.downloadedReady": {
    ru: "Модель готова. Выберите её для распознавания",
    en: "The model is ready. Select it for speech recognition",
  },
  "onboarding.model.downloadHint": {
    ru: "Скачивание выполняется один раз",
    en: "You only need to download it once",
  },
  "onboarding.model.activating": {
    ru: "Подключаем модель…",
    en: "Activating the model…",
  },
  "onboarding.model.deleting": {
    ru: "Удаляем файлы модели…",
    en: "Removing model files…",
  },
  "onboarding.model.settingsUnavailable": {
    ru: "Настройки приложения ещё не загружены.",
    en: "App settings haven't loaded yet.",
  },
  "onboarding.model.deleteTitle": {
    ru: "Удалить модель?",
    en: "Delete this model?",
  },
  "onboarding.model.deleteBody": {
    ru: "Файлы {name} будут удалены с устройства. Модель всегда можно скачать снова.",
    en: "{name} files will be removed from this device. You can download the model again at any time.",
  },
  "onboarding.model.speedVeryFast": {
    ru: "очень быстро",
    en: "very fast",
  },
  "onboarding.model.speedFast": { ru: "быстро", en: "fast" },
  "onboarding.model.accuracyHigh": { ru: "высокая", en: "high" },
  "onboarding.model.accuracyMedium": { ru: "средняя", en: "medium" },
  "onboarding.model.preparing": {
    ru: "Подготавливаем локальный runtime…",
    en: "Preparing the local runtime…",
  },
  "onboarding.model.downloading": {
    ru: "Скачиваем модель…",
    en: "Downloading the model…",
  },
  "onboarding.model.cancel": { ru: "Отменить", en: "Cancel" },
  "onboarding.model.loadFailed": {
    ru: "Не удалось проверить установленные модели. Можно повторить скачивание выбранной модели.",
    en: "Couldn't check installed models. You can retry downloading the selected model.",
  },
  "onboarding.test.title": {
    ru: "Протестируйте работу",
    en: "Test your setup",
  },
  "onboarding.test.phrase": {
    ru: "Сегодня хорошая погода, и я говорю ясно.",
    en: "Today is a beautiful day, and I am speaking clearly.",
  },
  "onboarding.test.processing": {
    ru: "Распознаём запись…",
    en: "Transcribing the recording…",
  },
  "onboarding.test.result": {
    ru: "Микрофон и распознавание работают",
    en: "Your microphone and speech recognition work",
  },
  "onboarding.test.mismatchTitle": {
    ru: "Результат отличается от контрольной фразы",
    en: "The result differs from the test phrase",
  },
  "onboarding.test.mismatchHint": {
    ru: "Сравните текст выше и повторите попытку ещё раз.",
    en: "Compare the text above and try again.",
  },
  "onboarding.test.failed": {
    ru: "Не удалось завершить тест. Проверьте микрофон и попробуйте ещё раз.",
    en: "Couldn't complete the test. Check your microphone and try again.",
  },
  "onboarding.test.noSpeech": {
    ru: "Речь не распознана. Говорите ближе к микрофону и попробуйте ещё раз.",
    en: "No speech was recognized. Speak closer to the microphone and try again.",
  },
  "onboarding.test.finish": { ru: "Готово", en: "Done" },
  "onboarding.test.skip": { ru: "Пропустить", en: "Skip" },
  "onboarding.back": { ru: "Назад", en: "Back" },
} as const;
