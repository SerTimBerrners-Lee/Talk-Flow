import { describe, expect, test } from "bun:test";

import {
  buildCallLiveSpeakerTranscript,
  formatCallLiveTranscript,
} from "./callCapture";

describe("call live transcript", () => {
  test("keeps microphone and system speech in separate readable blocks", () => {
    const transcript = formatCallLiveTranscript(
      "Проверяю микрофон",
      "Вас хорошо слышно",
    );

    expect(transcript).toContain("Проверяю микрофон");
    expect(transcript).toContain("Вас хорошо слышно");
    expect(transcript).toContain("Гость 1");
    expect(transcript).not.toContain("Созвон:");
    expect(transcript).toContain("\n\n");
  });

  test("does not add an empty channel", () => {
    const transcript = formatCallLiveTranscript("Только микрофон", "   ");

    expect(transcript).toContain("Только микрофон");
    expect(transcript).not.toContain("\n\n");
  });

  test("builds the same speaker rows used by completed call transcripts", () => {
    const result = buildCallLiveSpeakerTranscript({
      micText: "Проверяю микрофон",
      systemText: "Вас хорошо слышно",
      micStartedAt: 2,
      systemStartedAt: 5,
      duration: 8,
    });

    expect(result.mode).toBe("speakers");
    expect(result.speakers?.map((speaker) => speaker.label)).toEqual([
      "Вы",
      "Гость 1",
    ]);
    expect(result.segments).toEqual([
      {
        start: 2,
        end: 8,
        speakerId: "call_live_you",
        speakerLabel: "Вы",
        text: "Проверяю микрофон",
      },
      {
        start: 5,
        end: 8,
        speakerId: "call_live_guest_1",
        speakerLabel: "Гость 1",
        text: "Вас хорошо слышно",
      },
    ]);
  });
});
