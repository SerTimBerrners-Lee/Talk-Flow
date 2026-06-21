import { describe, expect, it } from "bun:test";

import {
  applyTranscriptionToStats,
  countWords,
  createEmptyStats,
  monthKeyOf,
  normalizeStats,
  statsToView,
  type StatInput,
} from "./statsCore";

function input(overrides: Partial<StatInput> = {}): StatInput {
  return {
    id: "id-1",
    text: "one two three",
    source: "voice",
    durationSec: 60,
    timestamp: "2026-06-21T10:00:00.000Z",
    status: "completed",
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts whitespace-separated words for Latin and Cyrillic", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("привет как дела")).toBe(3);
    expect(countWords("  spaced   out \n words ")).toBe(3);
  });

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("counts CJK characters individually and mixes with words", () => {
    expect(countWords("你好")).toBe(2); // 你好
    expect(countWords("hello 你好 world")).toBe(4);
  });
});

describe("monthKeyOf", () => {
  it("formats YYYY-MM and falls back for invalid input", () => {
    expect(monthKeyOf("2026-06-21T10:00:00.000Z")).toBe("2026-06");
    expect(monthKeyOf("2026-01-02T00:00:00.000Z")).toBe("2026-01");
    expect(typeof monthKeyOf("not-a-date")).toBe("string");
  });
});

describe("applyTranscriptionToStats", () => {
  it("adds words to all-time and the month bucket", () => {
    const next = applyTranscriptionToStats(createEmptyStats(), input());
    expect(next.allTimeWords).toBe(3);
    expect(next.monthlyWords["2026-06"]).toBe(3);
    expect(next.countedIds).toContain("id-1");
  });

  it("de-duplicates the same id (retry / copy / paste)", () => {
    const first = applyTranscriptionToStats(createEmptyStats(), input());
    const second = applyTranscriptionToStats(first, input());
    expect(second).toBe(first); // same reference => no-op
    expect(second.allTimeWords).toBe(3);
  });

  it("ignores failed and empty transcriptions", () => {
    const empty = createEmptyStats();
    expect(applyTranscriptionToStats(empty, input({ status: "failed" }))).toBe(empty);
    expect(applyTranscriptionToStats(empty, input({ id: "x", text: "   " }))).toBe(empty);
  });

  it("ignores non-final statuses (processing / interrupted) even with text", () => {
    const empty = createEmptyStats();
    expect(applyTranscriptionToStats(empty, input({ status: "processing" }))).toBe(empty);
    expect(applyTranscriptionToStats(empty, input({ id: "y", status: "interrupted" }))).toBe(empty);
  });

  it("counts legacy entries that have no status", () => {
    const next = applyTranscriptionToStats(createEmptyStats(), input({ status: undefined }));
    expect(next.allTimeWords).toBe(3);
  });

  it("accumulates voice words/seconds for the speed metric", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(stats, input({ id: "a", text: "one two", durationSec: 60 }));
    stats = applyTranscriptionToStats(stats, input({ id: "b", text: "three four", durationSec: 60 }));
    expect(stats.voiceWords).toBe(4);
    expect(stats.voiceDurationSec).toBe(120);
  });

  it("excludes file/call sources from the speed metric but still counts words", () => {
    const stats = applyTranscriptionToStats(
      createEmptyStats(),
      input({ id: "f", source: "file", text: "a b c d", durationSec: 3600 }),
    );
    expect(stats.allTimeWords).toBe(4);
    expect(stats.voiceWords).toBe(0);
    expect(stats.voiceDurationSec).toBe(0);
  });

  it("buckets words by the month of the entry timestamp", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "m1", timestamp: "2026-05-30T23:00:00.000Z", text: "may words here" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "m2", timestamp: "2026-06-01T01:00:00.000Z", text: "june now" }),
    );
    expect(stats.monthlyWords["2026-05"]).toBe(3);
    expect(stats.monthlyWords["2026-06"]).toBe(2);
    expect(stats.allTimeWords).toBe(5);
  });
});

describe("statsToView", () => {
  it("computes average WPM from voice totals", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(stats, input({ id: "a", text: "one two three four", durationSec: 60 }));
    const view = statsToView(stats, new Date("2026-06-21T12:00:00.000Z"));
    expect(view.hasSpeed).toBe(true);
    expect(view.averageWpm).toBe(4); // 4 words / 1 minute
    expect(view.monthWords).toBe(4);
    expect(view.allTimeWords).toBe(4);
  });

  it("reports no speed when there is no voice data", () => {
    const view = statsToView(createEmptyStats(), new Date("2026-06-21T12:00:00.000Z"));
    expect(view.hasSpeed).toBe(false);
    expect(view.averageWpm).toBe(0);
  });

  it("shows only the current month's words", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(stats, input({ id: "may", timestamp: "2026-05-10T10:00:00.000Z", text: "a b" }));
    stats = applyTranscriptionToStats(stats, input({ id: "jun", timestamp: "2026-06-10T10:00:00.000Z", text: "c d e" }));
    const view = statsToView(stats, new Date("2026-06-21T12:00:00.000Z"));
    expect(view.monthWords).toBe(3);
    expect(view.allTimeWords).toBe(5);
  });
});

describe("normalizeStats", () => {
  it("repairs missing/garbage fields", () => {
    expect(normalizeStats(null)).toEqual(createEmptyStats());
    const repaired = normalizeStats({ allTimeWords: 10 } as never);
    expect(repaired.allTimeWords).toBe(10);
    expect(repaired.monthlyWords).toEqual({});
    expect(repaired.countedIds).toEqual([]);
  });
});
