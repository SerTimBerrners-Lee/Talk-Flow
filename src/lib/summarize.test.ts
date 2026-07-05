import { describe, expect, it } from "bun:test";

import { normalizeSavedSettings, type AppSettings } from "./store";
import {
  isSummaryAvailable,
  LOCAL_TEXT_PROCESSING_LIMITS,
  resolveSummaryBackend,
  runTextMapReduce,
} from "./summarize";

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

  it("migrates Qwen3 bundled runtime settings into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:8011/v1",
      llmModel: "qwen3-1.7b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen3-1.7b-instruct-q4");
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

  it("preserves local STT streaming toggle state", () => {
    const normalized = normalizeSavedSettings({
      localModels: {
        "nemotron-35-asr-streaming-06b": {
          status: "downloaded",
          streamingEnabled: false,
        },
      },
    });

    expect(normalized.localModels?.["nemotron-35-asr-streaming-06b"]?.streamingEnabled).toBe(false);
  });
});

describe("long text map-reduce processing", () => {
  it("splits large local text into bounded model calls", async () => {
    const source = Array.from(
      { length: 90 },
      (_, index) =>
        `[00:${String(index).padStart(2, "0")}:00] Ученик: длинный фрагмент урока с деталями HTML, CSS, атрибутами, классами и домашним заданием.`,
    ).join("\n");
    const calls: Array<{ text: string; prompt: string; maxTokens?: number }> = [];

    const result = await runTextMapReduce(
      source,
      "Сделай подробное саммари урока.",
      0.3,
      async ({ text, prompt, maxTokens }) => {
        calls.push({ text, prompt, maxTokens });
        return `Краткие тезисы ${calls.length}`;
      },
      undefined,
      undefined,
      LOCAL_TEXT_PROCESSING_LIMITS,
    );

    expect(result).toBe(`Краткие тезисы ${calls.length}`);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0].text.length).toBeLessThanOrEqual(LOCAL_TEXT_PROCESSING_LIMITS.chunkChars);
    expect(calls[1].text.length).toBeLessThanOrEqual(LOCAL_TEXT_PROCESSING_LIMITS.chunkChars);
    expect(Math.max(...calls.map((call) => call.text.length))).toBeLessThan(source.length);
    expect(calls[0].prompt).toContain("НЕ пиши финальное саммари");
    expect(calls[0].maxTokens).toBeLessThan(calls[calls.length - 1]?.maxTokens ?? 0);
    expect(calls[calls.length - 1]?.prompt).toContain("Объедини их в один связный итоговый результат");
  });
});
