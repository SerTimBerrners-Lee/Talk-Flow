// Strings for settings tabs that do not have their own dictionary file.
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
  "fileTab.live.stop": {
    ru: "Остановить",
    en: "Stop",
  },
  "fileTab.live.stopping": {
    ru: "Останавливаем...",
    en: "Stopping...",
  },
  "fileTab.live.stopFailed": {
    ru: "Не удалось остановить запись. Попробуйте ещё раз.",
    en: "Could not stop the recording. Try again.",
  },

  // Result source label (resultSourceLabel) — also reused as the file-name fallback
  "fileTab.source.call": { ru: "Созвон", en: "Call" },
  "fileTab.source.file": { ru: "Файл", en: "File" },
  "fileTab.source.voice": { ru: "Голос", en: "Voice" },

  // Speaker-setup error messages (toSpeakerSetupErrorMessage)
  "fileTab.setupError.rejectedKey": {
    ru: "Не удалось подготовить локальные компоненты: STT runtime отклонил API-ключ.",
    en: "Could not prepare local components: the STT runtime rejected the API key.",
  },
  "fileTab.setupError.localRuntimeRejected": {
    ru: "Не удалось подготовить локальные компоненты: локальный STT runtime отклонил запрос. Это не ошибка API-ключа.",
    en: "Could not prepare local components: the local STT runtime rejected the request. This is not an API key error.",
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

  // ---- TranslationTab ----
  "translation.loading": {
    ru: "Загружаем переводчик…",
    en: "Loading translator…",
  },
  "translation.title": { ru: "Переводчик", en: "Translator" },
  "translation.view.live": {
    ru: "Синхронный перевод (Облако/API)",
    en: "Live translation (Cloud/API)",
  },
  "translation.view.other": { ru: "Остальное", en: "Other" },
  "translation.source.title": { ru: "Распознавать с", en: "Recognize from" },
  "translation.source.desc": {
    ru: "Источник берется из основного языка распознавания в настройках.",
    en: "The source comes from the main recognition language setting.",
  },
  "translation.target.title": { ru: "Переводить на", en: "Translate to" },
  "translation.target.desc": {
    ru: "Перевод применяется к обычной диктовке после распознавания и перед вставкой.",
    en: "Translation is applied to ordinary dictation after recognition and before paste.",
  },
  "translation.dictation.title": {
    ru: "Перевод через транскрибацию",
    en: "Translation through transcription",
  },
  "translation.widget.title": {
    ru: "Включить перевод",
    en: "Enable translation",
  },
  "translation.widget.desc": {
    ru: "Переводит обычную диктовку после распознавания и перед вставкой.",
    en: "Translates ordinary dictation after recognition and before paste.",
  },
  "translation.widget.on": { ru: "Включён", en: "On" },
  "translation.widget.off": { ru: "Выключен", en: "Off" },
  "translation.live.title": {
    ru: "Синхронный перевод",
    en: "Synchronous translation",
  },
  "translation.live.target": {
    ru: "Язык перевода",
    en: "Translation language",
  },
  "translation.live.widget": {
    ru: "Кнопка над виджетом",
    en: "Widget button",
  },
  "translation.live.microphone": {
    ru: "Переводить микрофон",
    en: "Translate microphone",
  },
  "translation.live.voice": {
    ru: "Озвучивать перевод",
    en: "Speak translation",
  },
  "translation.live.voiceName": { ru: "Голос", en: "Voice" },
  "translation.live.volume": { ru: "Громкость", en: "Volume" },
  "translation.live.speed": { ru: "Скорость речи", en: "Speech speed" },
  "translation.live.muteOriginal": {
    ru: "Приглушать оригинал",
    en: "Duck original audio",
  },
  "translation.live.muteOriginalDesc": {
    ru: "Оригинальный звук остаётся слышен тихо, а Talkis получает его на полной громкости для распознавания.",
    en: "The original audio remains quietly audible while Talkis captures it at full level for recognition.",
  },
  "translation.live.voice.marin": { ru: "Marin", en: "Marin" },
  "translation.live.voice.cedar": { ru: "Cedar", en: "Cedar" },
  "translation.live.voice.coral": { ru: "Coral", en: "Coral" },
  "translation.live.voice.verse": { ru: "Verse", en: "Verse" },
  "translation.live.voiceDesc": {
    ru: "Перевод воспроизводится сразу короткими фрагментами. Talkis исключает собственный звук из захвата, чтобы не возникал повторный перевод.",
    en: "Translation is played immediately in short chunks. Talkis excludes its own audio from capture to prevent a translation feedback loop.",
  },
  "translation.live.voiceOpenAiOnly": {
    ru: "Озвучка доступна в облаке Talkis или через проверенное подключение OpenAI Realtime.",
    en: "Voice playback is available through Talkis Cloud or a verified OpenAI Realtime connection.",
  },
  "translation.live.voiceMacOnly": {
    ru: "Озвучка сейчас доступна на macOS. Для Windows и Linux нужна безопасная защита от повторного захвата звука Talkis.",
    en: "Voice playback is currently available on macOS. Windows and Linux still need safe Talkis self-audio exclusion.",
  },
  "translation.live.desc": {
    ru: "Системный звук переводится напрямую через облачную Realtime-модель или подключённый API. Локальные модели остаются доступны для обычной диктовки и перевода выделенного текста.",
    en: "System audio is translated through a cloud Realtime model or connected API. Local models remain available for ordinary dictation and selected-text translation.",
  },
  "translation.selection.title": {
    ru: "Перевод выделенного текста",
    en: "Selected text translation",
  },
  "translation.selection.desc": {
    ru: "Выделите текст в любом приложении и нажмите горячую клавишу. Talkis покажет перевод в отдельном окне над виджетом.",
    en: "Select text in any app and press the hotkey. Talkis shows the translation in a separate window above the widget.",
  },
  "translation.selection.on": { ru: "Включено", en: "On" },
  "translation.selection.off": { ru: "Выключено", en: "Off" },
  "translation.selection.hotkeyLabel": {
    ru: "Горячая клавиша",
    en: "Hotkey",
  },
  "translation.selection.hotkeyIdle": {
    ru: "Нажмите поле и введите сочетание",
    en: "Click the field and press a shortcut",
  },
  "translation.selection.hotkeySaved": {
    ru: "Горячая клавиша сохранена.",
    en: "Hotkey saved.",
  },
  "translation.selection.hotkeyInvalid": {
    ru: "Неверное сочетание.",
    en: "Invalid shortcut.",
  },
  "translation.selection.hotkeyChange": {
    ru: "Изменить",
    en: "Change",
  },
  "translation.status.active": {
    ru: "В виджете перевод сейчас включен.",
    en: "Translation is currently on in the widget.",
  },
  "translation.status.inactive": {
    ru: "В виджете перевод сейчас выключен.",
    en: "Translation is currently off in the widget.",
  },
} as const;
