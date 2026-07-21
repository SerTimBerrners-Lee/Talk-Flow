import { describe, expect, test } from "bun:test";

import {
  createCallLiveDictationOptions,
  createNativeLiveDictationOptions,
  createDictationOverlayState,
  dictationOverlayStateFromStreamUpdate,
  isCloudSttStreamingEnabled,
  isLocalSttStreamingEnabled,
  isSttStreamingEnabled,
  resolveLiveDictationRuntimeEndpoint,
  shouldApplyDictationStreamUpdate,
} from "./dictationStreamOverlay";
import type { AppSettings } from "../../../lib/store";
import {
  realtimeConfigurationFingerprint,
  STREAMING_STT_ADAPTERS,
} from "../../../lib/realtimeModels";

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
      realtimeTranscriptionEnabled: true,
      localModels: {},
    } as AppSettings;

    expect(isLocalSttStreamingEnabled(settings)).toBe(true);
    expect(createNativeLiveDictationOptions(settings, "req-1")).toEqual({
      requestId: "req-1",
      provider: "local",
      apiKey: "",
      model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
      language: "ru",
      endpoint: "http://127.0.0.1:15223/v1/audio/transcriptions",
      streamingEnabled: true,
    });

    expect(
      createNativeLiveDictationOptions(
        {
          ...settings,
          realtimeTranscriptionEnabled: false,
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

  test("does not inherit API streaming capability for a batch-only local model", () => {
    const adapter = STREAMING_STT_ADAPTERS.find(
      (item) => item.id === "openai",
    )!;
    const apiValues = {
      apiKey: "secret",
      model: "gpt-realtime-whisper",
      endpoint: "",
    };
    const fingerprint = realtimeConfigurationFingerprint({
      provider: "openai",
      ...apiValues,
      defaultEndpoint: adapter.defaultEndpoint,
    });
    const settings = {
      useOwnKey: true,
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "whisper-large-v3-turbo",
      realtimeTranscriptionEnabled: true,
      selectedApiAdapter: "openai",
      apiAdapters: {
        openai: {
          ...apiValues,
          connectionStatus: "verified",
          streamingCapability: "supported",
          streamingCapabilityFingerprint: fingerprint,
        },
      },
    } as AppSettings;

    expect(isLocalSttStreamingEnabled(settings)).toBe(false);
    expect(isSttStreamingEnabled(settings)).toBe(false);
  });

  test("uses an installed streaming model for call preview when the final local model is batch-only", () => {
    const settings = {
      useOwnKey: true,
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "ai-sage/GigaAM-v3",
      language: "ru",
      realtimeTranscriptionEnabled: true,
      localModels: {
        "gigaam-v3-e2e-rnnt": { status: "downloaded" },
        "nemotron-35-asr-streaming-06b": { status: "downloaded" },
      },
    } as AppSettings;

    expect(createNativeLiveDictationOptions(settings, "dictation")).toBeNull();
    expect(createCallLiveDictationOptions(settings, "call")).toEqual({
      requestId: "call",
      provider: "local",
      apiKey: "",
      model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
      language: "ru",
      endpoint: "http://127.0.0.1:8000",
      streamingEnabled: true,
    });
  });

  test("uses the effective managed runtime endpoint returned by warm-up", () => {
    expect(
      resolveLiveDictationRuntimeEndpoint(
        "http://127.0.0.1:8000",
        "http://127.0.0.1:18018",
      ),
    ).toBe("http://127.0.0.1:18018");
    expect(
      resolveLiveDictationRuntimeEndpoint("http://127.0.0.1:8000", null),
    ).toBe("http://127.0.0.1:8000");
  });

  test("enables an API streaming model after its exact configuration was verified", () => {
    const adapter = STREAMING_STT_ADAPTERS.find(
      (item) => item.id === "openai",
    )!;
    const values = {
      apiKey: "secret",
      model: "gpt-realtime-whisper",
      endpoint: "",
    };
    const fingerprint = realtimeConfigurationFingerprint({
      provider: "openai",
      ...values,
      defaultEndpoint: adapter.defaultEndpoint,
    });
    expect(
      createNativeLiveDictationOptions(
        {
          useOwnKey: true,
          selectedApiAdapter: "openai",
          realtimeTranscriptionEnabled: true,
          language: "ru",
          apiAdapters: { openai: values },
        } as AppSettings,
        "req-unverified",
      ),
    ).toBeNull();

    const settings = {
      useOwnKey: true,
      selectedApiAdapter: "openai",
      realtimeTranscriptionEnabled: true,
      language: "ru",
      apiAdapters: {
        openai: {
          ...values,
          connectionStatus: "verified",
          streamingCapability: "supported",
          streamingCapabilityFingerprint: fingerprint,
        },
      },
    } as AppSettings;

    expect(createNativeLiveDictationOptions(settings, "req-api")).toMatchObject(
      {
        requestId: "req-api",
        provider: "openai",
        model: "gpt-realtime-whisper",
        endpoint: "https://api.openai.com",
        streamingEnabled: true,
      },
    );
  });

  test("enables cloud realtime transcription with the device token", () => {
    const settings = {
      useOwnKey: false,
      deviceToken: "device-jwt",
      realtimeTranscriptionEnabled: true,
      language: "ru",
    } as AppSettings;

    expect(isCloudSttStreamingEnabled(settings)).toBe(true);
    expect(createNativeLiveDictationOptions(settings, "req-cloud")).toEqual({
      requestId: "req-cloud",
      provider: "talkis-cloud",
      apiKey: "device-jwt",
      model: "gpt-realtime-whisper",
      language: "ru",
      endpoint: "https://proxy.talkis.ru",
      streamingEnabled: true,
    });

    expect(
      isCloudSttStreamingEnabled({
        ...settings,
        deviceToken: "",
      } as AppSettings),
    ).toBe(false);
  });
});
