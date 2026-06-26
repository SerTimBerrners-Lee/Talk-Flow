// i18n strings for src/components: PermissionScreen, TranscriptionStatsPanel, TitleBar, UserPanel.
export const components = {
  // ── PermissionScreen ──────────────────────────────────────
  // PermissionRow status badges (not granted yet)
  "permission.badge.check": { ru: "Проверьте", en: "Check" },
  "permission.badge.actionNeeded": { ru: "Нужно действие", en: "Action needed" },
  "permission.badge.notGranted": { ru: "Не выдано", en: "Not granted" },

  // PermissionRow action button
  "permission.action.check": { ru: "Проверить", en: "Check" },
  "permission.action.retry": { ru: "Повторить", en: "Retry" },
  "permission.action.allow": { ru: "Разрешить", en: "Allow" },

  // Microphone help text per platform
  "permission.micHelp.macos": {
    ru: "Если микрофон был отклонен, откройте Системные настройки -> Конфиденциальность -> Микрофон и включите Talkis.",
    en: "If the microphone was denied, open System Settings -> Privacy -> Microphone and enable Talkis.",
  },
  "permission.micHelp.windows": {
    ru: "Если микрофон был отклонен, откройте Параметры -> Конфиденциальность и безопасность -> Микрофон и разрешите доступ для Talkis.",
    en: "If the microphone was denied, open Settings -> Privacy & security -> Microphone and allow access for Talkis.",
  },
  "permission.micHelp.linux": {
    ru: "Если микрофон недоступен, проверьте системные настройки звука и разрешения браузерного WebView для записи.",
    en: "If the microphone is unavailable, check your system sound settings and the WebView recording permissions.",
  },
  "permission.micHelp.default": {
    ru: "Если микрофон был отклонен, откройте системные настройки приватности и разрешите доступ для Talkis.",
    en: "If the microphone was denied, open your system privacy settings and allow access for Talkis.",
  },

  // Paste / accessibility permission row
  "permission.paste.titleAccessibility": { ru: "Универсальный доступ", en: "Accessibility" },
  "permission.paste.titlePaste": { ru: "Вставка текста", en: "Text insertion" },
  "permission.paste.descAccessibility": {
    ru: "Нужен для глобальной горячей клавиши и вставки текста.",
    en: "Required for the global hotkey and text insertion.",
  },
  "permission.paste.descLinux": {
    ru: "Talkis использует буфер обмена и Ctrl+V. В некоторых Wayland/X11 окружениях автоматическая вставка может быть ограничена.",
    en: "Talkis uses the clipboard and Ctrl+V. In some Wayland/X11 environments automatic insertion may be limited.",
  },
  "permission.paste.descDefault": {
    ru: "Talkis использует буфер обмена и Ctrl+V. Отдельное системное разрешение обычно не требуется.",
    en: "Talkis uses the clipboard and Ctrl+V. A separate system permission is usually not required.",
  },
  "permission.paste.helpNotInApplications": {
    ru: "Приложение запущено не из Applications: {path}",
    en: "The app is not running from Applications: {path}",
  },
  "permission.paste.helpLinux": {
    ru: "Если вставка не сработает, скопированный текст останется в буфере обмена и его можно вставить вручную.",
    en: "If insertion fails, the copied text stays on the clipboard and you can paste it manually.",
  },

  // Header
  "permission.header.title": { ru: "Доступы для Talkis", en: "Permissions for Talkis" },
  "permission.header.subtitle": {
    ru: "Осталось выдать системные разрешения для записи голоса, звука созвона и работы горячей клавиши.",
    en: "Just grant the system permissions for recording your voice, call audio and the hotkey.",
  },

  // Install warning
  "permission.installWarning.title": {
    ru: "Переместите приложение в Applications",
    en: "Move the app to Applications",
  },
  "permission.installWarning.desc": {
    ru: "Текущая сборка запущена из временного места. Переместите Talkis в Applications и откройте оттуда.",
    en: "The current build is running from a temporary location. Move Talkis to Applications and open it from there.",
  },

  // Microphone permission row
  "permission.mic.title": { ru: "Микрофон", en: "Microphone" },
  "permission.mic.desc": {
    ru: "Нужен для записи голоса перед отправкой на распознавание.",
    en: "Needed to record your voice before sending it for recognition.",
  },

  // System audio permission row
  "permission.systemAudio.title": { ru: "Звук системы", en: "System audio" },
  "permission.systemAudio.desc": {
    ru: "Нужен, чтобы слушать звук созвона вместе с микрофоном.",
    en: "Needed to capture call audio together with the microphone.",
  },
  "permission.systemAudio.help": {
    ru: "После нажатия macOS может попросить разрешить Talkis запись системного аудио.",
    en: "After clicking, macOS may ask you to allow Talkis to record system audio.",
  },

  // Hint block
  "permission.hint.systemAudioDenied": {
    ru: "Если доступ был отклонен, откройте Системные настройки -> Конфиденциальность и безопасность -> Запись экрана и системного аудио и включите Talkis.",
    en: "If access was denied, open System Settings -> Privacy & security -> Screen & System Audio Recording and enable Talkis.",
  },
  "permission.hint.reopenAfterMove": {
    ru: "После перемещения приложения в Applications откройте его заново.",
    en: "After moving the app to Applications, open it again.",
  },
  "permission.hint.macosDelay": {
    ru: "macOS применяет доступ не мгновенно. После изменения настройки вернитесь в приложение.",
    en: "macOS does not apply access instantly. After changing the setting, return to the app.",
  },

  // Footer status line
  "permission.footer.launchFromApplications": {
    ru: "Сначала запустите из Applications.",
    en: "Launch from Applications first.",
  },
  "permission.footer.allGranted": { ru: "Все доступы выданы.", en: "All permissions granted." },
  "permission.footer.grantToContinue": {
    ru: "Выдайте разрешения для продолжения.",
    en: "Grant the permissions to continue.",
  },
  "permission.footer.grantBothToContinue": {
    ru: "Выдайте оба разрешения для продолжения.",
    en: "Grant both permissions to continue.",
  },
  "permission.footer.grantMicToContinue": {
    ru: "Разрешите микрофон для продолжения.",
    en: "Allow the microphone to continue.",
  },

  // Footer button
  "permission.button.continue": { ru: "Продолжить", en: "Continue" },
  "permission.button.check": { ru: "Проверить", en: "Check" },

  // ── TranscriptionStatsPanel ───────────────────────────────
  "stats.suffix.thousand": { ru: "к", en: "k" },
  "stats.suffix.million": { ru: "М", en: "M" },
  "stats.wordsThisMonth": { ru: "Слов за месяц", en: "Words this month" },
  "stats.wordsTotal": { ru: "Слов всего", en: "Words total" },
  "stats.wordsPerMinute": { ru: "Слов в минуту", en: "Words per minute" },

  // ── TitleBar ──────────────────────────────────────────────
  "titleBar.close": { ru: "Закрыть", en: "Close" },
  "titleBar.minimize": { ru: "Свернуть", en: "Minimize" },
  "titleBar.maximize": { ru: "Развернуть", en: "Maximize" },

  // ── UserPanel ─────────────────────────────────────────────
  "userPanel.subscriptionActive": { ru: "Подписка активна", en: "Subscription active" },
  "userPanel.upgradeToPro": { ru: "Перейти на PRO", en: "Upgrade to PRO" },
  "userPanel.logout": { ru: "Выйти", en: "Log out" },
  "userPanel.cta.title": { ru: "Активируйте Talkis", en: "Activate Talkis" },
  "userPanel.cta.feature.unlimited": { ru: "Безлимитное использование", en: "Unlimited usage" },
  "userPanel.cta.feature.noVpn": { ru: "Без VPN и Прокси", en: "No VPN or proxy" },
  "userPanel.cta.feature.deviceSync": { ru: "Синхронизация устройств", en: "Device sync" },
  "userPanel.cta.feature.freeTrial": { ru: "7 дней бесплатно", en: "7 days free" },
} as const;
