import { describe, expect, it } from "bun:test";

import {
  buildSelectionTranslationPrompt,
  translateSelectedTextWithBackend,
} from "./selectionTranslation";

describe("selected text translation prompt", () => {
  it("uses target language and asks for translation only", () => {
    const prompt = buildSelectionTranslationPrompt("en");

    expect(prompt).toContain("English");
    expect(prompt).toContain("Верни только перевод");
    expect(prompt).toContain("Исходный язык определи автоматически");
  });
});

describe("selected text translation chunking", () => {
  it("translates long text in order without reducing it into history-like summaries", async () => {
    const calls: string[] = [];
    const source = Array.from({ length: 4 }, (_, index) =>
      `Фрагмент ${index + 1}. ${"Текст ".repeat(1800)}`,
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
    expect(result).toBe(calls.map((_, index) => `translated-${index + 1}`).join("\n\n"));
    const translatedSource = calls.join("\n");
    expect(translatedSource.indexOf("Фрагмент 1")).toBeLessThan(
      translatedSource.indexOf("Фрагмент 4"),
    );
  });
});
