import { describe, expect, it } from "bun:test";

import {
  DEV_CHAT_SCOPE_PROMPT,
  devChatCapabilitiesAnswer,
  isDevChatCapabilitiesQuestion,
  isDevChatCodeGenerationRequest,
} from "./devChatScope";

describe("dev chat scope", () => {
  it("recognizes standalone capability questions", () => {
    expect(isDevChatCapabilitiesQuestion("Что ты умеешь делать ?")).toBe(true);
    expect(isDevChatCapabilitiesQuestion("What can you do?")).toBe(true);
    expect(
      isDevChatCapabilitiesQuestion("Что ты можешь сказать о последней записи?"),
    ).toBe(false);
  });

  it("rejects direct code generation without blocking technical text work", () => {
    expect(isDevChatCodeGenerationRequest("Напиши код на Python")).toBe(true);
    expect(isDevChatCodeGenerationRequest("Можешь создать SQL-запрос?"),).toBe(true);
    expect(
      isDevChatCodeGenerationRequest("Сделай саммари этого текста про Java"),
    ).toBe(false);
  });

  it("describes only Talkis voice and text capabilities", () => {
    const answer = devChatCapabilitiesAnswer("ru");
    expect(answer).toContain("записями Talkis");
    expect(answer).toContain("не пишу программный код");
    expect(answer).not.toContain("помогать с кодом");
    expect(DEV_CHAT_SCOPE_PROMPT).toContain("не изображай универсального ассистента");
  });
});
