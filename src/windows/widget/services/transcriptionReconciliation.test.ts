import { describe, expect, test } from "bun:test";

import type { AppSettings } from "../../../lib/store";

import { resolveLiveTranscriptionReconciliationMode } from "./transcriptionReconciliation";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    useOwnKey: false,
    deviceToken: "cloud-device-token",
    realtimeTranscriptionEnabled: true,
    selectedApiAdapter: "openai",
    apiAdapters: {},
    whisperModel: "",
    ...overrides,
  } as AppSettings;
}

describe("live transcription reconciliation", () => {
  test("reconciles a successful Talkis Cloud realtime transcript", () => {
    expect(resolveLiveTranscriptionReconciliationMode(settings({}), true)).toBe(
      "talkis-cloud",
    );
  });

  test("does not reconcile Cloud when realtime was disabled or produced no result", () => {
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({ realtimeTranscriptionEnabled: false }),
        true,
      ),
    ).toBeNull();
    expect(
      resolveLiveTranscriptionReconciliationMode(settings({}), false),
    ).toBeNull();
  });

  test("preserves reconciliation for the legacy own-key OpenAI realtime model", () => {
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({
          useOwnKey: true,
          deviceToken: "",
          apiAdapters: {
            openai: {
              apiKey: "openai-key",
              endpoint: "https://api.openai.com",
              model: "gpt-realtime-whisper",
              connectionStatus: "verified",
              streamingCapability: "supported",
              streamingCapabilityFingerprint: "verified-config",
            },
          },
        }),
        true,
      ),
    ).toBe("openai");
  });

  test("does not add batch reconciliation to local or unrelated API realtime models", () => {
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({
          useOwnKey: true,
          deviceToken: "",
          selectedApiAdapter: "deepgram",
        }),
        true,
      ),
    ).toBeNull();
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({
          useOwnKey: true,
          deviceToken: "",
          selectedApiAdapter: "openai",
          apiAdapters: {
            openai: {
              apiKey: "openai-key",
              endpoint: "https://api.openai.com",
              model: "gpt-4o-transcribe",
              connectionStatus: "verified",
              streamingCapability: "supported",
              streamingCapabilityFingerprint: "verified-config",
            },
          },
        }),
        true,
      ),
    ).toBeNull();
  });
});
