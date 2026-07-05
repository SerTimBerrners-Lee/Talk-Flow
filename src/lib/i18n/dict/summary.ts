// Strings for the summary slide-over modal + row action menus.
export const summary = {
  "summary.button": { ru: "Саммари", en: "Summary" },
  "summary.title": { ru: "Саммари", en: "Summary" },
  "summary.close": { ru: "Закрыть", en: "Close" },
  "summary.type": { ru: "Тип саммари", en: "Summary type" },
  "summary.generate": { ru: "Сделать саммари", en: "Summarize" },
  "summary.generating": { ru: "Генерируем…", en: "Generating…" },
  "summary.stop": { ru: "Остановить", en: "Stop" },
  "summary.regenerate": { ru: "Новое саммари", en: "New summary" },

  "summary.progress.preparing": { ru: "Готовим саммари…", en: "Preparing summary…" },
  "summary.progress.map": { ru: "Обрабатываем часть {current} из {total}…", en: "Processing part {current} of {total}…" },
  "summary.progress.reduce": { ru: "Объединяем части…", en: "Merging parts…" },

  "summary.noModel": {
    ru: "Для саммари нужен вход в Talkis Cloud или указанная текстовая модель (вкладка «Модели»).",
    en: "Summaries need a Talkis Cloud sign-in or a configured text model (the «Models» tab).",
  },
  "summary.empty.noText": { ru: "Нет текста для саммари.", en: "No text to summarize." },

  "summary.unavailable.tooltip": {
    ru: "Саммаризация недоступна — выберите текстовую модель в разделе «Модели»",
    en: "Summarization unavailable — select a text model in the «Models» section",
  },
  "summary.unavailable.note": {
    ru: "Саммаризация недоступна: выберите текстовую модель в разделе «Модели».",
    en: "Summarization is unavailable: select a text model in the «Models» section.",
  },

  "summary.history.title": { ru: "История саммари", en: "Summary history" },
  "summary.history.empty": { ru: "Здесь появятся сгенерированные саммари.", en: "Generated summaries will appear here." },
  "summary.history.duration": { ru: "{seconds} с", en: "{seconds} s" },

  "summary.copy": { ru: "Скопировать", en: "Copy" },
  "summary.copied": { ru: "Скопировано", en: "Copied" },
  "summary.edit": { ru: "Редактировать", en: "Edit" },
  "summary.delete": { ru: "Удалить", en: "Delete" },
  "summary.save": { ru: "Сохранить", en: "Save" },
  "summary.cancel": { ru: "Отмена", en: "Cancel" },
  "summary.expand": { ru: "Развернуть", en: "Expand" },
  "summary.collapse": { ru: "Свернуть", en: "Collapse" },
  "summary.actions": { ru: "Действия", en: "Actions" },

  "devChat.title": { ru: "Чат с моделью", en: "Model chat" },
  "devChat.clear": { ru: "Очистить", en: "Clear" },
  "devChat.empty": { ru: "Сообщений пока нет.", en: "No messages yet." },
  "devChat.input": { ru: "Сообщение", en: "Message" },
  "devChat.send": { ru: "Отправить", en: "Send" },
  "devChat.sending": { ru: "Отправляем…", en: "Sending…" },
  "devChat.running": { ru: "Думаю…", en: "Thinking…" },
  "devChat.searchingHistory": { ru: "Ищу в записях…", en: "Searching records…" },
  "devChat.suggestionLatest": { ru: "Последняя запись", en: "Latest record" },
  "devChat.suggestionToday": { ru: "Что обсуждали сегодня?", en: "What did we discuss today?" },
  "devChat.suggestionTasks": { ru: "Найди задачи", en: "Find tasks" },
  "devChat.suggestionLastCallSummary": { ru: "Саммари последнего созвона", en: "Summary of the latest call" },
  "devChat.scrollToLatest": { ru: "К последнему сообщению", en: "Jump to latest message" },
  "devChat.loadEarlier": { ru: "Показать предыдущие ({count})", en: "Load earlier ({count})" },
  "devChat.showFullMessage": { ru: "Показать полностью", en: "Show full message" },
  "devChat.collapseMessage": { ru: "Свернуть", en: "Collapse" },
  "devChat.copyResponse": { ru: "Скопировать ответ в буфер обмена", en: "Copy response to clipboard" },
  "devChat.copied": { ru: "Ответ скопирован", en: "Response copied" },
  "devChat.regenerateResponse": { ru: "Сгенерировать этот ответ заново", en: "Regenerate this response" },
  "devChat.usedSources": { ru: "Использованы записи:", en: "Used records:" },
  "devChat.openSource": { ru: "Открыть запись {title}", en: "Open record {title}" },
  "devChat.emptyResponse": { ru: "Модель вернула пустой ответ.", en: "The model returned an empty response." },
  "devChat.duration": { ru: "{seconds} с", en: "{seconds} s" },

  // History-row action menu (MainTab)
  "rowMenu.edit": { ru: "Редактировать", en: "Edit" },
  "rowMenu.copy": { ru: "Копировать", en: "Copy" },
  "rowMenu.summarize": { ru: "Саммари", en: "Summary" },
  "rowMenu.actions": { ru: "Действия", en: "Actions" },
} as const;
