import { describe, expect, it } from "bun:test";

import { buildHistoryAudioTrackSources } from "./HistoryAudioTrack";
import type { HistoryEntry } from "../lib/store";

function entry(source: HistoryEntry["source"]): HistoryEntry {
  return {
    id: "history-1",
    timestamp: "2026-07-15T10:00:00.000Z",
    duration: 10,
    raw: "",
    cleaned: "Перевод",
    source,
    callTracks: [
      {
        kind: "system",
        label: "Системный звук",
        path: "/tmp/system.wav",
      },
    ],
  };
}

describe("history audio track sources", () => {
  it("keeps live translation tracks after the full entry is loaded", () => {
    expect(buildHistoryAudioTrackSources(entry("liveTranslation"))).toEqual([
      {
        id: "system",
        label: "Системный звук",
        path: "/tmp/system.wav",
        mimeType: "audio/wav",
        fileName: "system.wav",
      },
    ]);
  });

  it("keeps both call tracks for synchronized playback", () => {
    const callEntry = entry("call");
    callEntry.callTracks = [
      {
        kind: "mic",
        label: "Вы",
        path: "/tmp/mic.webm",
      },
      {
        kind: "system",
        label: "Созвон",
        path: "/tmp/system.wav",
      },
    ];

    expect(buildHistoryAudioTrackSources(callEntry)).toEqual([
      {
        id: "system",
        label: "Созвон",
        path: "/tmp/system.wav",
        mimeType: "audio/wav",
        fileName: "system.wav",
      },
      {
        id: "mic",
        label: "Вы",
        path: "/tmp/mic.webm",
        mimeType: "audio/webm",
        fileName: "mic.webm",
      },
    ]);
  });
});
