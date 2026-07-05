import { describe, expect, it } from "bun:test";

import {
  HISTORY_MAX_VOICE_AUDIO_ENTRIES,
  normalizeSavedSettings,
  pruneHistoryAudioRetention,
  type HistoryEntry,
} from "./store";

function historyEntry(id: string, source: HistoryEntry["source"], audioPath?: string): HistoryEntry {
  return {
    id,
    timestamp: new Date(Date.now() - Number(id.replace(/\D/g, ""))).toISOString(),
    duration: 1,
    raw: "raw",
    cleaned: "cleaned",
    source,
    status: "completed",
    audioPath,
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
      historyEntry(`voice-${index}`, "voice", `/tmp/voice-${index}.wav`),
    );
    const callEntry = historyEntry("call-1", "call", "/tmp/call.wav");

    const result = pruneHistoryAudioRetention([callEntry, ...voiceEntries]);

    expect(result.pathsToDelete).toEqual([`/tmp/voice-${HISTORY_MAX_VOICE_AUDIO_ENTRIES}.wav`]);
    expect(result.history[0].audioPath).toBe("/tmp/call.wav");
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioPath).toBeUndefined();
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioMimeType).toBeUndefined();
    expect(result.history[1 + HISTORY_MAX_VOICE_AUDIO_ENTRIES].audioFileName).toBeUndefined();
  });
});
