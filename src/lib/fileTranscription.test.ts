import { describe, expect, it } from "bun:test";

import type { AppSettings } from "./store";
import {
  identifyFirstFileSpeakerAsUser,
  toFileTranscriptionErrorMessage,
} from "./fileTranscription";

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

  it("shows the diarization timeout message only for a real timeout", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error(
        "Proxy diarized error (502 Bad Gateway): context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
      ),
    );

    expect(message).toBe(
      "Обработка записи с разделением по говорящим заняла больше 10 минут. Повторите попытку или временно отключите «Разделение по говорящим».",
    );
  });

  it("does not mislabel other diarization failures as timeouts", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error(
        "Proxy diarized error (502 Bad Gateway): diarized STT failed: transcript status 400: invalid language_code",
      ),
    );

    expect(message).toBe(
      "Облаку не удалось разделить запись по говорящим. Повторите попытку; если ошибка сохранится, временно отключите «Разделение по говорящим».",
    );
  });

  it("maps non-diarization gateway failures to a network error", () => {
    const message = toFileTranscriptionErrorMessage(
      new Error("Proxy error (502 Bad Gateway): upstream unavailable"),
    );

    expect(message).toBe(
      "Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.",
    );
  });
});

describe("file speaker identity", () => {
  it("labels the first detected file speaker as the user", () => {
    const result = identifyFirstFileSpeakerAsUser({
      text: "old",
      converted: true,
      uploadedFileName: "call.webm",
      uploadedSizeBytes: 0,
      mode: "speakers",
      speakers: [
        { id: "speaker_0", label: "Speaker 1" },
        { id: "speaker_1", label: "Speaker 2" },
      ],
      segments: [
        {
          start: 0,
          end: 2,
          speakerId: "speaker_0",
          speakerLabel: "Speaker 1",
          text: "Здравствуйте",
        },
        {
          start: 3,
          end: 5,
          speakerId: "speaker_1",
          speakerLabel: "Speaker 2",
          text: "Добрый день",
        },
      ],
    });

    expect(result.speakers).toEqual([
      { id: "speaker_0", label: "Вы" },
      { id: "speaker_1", label: "Гость 1" },
    ]);
    expect(result.segments?.map((segment) => segment.speakerLabel)).toEqual([
      "Вы",
      "Гость 1",
    ]);
    expect(result.text).toContain("[00:00:00] Вы: Здравствуйте");
  });
});
