import { describe, expect, it } from "bun:test";

import {
  buildDevChatHistoryContext,
  buildHistorySearchIndex,
  cosineSimilarity,
  reconcileHistorySearchIndex,
} from "./devChatHistoryContext";
import type { HistoryEntry } from "./store";

function historyEntry(
  id: string,
  timestamp: string,
  cleaned: string,
  source: HistoryEntry["source"] = "voice",
  status: HistoryEntry["status"] = "completed",
): HistoryEntry {
  return {
    id,
    timestamp,
    duration: 62,
    raw: cleaned,
    cleaned,
    source,
    status,
  };
}

describe("dev chat history context", () => {
  it("answers latest record questions without model context", () => {
    const result = buildDevChatHistoryContext(
      "какая последняя запись делалась на транскрибации?",
      [
        historyEntry("old", "2026-07-04T10:00:00.000Z", "Старая запись"),
        historyEntry("new", "2026-07-05T10:00:00.000Z", "Новая запись"),
      ],
      "ru",
    );

    expect(result.directAnswer).toContain("Новая запись");
    expect(result.contextText).toBeUndefined();
    expect(result.sources?.[0]?.entryId).toBe("new");
  });

  it("counts records with source filters", () => {
    const result = buildDevChatHistoryContext(
      "сколько записей со звонков?",
      [
        historyEntry("voice", "2026-07-05T10:00:00.000Z", "Голос", "voice"),
        historyEntry("call-1", "2026-07-05T11:00:00.000Z", "Созвон 1", "call"),
        historyEntry("call-2", "2026-07-05T12:00:00.000Z", "Созвон 2", "call"),
      ],
      "ru",
    );

    expect(result.directAnswer).toBe("Найдено записей транскрибации: 2.");
    expect(result.sources).toBeUndefined();
  });

  it("answers first record questions without model context", () => {
    const result = buildDevChatHistoryContext(
      "какая первая запись транскрибации?",
      [
        historyEntry("old", "2026-07-04T10:00:00.000Z", "Самая старая запись"),
        historyEntry("new", "2026-07-05T10:00:00.000Z", "Новая запись"),
      ],
      "ru",
    );

    expect(result.directAnswer).toContain("Самая старая запись");
    expect(result.contextText).toBeUndefined();
    expect(result.sources?.[0]?.entryId).toBe("old");
  });

  it("filters records by recent week metadata", () => {
    const result = buildDevChatHistoryContext(
      "сколько записей за неделю?",
      [
        historyEntry("recent", "2026-07-04T10:00:00.000Z", "Свежая запись"),
        historyEntry("old", "2026-06-01T10:00:00.000Z", "Старая запись"),
      ],
      "ru",
    );

    expect(result.directAnswer).toBe("Найдено записей транскрибации: 1.");
  });

  it("filters context by known file names", () => {
    const fileEntry = {
      ...historyEntry("file-match", "2026-07-05T10:00:00.000Z", "Обсуждали бюджет проекта.", "file"),
      fileName: "client-budget.m4a",
    };
    const otherEntry = {
      ...historyEntry("file-other", "2026-07-05T11:00:00.000Z", "Говорили про отпуск.", "file"),
      fileName: "team-notes.m4a",
    };

    const result = buildDevChatHistoryContext(
      "что было в файле client-budget?",
      [fileEntry, otherEntry],
      "ru",
    );

    expect(result.contextText).toContain("Обсуждали бюджет проекта");
    expect(result.contextText).not.toContain("Говорили про отпуск");
    expect(result.sources?.[0]?.entryId).toBe("file-match");
  });

  it("filters context by known speaker labels", () => {
    const speakerEntry: HistoryEntry = {
      ...historyEntry("speaker-match", "2026-07-05T10:00:00.000Z", "", "call"),
      mode: "speakers",
      speakers: [{ id: "s1", label: "Анна" }],
      segments: [{ start: 0, end: 4, speakerId: "s1", speakerLabel: "Анна", text: "Нужно подготовить договор." }],
    };
    const otherEntry = historyEntry("other", "2026-07-05T11:00:00.000Z", "Борис обсуждал отпуск.", "call");

    const result = buildDevChatHistoryContext(
      "что говорила Анна?",
      [speakerEntry, otherEntry],
      "ru",
    );

    expect(result.contextText).toContain("Нужно подготовить договор");
    expect(result.contextText).not.toContain("Борис обсуждал отпуск");
    expect(result.sources?.[0]?.entryId).toBe("speaker-match");
  });

  it("builds context for semantic questions", () => {
    const result = buildDevChatHistoryContext(
      "что я говорил про оплату клиента?",
      [
        historyEntry("match", "2026-07-05T10:00:00.000Z", "Обсуждали оплату клиента Иванова."),
        historyEntry("other", "2026-07-05T11:00:00.000Z", "Говорили про отпуск."),
      ],
      "ru",
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toContain("оплату клиента");
    expect(result.contextText).not.toContain("Говорили про отпуск");
    expect(result.sources).toHaveLength(1);
    expect(result.sources?.[0]?.entryId).toBe("match");
  });

  it("does not search history for ordinary small talk", () => {
    const history = [
      historyEntry("match", "2026-07-05T10:00:00.000Z", "Нужно разработать мобильную версию игры."),
    ];
    const searchIndex = buildHistorySearchIndex(history).map((chunk) => ({
      ...chunk,
      embedding: [1, 0],
    }));

    const result = buildDevChatHistoryContext(
      "как дела?",
      history,
      "ru",
      searchIndex,
      [1, 0],
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });

  it("does not treat a generic summary request as a history search", () => {
    const result = buildDevChatHistoryContext(
      "Нужно разработать мобильную версию и сделать summary по детализации",
      [historyEntry("match", "2026-07-05T10:00:00.000Z", "Историческая запись про проект.")],
      "ru",
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });

  it("splits long records into searchable chunks", () => {
    const longText = [
      "Про оплату клиента и договор.",
      "x".repeat(1600),
      "Отдельный фрагмент про отпуск.",
    ].join(" ");

    const chunks = buildHistorySearchIndex([
      historyEntry("long", "2026-07-05T10:00:00.000Z", longText),
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.entryId === "long")).toBe(true);
    expect(chunks[0]?.chunkId).toBe("long:0");
    expect(chunks[0]?.contentHash).toBeTruthy();
  });

  it("does not index empty, failed, or interrupted records", () => {
    const chunks = buildHistorySearchIndex([
      historyEntry("empty", "2026-07-05T10:00:00.000Z", ""),
      historyEntry("failed", "2026-07-05T11:00:00.000Z", "Ошибка", "voice", "failed"),
      historyEntry("interrupted", "2026-07-05T12:00:00.000Z", "Прервано", "voice", "interrupted"),
      historyEntry("ok", "2026-07-05T13:00:00.000Z", "Готовая запись"),
    ]);

    expect(chunks.map((chunk) => chunk.entryId)).toEqual(["ok"]);
  });

  it("uses the best matching chunk instead of the full long record", () => {
    const longText = [
      "Начало записи про отпуск и расписание.",
      "x".repeat(1800),
      "Финальный фрагмент про оплату клиента Иванова.",
    ].join(" ");

    const result = buildDevChatHistoryContext(
      "что было про оплату клиента?",
      [historyEntry("long", "2026-07-05T10:00:00.000Z", longText)],
      "ru",
    );

    expect(result.contextText).toContain("оплату клиента");
    expect(result.contextText).not.toContain("Начало записи про отпуск");
  });

  it("returns a direct not-found answer for history questions without matches", () => {
    const result = buildDevChatHistoryContext(
      "что я говорил про оплату клиента?",
      [historyEntry("other", "2026-07-05T10:00:00.000Z", "Говорили про отпуск.")],
      "ru",
    );

    expect(result.directAnswer).toBe("Я не нашёл подходящих записей транскрибации.");
    expect(result.contextText).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });

  it("ranks records by vector similarity when lexical matching is not enough", () => {
    const history = [
      historyEntry("match", "2026-07-05T10:00:00.000Z", "Коммерческое предложение отправили клиенту."),
      historyEntry("other", "2026-07-05T11:00:00.000Z", "Планировали отпуск команды."),
    ];
    const searchIndex = buildHistorySearchIndex(history).map((chunk) => ({
      ...chunk,
      embedding: chunk.entryId === "match" ? [1, 0] : [0, 1],
    }));

    const result = buildDevChatHistoryContext(
      "что обсуждали?",
      history,
      "ru",
      searchIndex,
      [0.99, 0.01],
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toContain("Коммерческое предложение");
    expect(result.contextText).not.toContain("Планировали отпуск");
    expect(result.sources?.[0]?.entryId).toBe("match");
  });

  it("uses latest matching record as context for summary tasks", () => {
    const result = buildDevChatHistoryContext(
      "сделай саммари последнего созвона",
      [
        historyEntry("old-call", "2026-07-04T10:00:00.000Z", "Старый созвон про отпуск.", "call"),
        historyEntry("new-call", "2026-07-05T10:00:00.000Z", "Новый созвон про договор.", "call"),
        historyEntry("voice", "2026-07-05T11:00:00.000Z", "Голосовая заметка.", "voice"),
      ],
      "ru",
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toContain("Новый созвон про договор");
    expect(result.contextText).not.toContain("Старый созвон про отпуск");
    expect(result.sources?.[0]?.entryId).toBe("new-call");
  });

  it("uses extended latest call context for suggested summary prompts", () => {
    const longCall = [
      "Начали с планов мобильной версии.",
      "x".repeat(1800),
      "Потом обсудили мультиплеер и роли игроков.",
      "y".repeat(1800),
      "В конце договорились добавить таблицу истории summary.",
    ].join(" ");

    const result = buildDevChatHistoryContext(
      "Сделай подробное структурированное саммари последнего созвона из транскрибации. Включи темы, ключевые тезисы, решения, задачи, риски или открытые вопросы и источник.",
      [historyEntry("call", "2026-07-05T10:00:00.000Z", longCall, "call")],
      "ru",
    );

    expect(result.directAnswer).toBeUndefined();
    expect(result.contextText).toContain("Начали с планов мобильной версии");
    expect(result.contextText).toContain("мультиплеер");
    expect(result.contextText).toContain("таблицу истории summary");
    expect(result.sources?.[0]?.entryId).toBe("call");
  });

  it("calculates cosine similarity for embedding vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });

  it("reconciles the cached index by preserving unchanged chunks and dropping stale entries", () => {
    const unchanged = historyEntry("same", "2026-07-05T10:00:00.000Z", "Про оплату.");
    const changed = historyEntry("changed", "2026-07-05T11:00:00.000Z", "Старый текст.");
    const existing = buildHistorySearchIndex([
      unchanged,
      changed,
      historyEntry("deleted", "2026-07-05T12:00:00.000Z", "Удалённая запись."),
    ]);
    expect(existing[0]).toBeDefined();
    existing[0] = { ...existing[0]!, embedding: [0.1, 0.2] };

    const reconciled = reconcileHistorySearchIndex(
      [
        unchanged,
        historyEntry("changed", "2026-07-05T11:00:00.000Z", "Новый текст."),
        historyEntry("failed", "2026-07-05T13:00:00.000Z", "Ошибка.", "voice", "failed"),
      ],
      existing,
    );

    expect(reconciled.map((chunk) => chunk.entryId)).toEqual(["same", "changed"]);
    expect(reconciled.find((chunk) => chunk.entryId === "same")?.embedding).toEqual([0.1, 0.2]);
    expect(reconciled.find((chunk) => chunk.entryId === "changed")?.text).toBe("Новый текст.");
  });
});
