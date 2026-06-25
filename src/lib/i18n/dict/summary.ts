// Strings for the summary slide-over modal + row action menus.
export const summary = {
  "summary.button": { ru: "Саммари", en: "Summary" },
  "summary.title": { ru: "Саммари", en: "Summary" },
  "summary.close": { ru: "Закрыть", en: "Close" },
  "summary.type": { ru: "Тип саммари", en: "Summary type" },
  "summary.generate": { ru: "Сделать саммари", en: "Summarize" },
  "summary.generating": { ru: "Генерируем…", en: "Generating…" },
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

  // History-row action menu (MainTab)
  "rowMenu.edit": { ru: "Редактировать", en: "Edit" },
  "rowMenu.copy": { ru: "Копировать", en: "Copy" },
  "rowMenu.summarize": { ru: "Саммари", en: "Summary" },
  "rowMenu.actions": { ru: "Действия", en: "Actions" },
} as const;
