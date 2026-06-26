// Strings for the Model & Style settings tabs (windows/settings/tabs/SettingsTabs.tsx).
export const settingsModels = {
  // ── Account / subscription cards ──
  "models.account.logout": { ru: "Выйти", en: "Log out" },
  "models.cta.upgradePro": { ru: "Перейти на PRO", en: "Upgrade to PRO" },
  "models.cta.freeTrial": { ru: "7 дней бесплатно", en: "7 days free" },
  "models.guest.title": { ru: "Подписка Talkis", en: "Talkis subscription" },
  "models.guest.benefit1": { ru: "• Безлимитное использование без ограничений", en: "• Unlimited use, no limits" },
  "models.guest.benefit2": { ru: "• Без VPN и Прокси", en: "• No VPN or proxy required" },
  "models.guest.benefit3": { ru: "• Синхронизация со всеми устройствами", en: "• Sync across all your devices" },
  "models.subscription.active": { ru: "Подписка активна", en: "Subscription active" },
  "models.subscription.unlimitedUntil": { ru: "Безлимитный доступ до {date}", en: "Unlimited access until {date}" },
  "models.subscription.heading": { ru: "Подписка Talkis", en: "Talkis subscription" },
  "models.subscription.headingDesc": {
    ru: "Безлимитное облачное распознавание без VPN и прокси — 7 дней бесплатно.",
    en: "Unlimited cloud recognition with no VPN or proxy — 7 days free.",
  },

  // ── Prompt library ──
  "models.prompt.nameLabel": { ru: "Название", en: "Name" },
  "models.prompt.namePlaceholder": { ru: "Например: Протокол встречи", en: "For example: Meeting minutes" },
  "models.prompt.promptLabel": { ru: "Промпт", en: "Prompt" },
  "models.prompt.promptPlaceholder": {
    ru: "Опиши, какое summary нужно сделать по тексту разговора",
    en: "Describe what kind of summary to make from the conversation text",
  },
  "models.prompt.saving": { ru: "Сохраняем", en: "Saving" },
  "models.prompt.save": { ru: "Сохранить", en: "Save" },
  "models.prompt.libraryHint": {
    ru: "Выберите промпт для summary. Он предлагается по умолчанию на экране результата транскрибации.",
    en: "Choose a summary prompt. It is offered by default on the transcription result screen.",
  },
  "models.prompt.create": { ru: "Создать промпт", en: "Create prompt" },
  "models.prompt.improve": { ru: "Сгенерировать промпт", en: "Generate prompt" },
  "models.prompt.improving": { ru: "Генерирую…", en: "Generating…" },

  // ── Text (summary) model card ──
  "models.textModel.title": { ru: "Текстовая модель", en: "Text model" },
  "models.textModel.desc": {
    ru: "OpenAI-совместимый endpoint для summary и обработки текста. Оставьте endpoint пустым, чтобы использовать OpenAI с вашим API-ключом.",
    en: "An OpenAI-compatible endpoint for summaries and text processing. Leave the endpoint empty to use OpenAI with your API key.",
  },
  "models.textModel.apiKeyPlaceholder": { ru: "Необязательно для локального endpoint", en: "Optional for a local endpoint" },
  "models.textModel.statusSet": { ru: "Настроена", en: "Configured" },
  "models.textModel.statusUnset": { ru: "Не настроена", en: "Not configured" },

  "models.modeCommit.label": { ru: "Режим: {mode}", en: "Mode: {mode}" },
  "models.modeCommit.select": { ru: "Выбрать", en: "Select" },
  "models.modeCommit.active": { ru: "Используется", en: "In use" },

  // ── Recognition mode section ──
  "models.modeSection.title": { ru: "Режим распознавания", en: "Recognition mode" },
  "models.modeSection.desc": {
    ru: "Вы можете в любой момент переключаться между облаком, своим API-ключом и локальной моделью.",
    en: "You can switch between the cloud, your own API key, and a local model at any time.",
  },
  "models.mode.cloud": { ru: "Облако", en: "Cloud" },
  "models.mode.local": { ru: "Локально", en: "Local" },

  // ── Cloud mode ──
  "models.cloud.descActive": {
    ru: "Запросы на распознавание и обработку текста идут через облако Talkis. Все данные шифруются при передаче, а аудио и текст не сохраняются на сервере после обработки.",
    en: "Recognition and text-processing requests go through the Talkis cloud. All data is encrypted in transit, and audio and text are not stored on the server after processing.",
  },
  "models.cloud.descGuest": {
    ru: "Для облачного режима нужна авторизация и активная подписка. После входа плашка и статус подписки обновятся автоматически.",
    en: "Cloud mode requires sign-in and an active subscription. After you log in, the banner and subscription status update automatically.",
  },
  "models.cloud.proReady": { ru: "PRO активен, облако готово к выбору", en: "PRO is active, the cloud is ready to select" },
  "models.cloud.needPro": { ru: "7 дней бесплатно — перейдите на PRO", en: "7 days free — upgrade to PRO" },

  // ── API adapters section ──
  "models.apiSection.title": { ru: "Доступные API-адаптеры", en: "Available API adapters" },
  "models.apiSection.desc": {
    ru: "Выберите адаптер, раскройте его и укажите ключ вместе с названием модели распознавания.",
    en: "Pick an adapter, expand it, and enter your key along with the recognition model name.",
  },
  "models.adapter.recommendedModel": { ru: "Рекомендуемая модель: {model}.", en: "Recommended model: {model}." },

  // Per-adapter descriptions (ru = the original constant text)
  "models.adapter.openai.description": {
    ru: "Подключение через OpenAI API для распознавания речи.",
    en: "Connect via the OpenAI API for speech recognition.",
  },
  "models.adapter.deepgram.description": {
    ru: "Адаптер для облачного распознавания речи через Deepgram.",
    en: "Adapter for cloud speech recognition via Deepgram.",
  },
  "models.adapter.cartesia.description": {
    ru: "Адаптер под речевые модели Cartesia.",
    en: "Adapter for Cartesia speech models.",
  },
  "models.adapter.mistral.description": {
    ru: "Адаптер под модели распознавания и обработки Mistral AI.",
    en: "Adapter for Mistral AI recognition and processing models.",
  },
  "models.adapter.elevenlabs.description": {
    ru: "Адаптер для speech-to-text сценариев через ElevenLabs.",
    en: "Adapter for speech-to-text use cases via ElevenLabs.",
  },
  "models.adapter.fireworks.description": {
    ru: "Адаптер под hosted speech-модели Fireworks AI.",
    en: "Adapter for Fireworks AI hosted speech models.",
  },
  "models.adapter.groq.description": {
    ru: "Адаптер под быстрые hosted Whisper-модели Groq.",
    en: "Adapter for Groq's fast hosted Whisper models.",
  },
  "models.adapter.assemblyai.description": {
    ru: "Адаптер для распознавания речи через AssemblyAI.",
    en: "Adapter for speech recognition via AssemblyAI.",
  },
  "models.adapter.volcengine.description": {
    ru: "Адаптер под речевые сервисы Volcengine.",
    en: "Adapter for Volcengine speech services.",
  },
  "models.adapter.xai.description": {
    ru: "Адаптер под API xAI для будущих voice/STT сценариев.",
    en: "Adapter for the xAI API for future voice/STT use cases.",
  },

  // ── Adapter status badges ──
  "models.adapterStatus.selected": { ru: "Выбран", en: "Selected" },
  "models.adapterStatus.needApiKey": { ru: "Нужен API-ключ", en: "API key required" },
  "models.adapterStatus.needModel": { ru: "Нужна модель", en: "Model required" },
  "models.adapterStatus.ready": { ru: "Готов", en: "Ready" },
  "models.adapterStatus.error": { ru: "Ошибка", en: "Error" },
  "models.adapterStatus.testing": { ru: "Проверяем", en: "Testing" },
  "models.adapterStatus.readyToTest": { ru: "Готов к проверке", en: "Ready to test" },
  "models.adapterStatus.readyToSelect": { ru: "Готов к выбору", en: "Ready to select" },

  // ── Connection labels / messages ──
  "models.connection.noApiKey": { ru: "API-ключ не указан", en: "No API key entered" },
  "models.connection.usedForRecognition": { ru: "Используется для распознавания", en: "Used for recognition" },
  "models.connection.working": { ru: "Соединение работает", en: "Connection working" },
  "models.connection.error": { ru: "Ошибка соединения", en: "Connection error" },
  "models.connection.testing": { ru: "Проверяем соединение...", en: "Testing connection..." },
  "models.connection.notTested": { ru: "Соединение не проверено", en: "Connection not tested" },
  "models.connection.verifiedSaved": { ru: "Соединение проверено и сохранено.", en: "Connection verified and saved." },
  "models.connection.keyModelSaved": { ru: "Ключ и модель сохранены", en: "Key and model saved" },
  "models.connection.keyModelSavedNamed": { ru: "{name}: ключ и модель сохранены.", en: "{name}: key and model saved." },
  "models.connection.readyToSelect": { ru: "Готов к выбору", en: "Ready to select" },
  "models.connection.fillKeyModel": { ru: "Заполните ключ и модель", en: "Fill in the key and model" },

  // ── Adapter form fields ──
  "models.field.apiKey": { ru: "API-ключ", en: "API key" },
  "models.field.model": { ru: "Модель", en: "Model" },
  "models.field.recommended": { ru: "Рекомендуем: {model}", en: "Recommended: {model}" },
  "models.field.host": { ru: "Хост", en: "Host" },
  "models.field.hostDefaultPlaceholder": { ru: "По умолчанию: {endpoint}", en: "Default: {endpoint}" },
  "models.field.hostPlaceholder": {
    ru: "https://api.example.com или http://localhost:8000",
    en: "https://api.example.com or http://localhost:8000",
  },

  // ── Test / save actions ──
  "models.test.needKeyAndModel": {
    ru: "Укажите API-ключ и название модели перед проверкой.",
    en: "Enter an API key and a model name before testing.",
  },
  "models.test.needKeyAndModelBeforeSelect": {
    ru: "Укажите API-ключ и модель перед выбором адаптера.",
    en: "Enter an API key and a model before selecting the adapter.",
  },
  "models.test.savedPendingBackend": {
    ru: "{name}: ключ и модель сохранены. Реальная проверка соединения будет доступна после подключения backend-адаптера.",
    en: "{name}: key and model saved. A live connection test will be available once the backend adapter is connected.",
  },
  "models.test.checking": { ru: "Проверяем...", en: "Testing..." },
  "models.test.testAndSave": { ru: "Тестировать и сохранить", en: "Test and save" },
  "models.test.saveButton": { ru: "Сохранить", en: "Save" },

  // ── Local model statuses ──
  "models.local.modelNotConnected": { ru: "Модель не подключена", en: "Model not connected" },
  "models.local.engineNotConnected": { ru: "Движок не подключен", en: "Engine not connected" },
  "models.local.runtimeReadyModelOff": {
    ru: "{runtime} runtime работает, но эта модель ещё не включена.",
    en: "The {runtime} runtime is running, but this model is not enabled yet.",
  },
  "models.local.runtimeSlotPrepared": {
    ru: "{runtime} runtime-слот подготовлен, но движок еще не встроен в сборку.",
    en: "The {runtime} runtime slot is prepared, but the engine is not yet built into the app.",
  },
  "models.local.macOnly": {
    ru: "Эта локальная модель пока доступна только на macOS. Для Windows и Linux оставлен Whisper runtime.",
    en: "This local model is currently available on macOS only. The Whisper runtime is kept for Windows and Linux.",
  },
  "models.local.sidecarPending": {
    ru: "{runtime} sidecar запускается отдельно от Whisper, но скачивание и распознавание для этой линейки будут включены после подключения локального engine.",
    en: "The {runtime} sidecar runs separately from Whisper, but downloading and recognition for this line will be enabled once the local engine is connected.",
  },
  "models.local.deleting": { ru: "Удаляется", en: "Deleting" },
  "models.local.downloading": { ru: "Скачивается", en: "Downloading" },
  "models.local.selected": { ru: "Выбрана", en: "Selected" },
  "models.local.ready": { ru: "Готова", en: "Ready" },
  "models.local.prepareFailed": { ru: "Не удалось подготовить модель", en: "Failed to prepare the model" },
  "models.local.notDownloaded": { ru: "Не скачана", en: "Not downloaded" },

  // ── Local models section ──
  "models.local.tabTranscription": { ru: "Транскрибация", en: "Transcription" },
  "models.local.tabText": { ru: "Текстовая", en: "Text" },
  "models.local.sectionTitle": { ru: "Локальные модели", en: "Local models" },
  "models.local.sectionDesc": {
    ru: "Выберите модель, скачайте ее через локальный STT runtime и используйте без облака.",
    en: "Pick a model, download it through the local STT runtime, and use it without the cloud.",
  },
  "models.local.recommendedBadge": { ru: "Рекомендуем", en: "Recommended" },
  "models.local.runtimeSuffix": { ru: "Runtime: {runtime}.", en: "Runtime: {runtime}." },

  // Per-model descriptions (ru = the original constant text)
  "models.local.whisper-large-v3-turbo.description": {
    ru: "Рекомендуемый Whisper-вариант: быстрый, качественный и хорошо подходит для диктовки.",
    en: "The recommended Whisper variant: fast, accurate, and well suited for dictation.",
  },
  "models.local.whisper-large-v3-turbo-quantized.description": {
    ru: "Более легкий вариант Turbo для локальной работы с меньшим расходом памяти.",
    en: "A lighter Turbo variant for local use with lower memory consumption.",
  },
  "models.local.whisper-small.description": {
    ru: "Баланс скорости и качества для слабых машин и быстрых коротких диктовок.",
    en: "A balance of speed and quality for weaker machines and quick short dictations.",
  },
  "models.local.whisper-large-v3.description": {
    ru: "Максимальное качество Whisper, но выше требования к памяти и времени обработки.",
    en: "Maximum Whisper quality, but with higher memory and processing-time requirements.",
  },
  "models.local.whisper-large-v2.description": {
    ru: "Предыдущая large-версия Whisper для совместимости с существующими локальными установками.",
    en: "The previous large Whisper version, for compatibility with existing local setups.",
  },
  "models.local.whisper-medium.description": {
    ru: "Промежуточный вариант между Small и Large: заметно качественнее Small, но тяжелее.",
    en: "An option between Small and Large: noticeably better than Small, but heavier.",
  },
  "models.local.whisper-base.description": {
    ru: "Быстрая и легкая модель для простых сценариев и слабых машин.",
    en: "A fast, lightweight model for simple scenarios and weaker machines.",
  },
  "models.local.whisper-tiny.description": {
    ru: "Минимальный размер и максимальная скорость, качество ниже остальных Whisper-моделей.",
    en: "Minimal size and maximum speed, with lower quality than the other Whisper models.",
  },
  "models.local.parakeet-tdt-06b-v3.description": {
    ru: "Быстрая локальная ASR-модель Parakeet через MLX runtime для Apple Silicon.",
    en: "A fast local Parakeet ASR model via the MLX runtime for Apple Silicon.",
  },
  "models.local.parakeet-tdt-06b-v2.description": {
    ru: "Стабильная английская Parakeet TDT-модель через MLX runtime для Apple Silicon.",
    en: "A stable English Parakeet TDT model via the MLX runtime for Apple Silicon.",
  },
  "models.local.qwen3-asr-06b.description": {
    ru: "Компактная ASR-модель Qwen для локального распознавания через совместимый runtime.",
    en: "A compact Qwen ASR model for local recognition via a compatible runtime.",
  },

  // ── Speed / accuracy value labels ──
  "models.speedValue.veryFast": { ru: "очень быстро", en: "very fast" },
  "models.speedValue.fast": { ru: "быстро", en: "fast" },
  "models.speedValue.medium": { ru: "средне", en: "medium" },
  "models.accuracyValue.maximum": { ru: "максимальная", en: "maximum" },
  "models.accuracyValue.high": { ru: "высокая", en: "high" },
  "models.accuracyValue.medium": { ru: "средняя", en: "medium" },
  "models.accuracyValue.mediumPlus": { ru: "средняя+", en: "medium+" },
  "models.accuracyValue.basic": { ru: "базовая", en: "basic" },
  "models.accuracyValue.lowPlus": { ru: "низкая+", en: "low+" },
  "models.accuracyValue.utility": { ru: "служебная", en: "utility" },

  // ── Stat labels / titles ──
  "models.stat.speed": { ru: "Скорость", en: "Speed" },
  "models.stat.accuracy": { ru: "Точность", en: "Accuracy" },
  "models.stat.speedTitle": { ru: "Скорость: {value}", en: "Speed: {value}" },
  "models.stat.accuracyTitle": { ru: "Точность: {value}", en: "Accuracy: {value}" },
  "models.stat.downloadSizeTitle": { ru: "Размер загрузки: {value}", en: "Download size: {value}" },

  // ── Download size formatting ──
  "models.size.zero": { ru: "0 Б", en: "0 B" },
  "models.size.gb": { ru: "{value} ГБ", en: "{value} GB" },
  "models.size.mb": { ru: "{value} МБ", en: "{value} MB" },
  "models.size.unknown": { ru: "Неизвестно", en: "Unknown" },
  "models.size.notConnected": { ru: "Не подключено", en: "Not connected" },

  // ── Install / download progress ──
  "models.install.preparingRuntime": { ru: "Готовим локальный STT runtime.", en: "Preparing the local STT runtime." },
  "models.delete.removingFile": { ru: "Удаляем локальный файл модели.", en: "Removing the local model file." },
  "models.download.progress": { ru: "Скачиваем модель: {percent}%", en: "Downloading model: {percent}%" },
  "models.download.inProgress": { ru: "Скачиваем модель.", en: "Downloading model." },
  "models.download.done": { ru: "Модель скачана.", en: "Model downloaded." },
  "models.download.loading": { ru: "Загрузка модели", en: "Downloading model" },
  "models.download.preparing": { ru: "Подготовка", en: "Preparing" },
  "models.download.of": { ru: "из {total}", en: "of {total}" },

  // ── Delete confirmation dialog ──
  "models.deleteDialog.title": { ru: "Вы действительно хотите удалить?", en: "Are you sure you want to delete?" },
  "models.deleteDialog.body": {
    ru: "{name} будет удалена с диска. При необходимости модель можно скачать заново.",
    en: "{name} will be removed from disk. You can download the model again if needed.",
  },

  // ── Common buttons / labels ──
  "models.common.cancel": { ru: "Отмена", en: "Cancel" },
  "models.common.edit": { ru: "Изменить", en: "Edit" },
  "models.common.delete": { ru: "Удалить", en: "Delete" },
  "models.common.select": { ru: "Выбрать", en: "Select" },
  "models.common.selected": { ru: "Выбрано", en: "Selected" },
  "models.common.reset": { ru: "Сбросить", en: "Reset" },
  "models.common.optional": { ru: "Необязательно", en: "Optional" },
  "models.common.download": { ru: "Скачать", en: "Download" },
  "models.common.unavailable": { ru: "Недоступно", en: "Unavailable" },
  "models.common.or": { ru: "или", en: "or" },

  // ── Style / text-processing tab ──
  "models.styleTab.style": { ru: "Стиль", en: "Style" },
  "models.styleTab.prompts": { ru: "Промпты", en: "Prompts" },
  "models.textProcessing.title": { ru: "Обработка текста", en: "Text processing" },
  "models.textProcessing.desc": {
    ru: "Стиль очистки расшифровки и Промпты для summary.",
    en: "Transcript cleanup style and summary prompts.",
  },

  // ── Prompt preview (dev) ──
  "models.preview.title": { ru: "Prompt Preview", en: "Prompt Preview" },
  "models.preview.desc": {
    ru: "Итоговый prompt для текущего языка и стиля обработки.",
    en: "The final prompt for the current language and processing style.",
  },
  "models.preview.buildError": { ru: "Не удалось собрать preview prompt: {error}", en: "Failed to build the preview prompt: {error}" },
  "models.preview.profile": { ru: "Профиль", en: "Profile" },
  "models.preview.layers": { ru: "Слои", en: "Layers" },
  "models.preview.promptText": { ru: "Текст prompt", en: "Prompt text" },
  "models.preview.building": { ru: "Собираем preview...", en: "Building preview..." },
} as const;
