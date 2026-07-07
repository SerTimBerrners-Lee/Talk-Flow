import { describe, expect, it } from "bun:test";

import {
  compactHistoryEntryForStorage,
  HISTORY_MAX_SUMMARIES_PER_ENTRY,
  HISTORY_MAX_VOICE_AUDIO_ENTRIES,
  normalizeHistoryEntryFromStorage,
  normalizeSavedSettings,
  pruneHistoryAudioRetention,
  toHistoryListEntry,
  type HistoryEntry,
  type SummaryEntry,
} from "./store";

function summaryEntry(id: string): SummaryEntry {
  return {
    id,
    createdAt: `2026-07-07T10:00:0${id}.000Z`,
    durationMs: 100,
    promptId: "summary-short",
    promptName: "Коротко",
    text: `summary ${id}`,
  };
}

function historyEntry({
  id,
  source,
  audioPath,
  audioBase64,
}: {
  id: string;
  source: HistoryEntry["source"];
  audioPath?: string;
  audioBase64?: string;
}): HistoryEntry {
  return {
    id,
    timestamp: new Date(Date.now() - Number(id.replace(/\D/g, ""))).toISOString(),
    duration: 1,
    raw: "raw",
    cleaned: "cleaned",
    source,
    status: "completed",
    audioPath,
    audioBase64,
    audioMimeType: audioPath ? "audio/wav" : undefined,
    audioFileName: audioPath ? "recording.wav" : undefined,
  };
}

describe("history audio settings", () => {
  it("normalizes saveRecordingAudio only when it is boolean", () => {
    expect(normalizeSavedSettings({ saveRecordingAudio: true }).saveRecordingAudio).toBe(true);
    expect(normalizeSavedSettings({ saveRecordingAudio: false }).saveRecordingAudio).toBe(false);
    expect(normalizeSavedSettings({ saveRecordingAudio: "true" }).saveRecordingAudio).toBeUndefined();
  });
});

describe("history audio retention", () => {
  it("keeps audio paths for the latest 100 voice entries and drops older ones", () => {
    const voiceEntries = Array.from({ length: HISTORY_MAX_VOICE_AUDIO_ENTRIES + 1 }, (_, index) =>
      historyEntry({
        id: `voice-${index}`,
        source: "voice",
        audioPath: `/tmp/voice-${index}.wav`,
      }),
    );
    const callEntry = historyEntry({
      id: "call-1",
      source: "call",
      audioPath: "/tmp/call.wav",
    });

    const result = pruneHistoryAudioRetention([callEntry, ...voiceEntries]);

    expect(result.pathsToDelete).toEqual([`/tmp/voice-${HISTORY_MAX_VOICE_AUDIO_ENTRIES}.wav`]);
    expect(result.history[0].audioPath).toBe("/tmp/call.wav");
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioPath).toBeUndefined();
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioMimeType).toBeUndefined();
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioFileName).toBeUndefined();
  });

  it("drops legacy audioBase64 outside the latest 100 voice entries", () => {
    const voiceEntries = Array.from({ length: HISTORY_MAX_VOICE_AUDIO_ENTRIES + 1 }, (_, index) =>
      historyEntry({
        id: `voice-${index}`,
        source: "voice",
        audioBase64: `base64-${index}`,
      }),
    );

    const result = pruneHistoryAudioRetention(voiceEntries);

    expect(result.pathsToDelete).toEqual([]);
    expect(result.history[0].audioBase64).toBe("base64-0");
    expect(result.history[HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioBase64).toBeUndefined();
    expect(result.history[HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioMimeType).toBeUndefined();
    expect(result.history[HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioFileName).toBeUndefined();
  });
});

describe("history storage compaction", () => {
  it("keeps only the latest 3 summaries", () => {
    const entry = historyEntry({ id: "voice-1", source: "voice" });
    const compacted = compactHistoryEntryForStorage({
      ...entry,
      summaries: ["1", "2", "3", "4"].map(summaryEntry),
    });

    expect(compacted.summaries?.map((item) => item.id)).toEqual(
      ["1", "2", "3"].slice(0, HISTORY_MAX_SUMMARIES_PER_ENTRY),
    );
  });

  it("stores duplicate raw text compactly and restores it on read", () => {
    const entry = historyEntry({ id: "voice-1", source: "voice" });
    const compacted = compactHistoryEntryForStorage({
      ...entry,
      raw: "same text",
      cleaned: "same text",
    });

    expect(compacted.raw).toBe("");
    expect(normalizeHistoryEntryFromStorage(compacted).raw).toBe("same text");
  });

  it("builds a lightweight history list entry without heavy fields", () => {
    const entry = historyEntry({ id: "voice-1", source: "voice", audioBase64: "base64" });
    const listEntry = toHistoryListEntry({
      ...entry,
      raw: "same text",
      cleaned: "same text",
      segments: [
        {
          start: 0,
          end: 1,
          speakerId: "speaker-1",
          speakerLabel: "Speaker 1",
          text: "same text",
        },
      ],
      summaries: ["1", "2", "3", "4"].map(summaryEntry),
    });
    const keys = Object.keys(listEntry);

    expect(listEntry.textPreview).toBe("same text");
    expect(listEntry.hasAudio).toBe(true);
    expect(listEntry.summaryCount).toBe(HISTORY_MAX_SUMMARIES_PER_ENTRY);
    expect(keys).not.toContain("raw");
    expect(keys).not.toContain("cleaned");
    expect(keys).not.toContain("segments");
    expect(keys).not.toContain("summaries");
    expect(keys).not.toContain("audioBase64");
  });
});
