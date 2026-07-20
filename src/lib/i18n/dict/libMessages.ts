export const libMessages = {
  // ── fileTranscription.ts ──────────────────────────────────────────────────
  "fileTranscription.interrupted": {
    ru: "Обработка остановлена. Можно запустить повторно.",
    en: "Processing stopped. You can run it again.",
  },
  "fileTranscription.fallbackFileName": {
    ru: "Файл",
    en: "File",
  },
  "fileTranscription.statusPreparing": {
    ru: "Готовим файл",
    en: "Preparing file",
  },
  "fileTranscription.sizeBytes": {
    ru: "{value} Б",
    en: "{value} B",
  },
  "fileTranscription.sizeKb": {
    ru: "{value} КБ",
    en: "{value} KB",
  },
  "fileTranscription.sizeMb": {
    ru: "{value} МБ",
    en: "{value} MB",
  },
  "fileTranscription.errEmptyFile": {
    ru: "Пустой файл нельзя транскрибировать.",
    en: "An empty file cannot be transcribed.",
  },
  "fileTranscription.errTooLargeForPrep": {
    ru: "Файл слишком большой. Максимум для подготовки в приложении: 200 МБ.",
    en: "The file is too large. The maximum for in-app preparation is 200 MB.",
  },
  "fileTranscription.errNoSpeech": {
    ru: "В файле не удалось распознать речь.",
    en: "No speech could be recognized in the file.",
  },
  "fileTranscription.errNoSavedFile": {
    ru: "У этой записи нет сохраненного файла для повторной обработки.",
    en: "This entry has no saved file to re-process.",
  },
  "fileTranscription.errProcessFileRetry": {
    ru: "Не удалось обработать файл. Попробуйте повторить попытку.",
    en: "Could not process the file. Please try again.",
  },
  "fileTranscription.errMediaConverterUnavailable": {
    ru: "Для этого файла нужно извлечь и сжать аудио, но встроенный медиаконвертер недоступен. Попробуйте поддерживаемый файл до 25 МБ или переустановите приложение.",
    en: "This file needs its audio extracted and compressed, but the built-in media converter is unavailable. Try a supported file up to 25 MB or reinstall the app.",
  },
  "fileTranscription.errTooLargeShorter": {
    ru: "Файл слишком большой для транскрибации. Попробуйте более короткий фрагмент.",
    en: "The file is too large to transcribe. Try a shorter fragment.",
  },
  "fileTranscription.errTooLargeMax8gb": {
    ru: "Файл слишком большой для транскрибации. Максимальный размер: 8 ГБ.",
    en: "The file is too large to transcribe. Maximum size: 8 GB.",
  },
  "fileTranscription.errCannotReadAudio": {
    ru: "Не удалось прочитать аудио из этого файла. Попробуйте MP3, WAV, M4A, MP4, MOV, WEBM или OGG.",
    en: "Could not read audio from this file. Try MP3, WAV, M4A, MP4, MOV, WEBM, or OGG.",
  },
  "fileTranscription.errCloudSessionMissing": {
    ru: "Войдите в Talkis Cloud заново, чтобы использовать облачный режим.",
    en: "Sign in to Talkis Cloud again to use cloud mode.",
  },
  "fileTranscription.errCloudDiarizationNotConfigured": {
    ru: "Облачная разметка говорящих пока недоступна. Используйте локальную подготовку в блоке транскрибации файла.",
    en: "Cloud speaker labeling is not available yet. Use local preparation in the file transcription section.",
  },
  "fileTranscription.errCloudDiarizationUnavailable": {
    ru: "Облачное разделение по говорящим сейчас недоступно. Проверьте баланс или переключитесь на локальный режим.",
    en: "Cloud speaker separation is currently unavailable. Check your balance or switch to local mode.",
  },
  "fileTranscription.errSubscriptionInactive": {
    ru: "Облачный баланс закончился. Пополните его или переключитесь на локальный режим.",
    en: "Your cloud balance is empty. Top it up or switch to local mode.",
  },
  "fileTranscription.errCannotPrepareDiarization": {
    ru: "Не удалось подготовить аудио для разметки говорящих. Попробуйте другой аудио- или видеофайл.",
    en: "Could not prepare audio for speaker labeling. Try a different audio or video file.",
  },
  "fileTranscription.errNeedTimestampModel": {
    ru: "Для разделения по говорящим нужна локальная Whisper-модель с таймкодами.",
    en: "Speaker separation requires a local Whisper model with timestamps.",
  },
  "fileTranscription.errDownloadDiarizationComponents": {
    ru: "Для разделения по говорящим скачайте локальные компоненты в блоке транскрибации файла.",
    en: "To separate speakers, download the local components in the file transcription section.",
  },
  "fileTranscription.errRuntimeIncomplete": {
    ru: "Runtime для разметки установился не полностью. Нажмите «Скачать» в подготовке разметки, чтобы Talkis восстановил его.",
    en: "The labeling runtime did not install completely. Click “Download” in the labeling setup so Talkis can restore it.",
  },
  "fileTranscription.errNoSpeakerSegments": {
    ru: "Не удалось найти отдельные реплики говорящих в этом файле.",
    en: "Could not find separate speaker utterances in this file.",
  },
  "fileTranscription.errLocalModelNotInstalled": {
    ru: "Локальная модель распознавания не установлена. Откройте Настройки -> Модели -> Локально и нажмите «Скачать» для выбранной модели.",
    en: "The local recognition model is not installed. Open Settings -> Models -> Local and click “Download” for the selected model.",
  },
  "fileTranscription.errLocalRuntimeRejected": {
    ru: "Локальный runtime отклонил файл. Проверьте, что выбранная локальная модель скачана и запущена, затем попробуйте ещё раз.",
    en: "The local runtime rejected the file. Make sure the selected local model is downloaded and running, then try again.",
  },
  "fileTranscription.errAuthFailed": {
    ru: "Не удалось авторизоваться в API. Проверьте ключ доступа.",
    en: "Could not authenticate with the API. Check your access key.",
  },
  "fileTranscription.errRateLimit": {
    ru: "Превышен лимит запросов или закончилась квота API. Попробуйте позже.",
    en: "The request limit was exceeded or the API quota ran out. Try again later.",
  },
  "fileTranscription.errCloudDiarizationTimeout": {
    ru: "Облако не успело обработать запись с разделением по говорящим — длинные встречи не укладываются в лимит сервера. Отключите «Разделение по говорящим» (файл разобьётся на части и распознается) или возьмите фрагмент покороче.",
    en: "The cloud could not process the recording with speaker separation in time — long meetings exceed the server limit. Turn off “Speaker separation” (the file will be split into parts and transcribed) or take a shorter fragment.",
  },
  "fileTranscription.errNetwork": {
    ru: "Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.",
    en: "Could not reach the server. Check your internet connection and try again.",
  },
  "fileTranscription.errGeneric": {
    ru: "Не удалось транскрибировать файл. Попробуйте другой формат или более короткий фрагмент.",
    en: "Could not transcribe the file. Try a different format or a shorter fragment.",
  },

  // ── callCapture.ts ────────────────────────────────────────────────────────
  "callCapture.interrupted": {
    ru: "Обработка остановлена. Можно запустить повторно.",
    en: "Processing stopped. You can run it again.",
  },
  "callCapture.recovered": {
    ru: "Talkis восстановил незавершённый разговор. Аудио и сохранённый черновик доступны, обработку можно повторить.",
    en: "Talkis recovered an unfinished call. Its audio and saved draft are available, and processing can be retried.",
  },
  "callCapture.liveUnavailable": {
    ru: "Онлайн-транскрибация недоступна, но аудио продолжает сохраняться.",
    en: "Live transcription is unavailable, but audio is still being saved.",
  },
  "callCapture.fileName": {
    ru: "Созвон",
    en: "Call",
  },
  "callCapture.speakerYou": {
    ru: "Вы",
    en: "You",
  },
  "callCapture.speakerCall": {
    ru: "Созвон",
    en: "Call",
  },
  "callCapture.speakerGuestN": {
    ru: "Гость {index}",
    en: "Guest {index}",
  },
  "callCapture.trackMic": {
    ru: "микрофон",
    en: "microphone",
  },
  "callCapture.errDiarizationNoSegments": {
    ru: "Разделение говорящих не вернуло сегменты.",
    en: "Speaker separation returned no segments.",
  },
  "callCapture.errNoSpeech": {
    ru: "В созвоне не удалось распознать речь.",
    en: "No speech could be recognized in the call.",
  },
  "callCapture.errProcessRetry": {
    ru: "Не удалось обработать запись. Попробуйте повторить попытку.",
    en: "Could not process the recording. Please try again.",
  },
  "callCapture.errNoSavedTracks": {
    ru: "У этой записи нет сохраненных дорожек созвона для повторной обработки.",
    en: "This entry has no saved call tracks to re-process.",
  },

  // ── summarize.ts ──────────────────────────────────────────────────────────
  "summarize.errNoText": {
    ru: "Нет текста для обработки",
    en: "No text to process",
  },
  "summarize.errEmptyPrompt": {
    ru: "Промпт пустой",
    en: "The prompt is empty",
  },
  "summarize.errNoModel": {
    ru: "Нет доступной модели для саммари: войдите в Talkis Cloud или укажите текстовую модель во вкладке «Модели».",
    en: "No model available for summary: sign in to Talkis Cloud or set a text model in the “Models” tab.",
  },

  // ── processingControl.ts ──────────────────────────────────────────────────
  "processing.interrupted": {
    ru: "Обработка остановлена. Можно запустить повторно.",
    en: "Processing stopped. You can run it again.",
  },
} as const;
