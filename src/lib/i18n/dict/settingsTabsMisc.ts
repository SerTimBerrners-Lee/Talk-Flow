// Strings for the File Transcription and Realtime Interpreter settings tabs
// (windows/settings/tabs/FileTranscriptionTab.tsx + RealtimeInterpreterTab.tsx).
export const settingsTabsMisc = {
  // ---- FileTranscriptionTab ----

  // Processing status labels (statusLabel)
  "fileTab.status.reading": { ru: "Читаем файл", en: "Reading file" },
  "fileTab.status.converting": {
    ru: "Извлекаем и сжимаем аудио",
    en: "Extracting and compressing audio",
  },
  "fileTab.status.uploading": {
    ru: "Отправляем на транскрибацию",
    en: "Uploading for transcription",
  },
  "fileTab.status.preparing": { ru: "Готовим файл", en: "Preparing file" },
  "fileTab.status.diarizing": {
    ru: "Разделяем говорящих",
    en: "Separating speakers",
  },
  "fileTab.status.transcribingChunk": {
    ru: "Распознаём фрагмент {current} из {total}",
    en: "Recognizing chunk {current} of {total}",
  },
  "fileTab.status.transcribing": {
    ru: "Распознаём фрагменты",
    en: "Recognizing chunks",
  },
  "fileTab.status.assembling": {
    ru: "Собираем протокол",
    en: "Assembling transcript",
  },
  "fileTab.status.done": { ru: "Готово", en: "Done" },
  "fileTab.status.error": { ru: "Ошибка", en: "Error" },
  "fileTab.status.idle": { ru: "Ожидаем файл", en: "Waiting for a file" },

  // Result source label (resultSourceLabel) — also reused as the file-name fallback
  "fileTab.source.call": { ru: "Созвон", en: "Call" },
  "fileTab.source.file": { ru: "Файл", en: "File" },
  "fileTab.source.voice": { ru: "Голос", en: "Voice" },

  // Speaker-setup error messages (toSpeakerSetupErrorMessage)
  "fileTab.setupError.rejectedKey": {
    ru: "Не удалось подготовить локальные компоненты: STT runtime отклонил API-ключ.",
    en: "Could not prepare local components: the STT runtime rejected the API key.",
  },
  "fileTab.setupError.forbidden": {
    ru: "Не удалось подготовить локальные компоненты: STT runtime запретил установку модели.",
    en: "Could not prepare local components: the STT runtime forbade installing the model.",
  },
  "fileTab.setupError.timeout": {
    ru: "Не удалось подготовить локальные компоненты: локальный STT runtime не ответил вовремя.",
    en: "Could not prepare local components: the local STT runtime did not respond in time.",
  },
  "fileTab.setupError.noVenv": {
    ru: "Не удалось подготовить локальные компоненты: в системе нет Python venv/pip. Установите пакет python3.12-venv и повторите скачивание.",
    en: "Could not prepare local components: Python venv/pip is missing on the system. Install the python3.12-venv package and retry the download.",
  },
  "fileTab.setupError.genericWithDetail": {
    ru: "Не удалось подготовить локальные компоненты для разделения по говорящим: {detail}",
    en: "Could not prepare local components for speaker separation: {detail}",
  },
  "fileTab.setupError.generic": {
    ru: "Не удалось подготовить локальные компоненты для разделения по говорящим.",
    en: "Could not prepare local components for speaker separation.",
  },

  // processFile / convertedInfo
  "fileTab.error.speakerNeedsDialog": {
    ru: "Разделение по говорящим доступно для файлов, выбранных через системный диалог или перетаскиванием в окно Talkis.",
    en: "Speaker separation is available for files chosen via the system dialog or dropped onto the Talkis window.",
  },
  "fileTab.convertedInfo": {
    ru: "Отправлено как {name}, {size}",
    en: "Sent as {name}, {size}",
  },

  // Speaker setup progress messages (installSpeakerSetup)
  "fileTab.setup.preparing": {
    ru: "Готовим локальные компоненты...",
    en: "Preparing local components...",
  },
  "fileTab.setup.downloading": {
    ru: "Скачиваем {name}...",
    en: "Downloading {name}...",
  },
  "fileTab.setup.repairing": {
    ru: "Восстанавливаем runtime для разметки...",
    en: "Repairing the diarization runtime...",
  },
  "fileTab.setup.downloadingDiarization": {
    ru: "Скачиваем компоненты для разметки говорящих...",
    en: "Downloading speaker diarization components...",
  },
  "fileTab.setup.done": { ru: "Готово.", en: "Done." },
  "fileTab.setup.doneContinue": {
    ru: "Готово. Продолжаем обработку файла...",
    en: "Done. Continuing to process the file...",
  },

  // Header
  "fileTab.heading": { ru: "Транскрибация", en: "Transcription" },
  "fileTab.subheading": {
    ru: "Голый текст без дополнительного форматирования.",
    en: "Plain text without extra formatting.",
  },

  // File open dialog filter
  "fileTab.dialog.audioVideoFilter": {
    ru: "Аудио и видео",
    en: "Audio and video",
  },

  // Dropzone
  "fileTab.dropzone.title": {
    ru: "Перетащите аудио или видео",
    en: "Drag in audio or video",
  },
  "fileTab.dropzone.hint": {
    ru: "Нажмите на область или перетащите файл. MP3, WAV, M4A, MP4, MOV, WEBM и другие форматы",
    en: "Click the area or drop a file. MP3, WAV, M4A, MP4, MOV, WEBM and other formats",
  },

  // Speaker diarization toggle
  "fileTab.speaker.toggleTitle": {
    ru: "Разделить по говорящим",
    en: "Separate by speaker",
  },
  "fileTab.speaker.toggleDesc": {
    ru: "Протокол с таймкодами и метками Гость 1, Гость 2.",
    en: "Transcript with timestamps and Guest 1, Guest 2 labels.",
  },
  "fileTab.speaker.nameAria": { ru: "Имя {name}", en: "Name {name}" },

  // Result area
  "fileTab.result.title": { ru: "Результат", en: "Result" },
  "fileTab.result.copied": { ru: "Скопировано", en: "Copied" },
  "fileTab.result.copy": { ru: "Скопировать", en: "Copy" },
  "fileTab.result.clear": { ru: "Очистить", en: "Clear" },
  "fileTab.result.collapse": { ru: "Скрыть", en: "Collapse" },
  "fileTab.result.expand": { ru: "Раскрыть", en: "Expand" },
  "fileTab.result.empty": {
    ru: "После обработки здесь появится текст.",
    en: "The text will appear here after processing.",
  },

  // Result table
  "fileTab.table.time": { ru: "Время", en: "Time" },
  "fileTab.table.text": { ru: "Текст", en: "Text" },

  // Speaker setup modal
  "fileTab.modal.title": {
    ru: "Нужна локальная подготовка",
    en: "Local setup required",
  },
  "fileTab.modal.descDownloaded": {
    ru: "Для разделения по говорящим Talkis использует {name} для распознавания с таймкодами и подготовит локальные компоненты для разметки говорящих.",
    en: "For speaker separation Talkis uses {name} for timestamped recognition and will prepare local components for speaker diarization.",
  },
  "fileTab.modal.descNeedDownload": {
    ru: "Для разделения по говорящим Talkis подготовит {name} для распознавания с таймкодами и локальные компоненты для разметки говорящих.",
    en: "For speaker separation Talkis will prepare {name} for timestamped recognition and local components for speaker diarization.",
  },
  "fileTab.modal.whisperReady": {
    ru: "{name} готова для разметки",
    en: "{name} is ready for diarization",
  },
  "fileTab.modal.whisperWillDownload": {
    ru: "{name} будет скачан",
    en: "{name} will be downloaded",
  },
  "fileTab.modal.diarizationReady": {
    ru: "Компоненты для разметки",
    en: "Diarization components",
  },
  "fileTab.modal.diarizationWillDownload": {
    ru: "Компоненты для разметки говорящих будут скачаны",
    en: "Speaker diarization components will be downloaded",
  },

  // ---- RealtimeInterpreterTab ----

  // Status labels (statusLabel)
  "realtime.status.checking": { ru: "Проверяем", en: "Checking" },
  "realtime.status.running": { ru: "Работает", en: "Running" },
  "realtime.status.starting": { ru: "Запускается", en: "Starting" },
  "realtime.status.stopping": { ru: "Останавливается", en: "Stopping" },
  "realtime.status.error": { ru: "Ошибка", en: "Error" },
  "realtime.status.off": { ru: "Выключен", en: "Off" },

  // Transcript speaker labels (directionSpeakerLabel)
  "realtime.speaker.you": { ru: "Вы", en: "You" },
  "realtime.speaker.remote": { ru: "Собеседник", en: "Other party" },
  "realtime.transcript.translationLabel": {
    ru: "Перевод ({lang})",
    en: "Translation ({lang})",
  },

  // Warnings
  "realtime.warning.needLogin": {
    ru: "Для облачного режима войдите в аккаунт Talkis.",
    en: "Sign in to your Talkis account for cloud mode.",
  },
  "realtime.warning.needHeadphones": {
    ru: "Для локального перевода нужны наушники или отдельный output.",
    en: "Local translation requires headphones or a separate output.",
  },

  // Test output
  "realtime.test.signalSent": {
    ru: "Тестовый сигнал отправлен в virtual mic output.",
    en: "A test signal was sent to the virtual mic output.",
  },

  // Saved history entry name
  "realtime.history.fileName": { ru: "Перевод звонка", en: "Call translation" },

  // Loading
  "realtime.loading": { ru: "Загружаем переводчик…", en: "Loading interpreter…" },

  // Header
  "realtime.title": {
    ru: "Синхронный переводчик",
    en: "Simultaneous interpreter",
  },
  "realtime.metric.status": { ru: "Статус", en: "Status" },
  "realtime.metric.languages": { ru: "Языки", en: "Languages" },
  "realtime.metric.route": { ru: "Маршрут", en: "Route" },
  "realtime.statusMessage.off": {
    ru: "Realtime Interpreter выключен.",
    en: "Realtime Interpreter is off.",
  },

  // Settings fields
  "realtime.field.realMic.label": {
    ru: "Настоящий микрофон",
    en: "Real microphone",
  },
  "realtime.field.realMic.note": {
    ru: "Голос пользователя для RU → {lang}.",
    en: "User's voice for RU → {lang}.",
  },
  "realtime.field.realMic.empty": {
    ru: "Системный микрофон",
    en: "System microphone",
  },
  "realtime.field.languagePair.label": { ru: "Пара языков", en: "Language pair" },
  "realtime.field.languagePair.note": {
    ru: "Русский остается локальным языком пользователя в v1.",
    en: "Russian stays the user's local language in v1.",
  },
  "realtime.field.virtualMic.note": {
    ru: "{driver} для приложения звонка.",
    en: "{driver} for the call app.",
  },
  "realtime.field.virtualMic.empty": {
    ru: "Установите {driver}",
    en: "Install {driver}",
  },
  "realtime.field.localPlayback.label": {
    ru: "Локальное прослушивание",
    en: "Local monitoring",
  },
  "realtime.field.localPlayback.note": {
    ru: "Русский перевод собеседника.",
    en: "Russian translation of the other party.",
  },
  "realtime.field.localPlayback.empty": {
    ru: "Системный output",
    en: "System output",
  },
  "realtime.field.access.label": { ru: "Доступ", en: "Access" },
  "realtime.field.access.note": {
    ru: "V1 работает только через Talkis Cloud.",
    en: "V1 works only via Talkis Cloud.",
  },
  "realtime.access.connected": {
    ru: "Аккаунт подключен",
    en: "Account connected",
  },
  "realtime.access.needLogin": { ru: "Нужен вход", en: "Sign-in required" },

  // Headphones confirmation
  "realtime.headphonesConfirm": {
    ru: "Локальный перевод идет в наушники или отдельный output",
    en: "Local translation goes to headphones or a separate output",
  },

  // Check and run section
  "realtime.checkAndRun": { ru: "Проверка и запуск", en: "Check and start" },
  "realtime.button.refresh.title": {
    ru: "Обновить устройства",
    en: "Refresh devices",
  },
  "realtime.button.refresh": { ru: "Обновить", en: "Refresh" },
  "realtime.button.test.title": {
    ru: "Тест virtual mic output",
    en: "Test virtual mic output",
  },
  "realtime.button.test": { ru: "Тест", en: "Test" },
  "realtime.button.stop.title": {
    ru: "Остановить переводчик",
    en: "Stop interpreter",
  },
  "realtime.button.stop": { ru: "Стоп", en: "Stop" },
  "realtime.button.start.title": {
    ru: "Запустить переводчик",
    en: "Start interpreter",
  },
  "realtime.button.start": { ru: "Старт", en: "Start" },

  // Live transcript panels
  "realtime.panel.youToCall": { ru: "Вы → звонок", en: "You → call" },
  "realtime.panel.callToYou": { ru: "Звонок → вы", en: "Call → you" },
  "realtime.noLiveTranscript": {
    ru: "Нет live transcript",
    en: "No live transcript",
  },

  // Routing summary line
  "realtime.routingSummary": {
    ru: "Virtual mic: {virtualMic} · Playback: {playback}",
    en: "Virtual mic: {virtualMic} · Playback: {playback}",
  },
  "realtime.routing.notSelected": { ru: "не выбран", en: "not selected" },
  "realtime.routing.systemOutput": {
    ru: "системный output",
    en: "system output",
  },
} as const;
