import { describe, expect, test } from "bun:test";

import { resolveBatchTranscriptionModel } from "./transcriptionModel";

describe("resolveBatchTranscriptionModel", () => {
  test("uses the selected local model instead of a stale API adapter model", () => {
    expect(
      resolveBatchTranscriptionModel({
        whisperEndpoint: "http://127.0.0.1:8000",
        whisperModel: "nvidia/nemotron-3.5-asr-streaming-0.6b",
        selectedApiAdapter: "openai",
        apiAdapters: {
          openai: { model: "gpt-4o-transcribe" },
        },
      }),
    ).toBe("nvidia/nemotron-3.5-asr-streaming-0.6b");
  });

  test("keeps the configured API model for a remote endpoint", () => {
    expect(
      resolveBatchTranscriptionModel({
        whisperEndpoint: "https://api.openai.com",
        whisperModel: "whisper-1",
        selectedApiAdapter: "openai",
        apiAdapters: {
          openai: { model: "gpt-4o-mini-transcribe" },
        },
      }),
    ).toBe("gpt-4o-mini-transcribe");
  });

  test("maps the legacy OpenAI realtime alias only for remote API mode", () => {
    expect(
      resolveBatchTranscriptionModel({
        whisperEndpoint: "https://api.openai.com",
        whisperModel: "whisper-1",
        selectedApiAdapter: "openai",
        apiAdapters: {
          openai: { model: "gpt-realtime-whisper" },
        },
      }),
    ).toBe("gpt-4o-transcribe");
  });
});
