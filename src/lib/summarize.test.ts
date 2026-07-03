import { describe, expect, it } from "bun:test";

import { normalizeSavedSettings, type AppSettings } from "./store";
import { isSummaryAvailable, resolveSummaryBackend } from "./summarize";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    apiKey: "",
    llmApiKey: "",
    llmEndpoint: "",
    llmModel: "gpt-4o-mini",
    llmLocalModelId: "",
    useOwnKey: true,
    deviceToken: "",
    ...overrides,
  } as AppSettings;
}

describe("resolveSummaryBackend local LLM behavior", () => {
  it("treats bundled runtime port 8011 without a selected model as unavailable", () => {
    const backend = resolveSummaryBackend(
      settings({ llmEndpoint: "http://127.0.0.1:8011/v1" }),
    );
    expect(backend).toBeNull();
    expect(
      isSummaryAvailable(settings({ llmEndpoint: "http://127.0.0.1:8011/v1" })),
    ).toBe(false);
  });

  it("treats bundled fallback ports without a selected model as unavailable", () => {
    expect(
      resolveSummaryBackend(
        settings({ llmEndpoint: "http://127.0.0.1:18210/v1" }),
      ),
    ).toBeNull();
  });

  it("resolves bundled local runtime when llmLocalModelId is set", () => {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmModel: "qwen2.5-3b-instruct-q4",
        llmLocalModelId: "qwen2.5-3b-instruct-q4",
      }),
    );
    expect(backend?.kind).toBe("local");
  });

  it("does not block a user's own localhost server outside bundled ports", () => {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://localhost:11434/v1",
        llmModel: "qwen2.5:7b",
      }),
    );
    expect(backend?.kind).toBe("local");
  });
});

describe("stored settings migration for bundled local LLM", () => {
  it("migrates old 8011 bundled runtime settings into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:8011/v1",
      llmModel: "qwen2.5-3b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen2.5-3b-instruct-q4");
  });

  it("migrates fallback bundled runtime ports into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:18208/v1",
      llmModel: "qwen2.5-7b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen2.5-7b-instruct-q4");
  });

  it("does not mark a user-managed localhost endpoint as bundled runtime", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://localhost:11434/v1",
      llmModel: "qwen2.5:7b",
    });
    expect(normalized.llmLocalModelId).toBeUndefined();
  });
});

describe("stored settings migration for local STT", () => {
  it("repairs stale mode flags when Whisper endpoint is local", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: false,
      provider: "openai",
      whisperApiKey: "stale-key",
      whisperEndpoint: "http://127.0.0.1:8000",
    });

    expect(normalized.useOwnKey).toBe(true);
    expect(normalized.provider).toBe("custom");
    expect(normalized.whisperApiKey).toBe("");
  });

  it("migrates removed Qwen and Parakeet endpoints to unified transcribe.cpp runtime", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: true,
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: "http://127.0.0.1:8002",
    });

    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
  });
});
