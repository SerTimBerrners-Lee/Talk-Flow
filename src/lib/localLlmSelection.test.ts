import { describe, expect, it } from "bun:test";

import {
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
});
