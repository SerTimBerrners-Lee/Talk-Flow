import { describe, expect, test } from "bun:test";

import {
  createNativeLiveDictationOptions,
  createDictationOverlayState,
  dictationOverlayStateFromStreamUpdate,
  isLocalSttStreamingEnabled,
  shouldApplyDictationStreamUpdate,
} from "./dictationStreamOverlay";
import type { AppSettings } from "../../../lib/store";

describe("dictation stream overlay state", () => {
  test("maps partial, final and inserting states without losing request id", () => {
    const partial = dictationOverlayStateFromStreamUpdate({
      requestId: "req-1",
      status: "partial",
      text: "Привет",
    });

    expect(partial.status).toBe("dictating");
    expect(partial.requestId).toBe("req-1");
    expect(partial.translatedText).toBe("Привет");

    const final = dictationOverlayStateFromStreamUpdate({
      requestId: "req-1",
      status: "final",
      text: "Привет, мир",
    });

    expect(final.status).toBe("done");
    expect(final.translatedText).toBe("Привет, мир");

    const inserting = createDictationOverlayState({
      requestId: "req-1",
      status: "inserting",
      text: final.translatedText,
    });

    expect(inserting.status).toBe("inserting");
    expect(inserting.translatedText).toBe("Привет, мир");
  });

  test("ignores stale stream updates", () => {
    expect(
      shouldApplyDictationStreamUpdate("req-2", {
        requestId: "req-1",
        status: "partial",
        text: "old",
      }),
    ).toBe(false);

    expect(
      shouldApplyDictationStreamUpdate("req-1", {
        requestId: "req-1",
        status: "partial",
        text: "new",
      }),
    ).toBe(true);
  });

  test("enables native live dictation only for local streaming models", () => {
    const settings = {
      useOwnKey: true,
      whisperEndpoint: "http://127.0.0.1:15223/v1/audio/transcriptions",
      whisperModel: "nvidia/nemotron-3.5-asr-streaming-0.6b",
      language: "ru",
      localModels: {},
    } as AppSettings;

    expect(isLocalSttStreamingEnabled(settings)).toBe(true);
    expect(createNativeLiveDictationOptions(settings, "req-1")).toEqual({
      requestId: "req-1",
      model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
      language: "ru",
      endpoint: "http://127.0.0.1:15223/v1/audio/transcriptions",
      streamingEnabled: true,
    });

    expect(
      createNativeLiveDictationOptions(
        {
          ...settings,
          localModels: {
            "nemotron-35-asr-streaming-06b": { streamingEnabled: false },
          },
        } as AppSettings,
        "req-2",
      ),
    ).toBeNull();

    expect(
      createNativeLiveDictationOptions(
        {
          ...settings,
          useOwnKey: false,
          whisperEndpoint: "https://api.openai.com/v1/audio/transcriptions",
        } as AppSettings,
        "req-3",
      ),
    ).toBeNull();
  });
});
