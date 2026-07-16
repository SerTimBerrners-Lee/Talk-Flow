import { describe, expect, it } from "bun:test";

import {
  buildSelectionTranslationPrompt,
  buildSelectionTranslationSourcePayload,
  translateSelectedText,
  translateSelectedTextWithBackend,
} from "./selectionTranslation";
import type { AppSettings } from "../../../lib/store";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    translation: {
      selectionTargetLanguage: "en",
      selectionLocalTranslatorProvider: "",
    },
    ...overrides,
  } as AppSettings;
}

describe("selected text translation prompt", () => {
  it("uses target language and asks for translation only", () => {
    const prompt = buildSelectionTranslationPrompt("en");

    expect(prompt).toContain("English");
    expect(prompt).toContain("Верни только перевод");
    expect(prompt).toContain("Исходный язык определи автоматически");
    expect(prompt).toContain("Не проси пользователя предоставить текст");
    expect(prompt).toContain("переводи только содержимое между маркерами");
    expect(prompt).toContain("уже на целевом языке");
  });

  it("wraps source text explicitly for LLM-style translation backends", () => {
    const payload = buildSelectionTranslationSourcePayload(
      "Последние записи доступны для копирования и удаления.",
    );

    expect(payload).toContain("ТЕКСТ ДЛЯ ПЕРЕВОДА");
    expect(payload).toContain("<<<TALKIS_TRANSLATION_SOURCE>>>");
    expect(payload).toContain(
      "Последние записи доступны для копирования и удаления.",
    );
    expect(payload).toContain("<<<END_TALKIS_TRANSLATION_SOURCE>>>");
  });
});

describe("selected text translation chunking", () => {
  it("translates long text in order without reducing it into history-like summaries", async () => {
    const calls: string[] = [];
    const source = Array.from(
      { length: 4 },
      (_, index) => `Фрагмент ${index + 1}. ${"Текст ".repeat(1800)}`,
    ).join("\n\n");

    const result = await translateSelectedTextWithBackend({
      text: source,
      targetLanguage: "en",
      backend: {
        kind: "local",
        run: async ({ text }) => {
          calls.push(text);
          return `translated-${calls.length}`;
        },
      },
    });

    expect(calls.length).toBeGreaterThan(1);
    expect(result).toBe(
      calls.map((_, index) => `translated-${index + 1}`).join("\n\n"),
    );
    const translatedSource = calls.join("\n");
    expect(translatedSource.indexOf("Фрагмент 1")).toBeLessThan(
      translatedSource.indexOf("Фрагмент 4"),
    );
  });

  it("stops before the next chunk when a newer request cancels translation", async () => {
    const abortController = new AbortController();
    const calls: string[] = [];
    const source = Array.from(
      { length: 4 },
      (_, index) => `Фрагмент ${index + 1}. ${"Текст ".repeat(1800)}`,
    ).join("\n\n");

    const translation = translateSelectedTextWithBackend({
      text: source,
      targetLanguage: "en",
      signal: abortController.signal,
      backend: {
        kind: "local",
        run: async ({ text }) => {
          calls.push(text);
          return `translated-${calls.length}`;
        },
      },
      onProgress: () => abortController.abort(),
    });

    await expect(translation).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
  });
});

describe("selected text translation backend selection", () => {
  it("uses NLLB before LLM when the local translator is ready", async () => {
    const llmCalls: string[] = [];
    const nllbCalls: string[] = [];

    const result = await translateSelectedText({
      text: "Привет",
      settings: settings({
        translation: {
          selectionTargetLanguage: "en",
          selectionLocalTranslatorProvider: "nllb-200",
        },
      }),
      deps: {
        listLocalTranslators: async () => [
          { provider: "nllb-200", status: "ready" },
        ],
        translateWithLocalTranslator: async ({ text, target_language }) => {
          nllbCalls.push(`${text}:${target_language}`);
          return "Hello";
        },
        resolveSummaryBackend: () => ({
          kind: "custom",
          label: "test",
          run: async ({ text }) => {
            llmCalls.push(text);
            return "LLM";
          },
        }),
      },
    });

    expect(result).toBe("Hello");
    expect(nllbCalls).toEqual(["Привет:en"]);
    expect(llmCalls).toEqual([]);
  });

  it("uses OPUS RU -> EN when the pair translator is selected", async () => {
    const llmCalls: string[] = [];
    const opusCalls: string[] = [];

    const result = await translateSelectedText({
      text: "Привет",
      settings: settings({
        translation: {
          selectionTargetLanguage: "en",
          selectionLocalTranslatorProvider: "opus-mt-ru-en",
        },
      }),
      deps: {
        listLocalTranslators: async () => [
          { provider: "opus-mt-ru-en", status: "ready" },
        ],
        translateWithLocalTranslator: async ({
          provider,
          text,
          target_language,
        }) => {
          opusCalls.push(`${provider}:${text}:${target_language}`);
          return "Hello";
        },
        resolveSummaryBackend: () => ({
          kind: "custom",
          label: "test",
          run: async ({ text }) => {
            llmCalls.push(text);
            return "LLM";
          },
        }),
      },
    });

    expect(result).toBe("Hello");
    expect(opusCalls).toEqual(["opus-mt-ru-en:Привет:en"]);
    expect(llmCalls).toEqual([]);
  });

  it("falls back to LLM when NLLB fails", async () => {
    const llmCalls: string[] = [];

    const result = await translateSelectedText({
      text: "Привет",
      settings: settings({
        translation: {
          selectionTargetLanguage: "en",
          selectionLocalTranslatorProvider: "nllb-200",
        },
      }),
      deps: {
        listLocalTranslators: async () => [
          { provider: "nllb-200", status: "ready" },
        ],
        translateWithLocalTranslator: async () => {
          throw new Error("unsupported language");
        },
        resolveSummaryBackend: () => ({
          kind: "custom",
          label: "test",
          run: async ({ text }) => {
            llmCalls.push(text);
            return "Hello from LLM";
          },
        }),
      },
    });

    expect(result).toBe("Hello from LLM");
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain("<<<TALKIS_TRANSLATION_SOURCE>>>");
    expect(llmCalls[0]).toContain("Привет");
  });

  it("keeps the current no-model error when neither NLLB nor LLM is available", async () => {
    await expect(
      translateSelectedText({
        text: "Привет",
        settings: settings({
          translation: {
            selectionTargetLanguage: "en",
            selectionLocalTranslatorProvider: "nllb-200",
          },
        }),
        deps: {
          listLocalTranslators: async () => [
            { provider: "nllb-200", status: "not_installed" },
          ],
          resolveSummaryBackend: () => null,
        },
      }),
    ).rejects.toThrow("Для перевода нужна текстовая модель");
  });

  it("translates long text through NLLB chunks in order", async () => {
    const calls: string[] = [];
    const source = Array.from(
      { length: 4 },
      (_, index) => `Фрагмент ${index + 1}. ${"Текст ".repeat(1800)}`,
    ).join("\n\n");

    const result = await translateSelectedText({
      text: source,
      settings: settings({
        translation: {
          selectionTargetLanguage: "en",
          selectionLocalTranslatorProvider: "nllb-200",
        },
      }),
      deps: {
        listLocalTranslators: async () => [
          { provider: "nllb-200", status: "ready" },
        ],
        translateWithLocalTranslator: async ({ text }) => {
          calls.push(text);
          return `translated-${calls.length}`;
        },
        resolveSummaryBackend: () => null,
      },
    });

    expect(calls.length).toBeGreaterThan(1);
    expect(result).toBe(
      calls.map((_, index) => `translated-${index + 1}`).join("\n\n"),
    );
    const translatedSource = calls.join("\n");
    expect(translatedSource.indexOf("Фрагмент 1")).toBeLessThan(
      translatedSource.indexOf("Фрагмент 4"),
    );
  });

  it("uses LLM when NLLB is installed but not selected", async () => {
    const llmCalls: string[] = [];
    const result = await translateSelectedText({
      text: "Привет",
      settings: settings(),
      deps: {
        listLocalTranslators: async () => {
          throw new Error("nllb list should not be called");
        },
        translateWithLocalTranslator: async () => {
          throw new Error("nllb should not be called");
        },
        resolveSummaryBackend: () => ({
          kind: "custom",
          label: "test",
          run: async ({ text }) => {
            llmCalls.push(text);
            return "Hello from LLM";
          },
        }),
      },
    });

    expect(result).toBe("Hello from LLM");
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain("<<<TALKIS_TRANSLATION_SOURCE>>>");
    expect(llmCalls[0]).toContain("Привет");
  });

  it("keeps legacy trad selection working as an alias for NLLB", async () => {
    const nllbCalls: string[] = [];
    const result = await translateSelectedText({
      text: "Привет",
      settings: settings({
        translation: {
          selectionTargetLanguage: "en",
          selectionLocalTranslatorProvider: "trad",
        },
      }),
      deps: {
        listLocalTranslators: async () => [
          { provider: "nllb-200", status: "ready" },
        ],
        translateWithLocalTranslator: async ({ text }) => {
          nllbCalls.push(text);
          return "Hello";
        },
        resolveSummaryBackend: () => null,
      },
    });

    expect(result).toBe("Hello");
    expect(nllbCalls).toEqual(["Привет"]);
  });
});
