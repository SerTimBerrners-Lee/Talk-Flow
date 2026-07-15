import { describe, expect, test } from "bun:test";

import {
  batchFallbackModel,
  canUseConfiguredRealtimeModel,
  hasVerifiedRealtimeCapability,
  REALTIME_TRANSLATION_ADAPTERS,
  realtimeConfigurationFingerprint,
  STREAMING_STT_ADAPTERS,
} from "./realtimeModels";

describe("realtime model catalogs", () => {
  test("contains all supported STT and translation transports", () => {
    expect(STREAMING_STT_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "openai",
      "deepgram",
      "mistral",
      "elevenlabs",
      "assemblyai",
      "xai",
    ]);
    expect(REALTIME_TRANSLATION_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "openai",
      "gemini",
    ]);
    expect(REALTIME_TRANSLATION_ADAPTERS[0].recommendedModel).toBe(
      "gpt-realtime",
    );
    expect(
      REALTIME_TRANSLATION_ADAPTERS[0].models.map((model) => model.id),
    ).toEqual(["gpt-realtime", "gpt-realtime-mini"]);
  });

  test("invalidates custom model capability after any configuration change", () => {
    const adapter = REALTIME_TRANSLATION_ADAPTERS[0];
    const base = {
      apiKey: "secret",
      model: "custom-live-model",
      endpoint: "https://gateway.example/v1/",
    };
    const fingerprint = realtimeConfigurationFingerprint({
      provider: adapter.id,
      ...base,
      defaultEndpoint: adapter.defaultEndpoint,
    });

    expect(
      hasVerifiedRealtimeCapability(adapter, {
        ...base,
        connectionStatus: "verified",
        streamingCapability: "supported",
        streamingCapabilityFingerprint: fingerprint,
      }),
    ).toBe(true);
    for (const patch of [
      { apiKey: "another-secret" },
      { model: "another-model" },
      { endpoint: "https://another-gateway.example/v1/" },
    ]) {
      expect(
        hasVerifiedRealtimeCapability(adapter, {
          ...base,
          ...patch,
          connectionStatus: "verified",
          streamingCapability: "supported",
          streamingCapabilityFingerprint: fingerprint,
        }),
      ).toBe(false);
    }
  });

  test("requires a verified handshake for a built-in streaming model", () => {
    const adapter = STREAMING_STT_ADAPTERS[0];
    const values = {
      apiKey: "secret",
      model: "gpt-realtime-whisper",
      endpoint: "",
    };
    expect(
      canUseConfiguredRealtimeModel(adapter, values),
    ).toBe(false);

    const fingerprint = realtimeConfigurationFingerprint({
      provider: "openai",
      ...values,
      defaultEndpoint: adapter.defaultEndpoint,
    });
    expect(
      canUseConfiguredRealtimeModel(adapter, {
        ...values,
        connectionStatus: "verified",
        streamingCapability: "supported",
        streamingCapabilityFingerprint: fingerprint,
      }),
    ).toBe(true);
    expect(batchFallbackModel("openai", "gpt-realtime-whisper")).toBe(
      "gpt-4o-transcribe",
    );
  });
});
