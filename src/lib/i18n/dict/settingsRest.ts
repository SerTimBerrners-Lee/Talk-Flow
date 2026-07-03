export const settingsRest = {
  // ===== MainTab (windows/settings/tabs/MainTab.tsx) =====
  "mainTab.filter.all": { ru: "Все", en: "All" },
  "mainTab.filter.voice": { ru: "Голос", en: "Voice" },
  "mainTab.filter.file": { ru: "Файл", en: "File" },
  "mainTab.filter.call": { ru: "Созвон", en: "Call" },
  "mainTab.source.file": { ru: "Файл", en: "File" },
  "mainTab.source.call": { ru: "Созвон", en: "Call" },
  "mainTab.source.voice": { ru: "Голос", en: "Voice" },
  "mainTab.speakerNameAria": { ru: "Имя {name}", en: "Name {name}" },
  "mainTab.collapse": { ru: "Скрыть", en: "Collapse" },
  "mainTab.expand": { ru: "Раскрыть", en: "Expand" },
  "mainTab.day.today": { ru: "Сегодня", en: "Today" },
  "mainTab.day.yesterday": { ru: "Вчера", en: "Yesterday" },
  "mainTab.retryFailed": {
    ru: "Не удалось повторно отправить запись.",
    en: "Failed to resubmit the recording.",
  },
  "mainTab.processingStopped": {
    ru: "Обработка остановлена. Можно запустить повторно.",
    en: "Processing stopped. You can run it again.",
  },
  "mainTab.howToStart": { ru: "Как начать запись", en: "How to start recording" },
  "mainTab.howItWorks": { ru: "Как это работает", en: "How it works" },
  "mainTab.howToStartHint": {
    ru: "Удерживайте горячую клавишу, говорите и отпустите ее, когда закончите. После обработки текст вставится автоматически.",
    en: "Hold the hotkey, speak and release it when you're done. After processing the text is pasted automatically.",
  },
  "mainTab.hero.supportTitle": {
    ru: "Нашли ошибку или есть вопрос?",
    en: "Found a bug or have a question?",
  },
  "mainTab.hero.supportAction": { ru: "Написать", en: "Write" },
  "mainTab.combination": { ru: "Комбинация", en: "Combination" },
  "mainTab.historyTitle": { ru: "История записей", en: "Recording history" },
  "mainTab.historyDescFilled": {
    ru: "Последние записи доступны для копирования и удаления.",
    en: "Recent recordings can be copied and deleted.",
  },
  "mainTab.historyDescEmpty": {
    ru: "Записей пока нет. Удерживайте {hotkey} для записи.",
    en: "No recordings yet. Hold {hotkey} to record.",
  },
  "mainTab.clearAllConfirmTitle": {
    ru: "Нажмите еще раз, чтобы очистить всю историю",
    en: "Click again to clear all history",
  },
  "mainTab.clearAllTitle": { ru: "Очистить всю историю", en: "Clear all history" },
  "mainTab.confirm": { ru: "Подтвердить", en: "Confirm" },
  "mainTab.clear": { ru: "Очистить", en: "Clear" },
  "mainTab.emptyTitle": { ru: "История пуста", en: "History is empty" },
  "mainTab.emptyHintBefore": {
    ru: "Записей пока нет. Удерживайте",
    en: "No recordings yet. Hold",
  },
  "mainTab.emptyHintAfter": { ru: "для записи.", en: "to record." },
  "mainTab.filterEmpty": {
    ru: "В этом фильтре записей пока нет.",
    en: "No recordings in this filter yet.",
  },
  "mainTab.colTime": { ru: "Время", en: "Time" },
  "mainTab.colText": { ru: "Текст", en: "Text" },
  "mainTab.durationMs": { ru: "{value}мс", en: "{value}ms" },
  "mainTab.durationS": { ru: "{value}с", en: "{value}s" },
  "mainTab.processing": { ru: "Идёт обработка…", en: "Processing…" },
  "mainTab.statusInterrupted": { ru: "Обработка прервана", en: "Processing interrupted" },
  "mainTab.statusFailed": { ru: "Обработка не завершилась", en: "Processing did not finish" },
  "mainTab.audioSavedLocally": {
    ru: "Аудио сохранено локально. Можно отправить повторно.",
    en: "Audio saved locally. You can resubmit it.",
  },
  "mainTab.stopProcessing": { ru: "Остановить обработку", en: "Stop processing" },
  "mainTab.retryProcess": { ru: "Обработать заново", en: "Process again" },
  "mainTab.success": { ru: "Успешно", en: "Done" },
  "mainTab.copy": { ru: "Скопировать", en: "Copy" },
  "mainTab.edit": { ru: "Редактировать", en: "Edit" },
  "mainTab.delete": { ru: "Удалить", en: "Delete" },

  // ===== SettingsApp (windows/settings/SettingsApp.tsx) =====
  "settingsApp.tab.main": { ru: "Главная", en: "Home" },
  "settingsApp.tab.file": { ru: "Транскрибация", en: "Transcription" },
  "settingsApp.tab.interpreter": { ru: "Переводчик (бета)", en: "Interpreter (beta)" },
  "settingsApp.tab.settings": { ru: "Настройки", en: "Settings" },
  "settingsApp.tab.model": { ru: "Модели", en: "Models" },
  "settingsApp.tab.style": { ru: "Стиль и Промпты", en: "Style and Prompts" },
  "settingsApp.installing": { ru: "Устанавливаем...", en: "Installing..." },
  "settingsApp.installUpdate": {
    ru: "Установить обновление {version}",
    en: "Install update {version}",
  },
  "settingsApp.updateFailed": {
    ru: "Не удалось установить обновление",
    en: "Failed to install the update",
  },
  "settingsApp.versionAria": {
    ru: "Версия приложения {version}. Открыть проект на GitHub",
    en: "App version {version}. Open the project on GitHub",
  },
  "settingsApp.githubTitle": { ru: "Проект на GitHub", en: "Project on GitHub" },
  "settingsApp.loadError": {
    ru: "Не удалось загрузить состояние приложения. Некоторые данные могут быть недоступны.",
    en: "Failed to load the app state. Some data may be unavailable.",
  },
  "settingsApp.loading": { ru: "Загружаем настройки…", en: "Loading settings…" },

  // ===== LocalLlmModels (components/LocalLlmModels.tsx) =====
  "localLlm.title": { ru: "Текстовые модели", en: "Text models" },
  "localLlm.desc": {
    ru: "Скачайте локальную модель и используйте ее для саммари без облака.",
    en: "Download a local model and use it for summaries without the cloud.",
  },
  "localLlm.status.deleting": { ru: "Удаляется", en: "Deleting" },
  "localLlm.status.downloading": { ru: "Скачивается", en: "Downloading" },
  "localLlm.status.selected": { ru: "Выбрана", en: "Selected" },
  "localLlm.status.ready": { ru: "Готова", en: "Ready" },
  "localLlm.status.notDownloaded": { ru: "Не скачана", en: "Not downloaded" },
  "localLlm.diskSize": { ru: "Размер на диске: {size}", en: "Size on disk: {size}" },
  "localLlm.ramRequired": { ru: "Требуется ОЗУ: от {ram} ГБ", en: "Required RAM: {ram} GB or more" },
  "localLlm.ramShort": { ru: "≥ {ram} ГБ", en: "≥ {ram} GB" },
  "localLlm.downloadingModel": { ru: "Загрузка модели", en: "Downloading model" },
  "localLlm.preparing": { ru: "Подготовка", en: "Preparing" },
  "localLlm.cancel": { ru: "Отмена", en: "Cancel" },
  "localLlm.download": { ru: "Скачать", en: "Download" },
  "localLlm.required": {
    ru: "Выберите текстовую модель. Без неё саммаризация недоступна (распознавание работает и так).",
    en: "Select a text model. Summarization is unavailable without one (transcription still works).",
  },
  "localLlm.select": { ru: "Выбрать", en: "Select" },
  "localLlm.delete": { ru: "Удалить", en: "Delete" },

  // ===== SettingsTab remaining literals (windows/settings/tabs/SettingsTab.tsx) =====
  // Microphone status/feedback
  "settingsGeneralExtra.mic.checking": {
    ru: "Проверяем доступные микрофоны...",
    en: "Checking available microphones...",
  },
  "settingsGeneralExtra.mic.unavailableEnv": {
    ru: "Список микрофонов недоступен в этой среде.",
    en: "The microphone list is unavailable in this environment.",
  },
  "settingsGeneralExtra.mic.missingSelected": {
    ru: "Ранее выбранный микрофон недоступен. Во время записи будет использован системный по умолчанию.",
    en: "The previously selected microphone is unavailable. The system default will be used while recording.",
  },
  "settingsGeneralExtra.mic.permissionNeeded": {
    ru: "Список микрофонов появится после разрешения доступа к микрофону.",
    en: "The microphone list will appear after you grant microphone access.",
  },
  "settingsGeneralExtra.mic.noneFound": {
    ru: "Не удалось найти доступные микрофоны. Подключите устройство или проверьте системные настройки.",
    en: "No available microphones found. Connect a device or check your system settings.",
  },
  "settingsGeneralExtra.mic.inUse": {
    ru: "Сейчас используется: {label}",
    en: "Currently in use: {label}",
  },
  "settingsGeneralExtra.mic.enumFailed": {
    ru: "Не удалось получить список микрофонов. Попробуйте открыть настройки ещё раз.",
    en: "Failed to get the microphone list. Try opening settings again.",
  },
  "settingsGeneralExtra.mic.fallbackName": {
    ru: "Микрофон {index}",
    en: "Microphone {index}",
  },
  // Hotkey feedback
  "settingsGeneralExtra.hotkey.initial": {
    ru: "Нажмите на поле и введите новую комбинацию. Esc отменяет ввод.",
    en: "Click the field and enter a new combination. Esc cancels input.",
  },
  "settingsGeneralExtra.hotkey.applyFailed": {
    ru: "Не удалось применить новую комбинацию.",
    en: "Failed to apply the new combination.",
  },
  "settingsGeneralExtra.hotkey.saved": {
    ru: "Новая горячая клавиша сохранена и уже работает.",
    en: "The new hotkey is saved and already working.",
  },
  "settingsGeneralExtra.hotkey.changeAgain": {
    ru: "Нажмите на поле, чтобы изменить комбинацию снова.",
    en: "Click the field to change the combination again.",
  },
  "settingsGeneralExtra.hotkey.pressNew": {
    ru: "Нажмите новую комбинацию.",
    en: "Press a new combination.",
  },
  "settingsGeneralExtra.hotkey.releaseToApply": {
    ru: "Отпустите комбинацию, чтобы применить.",
    en: "Release the combination to apply it.",
  },
  "settingsGeneralExtra.hotkey.inputCancelled": {
    ru: "Ввод отменен.",
    en: "Input cancelled.",
  },
  "settingsGeneralExtra.hotkey.cancelledKept": {
    ru: "Ввод отменен. Текущая комбинация сохранена.",
    en: "Input cancelled. The current combination is kept.",
  },
  "settingsGeneralExtra.hotkey.needMainKey": {
    ru: "Нажмите сочетание с основной клавишей.",
    en: "Press a combination with a main key.",
  },
  "settingsGeneralExtra.hotkey.invalid": {
    ru: "Неверная комбинация.",
    en: "Invalid combination.",
  },
  "settingsGeneralExtra.hotkey.recognizeFailed": {
    ru: "Не удалось распознать комбинацию.",
    en: "Could not recognize the combination.",
  },
  "settingsGeneralExtra.hotkey.checkingFree": {
    ru: "Проверяем, свободна ли эта комбинация...",
    en: "Checking whether this combination is free...",
  },
  "settingsGeneralExtra.hotkey.sendFailed": {
    ru: "Не удалось отправить новую комбинацию на проверку.",
    en: "Failed to send the new combination for verification.",
  },
  "settingsGeneralExtra.hotkey.startingCapture": {
    ru: "Запускаем запись новой комбинации...",
    en: "Starting capture of a new combination...",
  },
  "settingsGeneralExtra.hotkey.pressNewCombo": {
    ru: "Нажмите новое сочетание.",
    en: "Press a new combination.",
  },
  "settingsGeneralExtra.hotkey.captureStartFailed": {
    ru: "Не удалось запустить запись горячей клавиши.",
    en: "Failed to start hotkey capture.",
  },
  // Support
  "settingsGeneralExtra.support.mailSubject": {
    ru: "Talkis — обращение в поддержку",
    en: "Talkis — support request",
  },
  "settingsGeneralExtra.support.mailBody": {
    ru: "Опишите проблему или вопрос:\n\n\n",
    en: "Describe the problem or question:\n\n\n",
  },
  "settingsGeneralExtra.support.mailCopied": {
    ru: "Не удалось открыть почтовый клиент. Адрес скопирован: {email}",
    en: "Failed to open the email client. Address copied: {email}",
  },
  "settingsGeneralExtra.support.writeUs": {
    ru: "Напишите нам на {email}",
    en: "Write to us at {email}",
  },
  // Dialog titles
  "settingsGeneralExtra.dialog.chooseModelsDir": {
    ru: "Выберите директорию моделей",
    en: "Choose the models directory",
  },
  "settingsGeneralExtra.dialog.chooseStorageDir": {
    ru: "Выберите папку хранения истории",
    en: "Choose the history storage folder",
  },
  // Storage feedback
  "settingsGeneralExtra.storage.moved": {
    ru: "История перенесена в выбранную папку.",
    en: "History moved to the selected folder.",
  },
  "settingsGeneralExtra.storage.moveFailed": {
    ru: "Не удалось сохранить историю в выбранную папку. Текущая папка не изменилась.",
    en: "Failed to save history to the selected folder. The current folder is unchanged.",
  },
  "settingsGeneralExtra.storage.resetDone": {
    ru: "История возвращена в директорию по умолчанию.",
    en: "History restored to the default directory.",
  },
  "settingsGeneralExtra.storage.resetFailed": {
    ru: "Не удалось вернуть директорию по умолчанию. Текущая папка не изменилась.",
    en: "Failed to restore the default directory. The current folder is unchanged.",
  },
} as const;
