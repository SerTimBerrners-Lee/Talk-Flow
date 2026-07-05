import { describe, expect, it } from "bun:test";

import {
  customLocalLlmEndpointSettingsPatch,
  isBundledLocalLlmEndpoint,
  isBundledLocalLlmModelId,
  isLocalLlmEndpoint,
  localLlmDeleteSettingsPatch,
  selectedLocalLlmModelId,
} from "./localLlmSelection";

describe("local LLM selection helpers", () => {
  it("recognizes localhost and 127.0.0.1 endpoints", () => {
    expect(isLocalLlmEndpoint("http://127.0.0.1:8011/v1")).toBe(true);
    expect(isLocalLlmEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isLocalLlmEndpoint("https://api.openai.com/v1")).toBe(false);
  });

  it("recognizes bundled runtime ports and catalog ids", () => {
    expect(isBundledLocalLlmEndpoint("http://127.0.0.1:8011/v1")).toBe(true);
    expect(isBundledLocalLlmEndpoint("http://127.0.0.1:18249/v1")).toBe(true);
    expect(isBundledLocalLlmEndpoint("http://localhost:11434/v1")).toBe(false);
    expect(isBundledLocalLlmModelId("qwen3-1.7b-instruct-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("gemma-3-4b-it-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("phi-4-mini-instruct-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("smollm3-3b-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("granite-3.3-2b-instruct-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("qwen2.5-7b-instruct-q4")).toBe(true);
    expect(isBundledLocalLlmModelId("qwen3:1.7b")).toBe(false);
  });

  it("prefers the bundled runtime marker over the legacy model field", () => {
    expect(
      selectedLocalLlmModelId({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmModel: "legacy-model",
        llmLocalModelId: "qwen2.5-3b-instruct-q4",
      }),
    ).toBe("qwen2.5-3b-instruct-q4");
  });

  it("falls back to llmModel for pre-marker local selections", () => {
    expect(
      selectedLocalLlmModelId({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmModel: "qwen2.5-3b-instruct-q4",
        llmLocalModelId: "",
      }),
    ).toBe("qwen2.5-3b-instruct-q4");
  });

  it("does not treat a user-managed localhost endpoint as a bundled selection", () => {
    expect(
      selectedLocalLlmModelId({
        llmEndpoint: "http://localhost:11434/v1",
        llmModel: "qwen3-1.7b-instruct-q4",
        llmLocalModelId: "",
      }),
    ).toBe("");
  });

  it("clears persisted text-model fields only when deleting the selected model", () => {
    expect(
      localLlmDeleteSettingsPatch(
        {
          llmEndpoint: "http://127.0.0.1:8011/v1",
          llmModel: "qwen2.5-3b-instruct-q4",
          llmLocalModelId: "qwen2.5-3b-instruct-q4",
        },
        "qwen2.5-3b-instruct-q4",
      ),
    ).toEqual({ llmEndpoint: "", llmModel: "none", llmLocalModelId: "" });

    expect(
      localLlmDeleteSettingsPatch(
        {
          llmEndpoint: "http://127.0.0.1:8011/v1",
          llmModel: "qwen2.5-7b-instruct-q4",
          llmLocalModelId: "qwen2.5-7b-instruct-q4",
        },
        "qwen2.5-3b-instruct-q4",
      ),
    ).toBeNull();
  });

  it("keeps a custom endpoint when deleting a bundled model file", () => {
    expect(
      localLlmDeleteSettingsPatch(
        {
          llmEndpoint: "http://localhost:11434/v1",
          llmModel: "qwen3-1.7b-instruct-q4",
          llmLocalModelId: "",
        },
        "qwen3-1.7b-instruct-q4",
      ),
    ).toBeNull();
  });

  it("builds a custom endpoint settings patch and clears the bundled marker", () => {
    expect(
      customLocalLlmEndpointSettingsPatch({
        endpoint: " http://localhost:11434/v1 ",
        model: " qwen3:1.7b ",
        apiKey: " local-key ",
      }),
    ).toEqual({
      llmEndpoint: "http://localhost:11434/v1",
      llmModel: "qwen3:1.7b",
      llmApiKey: "local-key",
      llmLocalModelId: "",
    });
  });
});
