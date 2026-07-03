import { describe, expect, it } from "bun:test";

import type { AppSettings } from "./store";
import { toFileTranscriptionErrorMessage } from "./fileTranscription";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    useOwnKey: true,
    provider: "openai",
    whisperEndpoint: "http://127.0.0.1:8000",
    ...overrides,
  } as AppSettings;
}

describe("file transcription error messages", () => {
  it("does not show API key auth text for local STT 401 errors", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error("Whisper API error (401 Unauthorized): invalid api key"),
      { settings: settings({}) },
    );

    expect(message).toBe(
      "Локальный runtime отклонил файл. Проверьте, что выбранная локальная модель скачана и запущена, затем попробуйте ещё раз.",
    );
  });

  it("treats a local endpoint as local even when mode flags are stale", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error("Whisper API error (401 Unauthorized): invalid api key"),
      {
        settings: settings({
          useOwnKey: false,
          provider: "openai",
          whisperEndpoint: "http://localhost:8000",
        }),
      },
    );

    expect(message).toBe(
      "Локальный runtime отклонил файл. Проверьте, что выбранная локальная модель скачана и запущена, затем попробуйте ещё раз.",
    );
  });

  it("does not leak already-localized API key text in local STT mode", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error("Не удалось авторизоваться в API. Проверьте ключ доступа."),
      { settings: settings({}) },
    );

    expect(message).toBe(
      "Локальный runtime отклонил файл. Проверьте, что выбранная локальная модель скачана и запущена, затем попробуйте ещё раз.",
    );
  });

  it("keeps API key auth text for remote STT 401 errors", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error("Whisper API error (401 Unauthorized): invalid api key"),
      {
        settings: settings({
          provider: "custom",
          whisperEndpoint: "https://api.openai.com/v1",
        }),
      },
    );

    expect(message).toBe("Не удалось авторизоваться в API. Проверьте ключ доступа.");
  });
});
