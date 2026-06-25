// Strings for the General settings tab (windows/settings/tabs/SettingsTab.tsx).
export const settingsGeneral = {
  // Interface language selector (the new feature)
  "settings.uiLanguage.title": { ru: "Язык интерфейса", en: "Interface language" },
  "settings.uiLanguage.desc": {
    ru: "Язык меню, кнопок и подписей приложения.",
    en: "Language of the app's menus, buttons and labels.",
  },
  "settings.uiLanguage.ru": { ru: "Русский", en: "Russian" },
  "settings.uiLanguage.en": { ru: "Английский", en: "English" },

  // Theme
  "settings.theme.title": { ru: "Тема", en: "Theme" },
  "settings.theme.system": { ru: "Системная", en: "System" },
  "settings.theme.light": { ru: "Светлая", en: "Light" },
  "settings.theme.dark": { ru: "Темная", en: "Dark" },
  "settings.theme.desc": {
    ru: "Системная тема следует настройке macOS.",
    en: "The system theme follows your macOS setting.",
  },

  // Recognition (speech) language
  "settings.recognitionLang.title": { ru: "Язык распознавания", en: "Recognition language" },
  "settings.recognitionLang.desc": { ru: "Язык, на котором вы говорите.", en: "The language you speak." },
  "settings.recognitionLang.searchPlaceholder": { ru: "Поиск языка...", en: "Search language..." },

  // Microphone
  "settings.mic.title": { ru: "Микрофон", en: "Microphone" },
  "settings.mic.desc": { ru: "Устройство для записи голоса.", en: "Device used to record your voice." },
  "settings.mic.systemDefault": { ru: "Системный микрофон по умолчанию", en: "System default microphone" },

  // Hotkey
  "settings.hotkey.title": { ru: "Горячая клавиша", en: "Hotkey" },
  "settings.hotkey.desc": {
    ru: "Нажмите на поле справа и введите новую комбинацию. Если сочетание занято, оставим предыдущую клавишу.",
    en: "Click the field on the right and press a new combination. If it's taken, the previous one is kept.",
  },
  "settings.hotkey.change": { ru: "Изменить", en: "Change" },
  "settings.hotkey.recording": { ru: "Запись", en: "Recording" },
  "settings.hotkey.checking": { ru: "Проверка", en: "Checking" },
  "settings.hotkey.press": { ru: "Нажмите сочетание", en: "Press a combination" },
  "settings.hotkey.current": { ru: "Текущая: {hotkey}", en: "Current: {hotkey}" },

  // Widget size
  "settings.widgetSize.title": { ru: "Размер виджета", en: "Widget size" },
  "settings.widgetSize.desc": { ru: "Масштаб плавающего виджета.", en: "Scale of the floating widget." },
  "settings.widgetSize.aria": { ru: "Размер виджета", en: "Widget size" },

  // Autostart
  "settings.autostart.title": { ru: "Автозапуск", en: "Autostart" },
  "settings.autostart.on": { ru: "Включен", en: "On" },
  "settings.autostart.off": { ru: "Выключен", en: "Off" },
  "settings.autostart.desc": {
    ru: "Запускать Talkis автоматически при входе в систему.",
    en: "Launch Talkis automatically when you log in.",
  },

  // Models directory
  "settings.modelsDir.title": { ru: "Директория моделей", en: "Models directory" },
  "settings.modelsDir.desc": {
    ru: "Папка для скачанных локальных моделей. Оставьте поле пустым, чтобы использовать директорию по умолчанию.",
    en: "Folder for downloaded local models. Leave empty to use the default directory.",
  },
  "settings.modelsDir.placeholder": { ru: "Директория по умолчанию", en: "Default directory" },

  // History storage
  "settings.storage.title": { ru: "Хранение истории", en: "History storage" },
  "settings.storage.desc": {
    ru: "Папка для истории диктовки и записей звонков. Оставьте пустым, чтобы использовать директорию по умолчанию.",
    en: "Folder for dictation history and call recordings. Leave empty to use the default directory.",
  },

  // Support
  "settings.support.title": { ru: "Поддержка", en: "Support" },
  "settings.support.button": { ru: "Написать в поддержку", en: "Contact support" },
  "settings.support.desc": {
    ru: "Откроется почтовый клиент с письмом на {email}. Опишите проблему или вопрос – мы поможем.",
    en: "Your email client will open a message to {email}. Describe the problem or question – we'll help.",
  },
} as const;
