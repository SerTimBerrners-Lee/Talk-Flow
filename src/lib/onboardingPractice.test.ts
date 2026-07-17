import { describe, expect, test } from "bun:test";

import {
  isPracticePhraseMatch,
  normalizePracticeText,
} from "./onboardingPractice";

describe("onboarding practice phrase", () => {
  test("ignores punctuation and letter case", () => {
    expect(
      isPracticePhraseMatch(
        "Сегодня я превращаю голос в готовый текст!",
        "Сегодня я превращаю голос в готовый текст.",
      ),
    ).toBe(true);
  });

  test("accepts a close processed transcription", () => {
    expect(
      isPracticePhraseMatch(
        "Сегодня превращаю свой голос в готовый текст",
        "Сегодня я превращаю голос в готовый текст.",
      ),
    ).toBe(true);
  });

  test("rejects an unrelated short result", () => {
    expect(
      isPracticePhraseMatch(
        "Проверка микрофона",
        "Сегодня я превращаю голос в готовый текст.",
      ),
    ).toBe(false);
  });

  test("normalizes repeated whitespace", () => {
    expect(normalizePracticeText("  Voice,\n to   text. ")).toBe(
      "voice to text",
    );
  });
});
