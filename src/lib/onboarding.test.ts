import { describe, expect, it } from "bun:test";

import {
  buildOnboardingLocalSttPatch,
  formatOnboardingDownloadProgress,
  matchesOnboardingTestPhrase,
  normalizeOnboardingTestPhrase,
  resolveOnboardingModelId,
} from "./onboarding";
import { ONBOARDING_STT_MODELS } from "../config/onboardingSttModels";

describe("onboarding local STT helpers", () => {
  it("normalizes casing, spacing and е/ё without removing punctuation", () => {
    expect(
      normalizeOnboardingTestPhrase(
        "  СЕГОДНЯ   ХОРОШАЯ ПОГОДА , и я говорю ясно.  ",
      ),
    ).toBe("сегодня хорошая погода, и я говорю ясно.");
  });

  it("requires the recognized words and punctuation to match", () => {
    const expected = "Сегодня хорошая погода, и я говорю ясно.";

    expect(
      matchesOnboardingTestPhrase(
        "сегодня хорошая погода, и я говорю ясно.",
        expected,
      ),
    ).toBe(true);
    expect(
      matchesOnboardingTestPhrase(
        "Сегодня хорошая погода и я говорю ясно.",
        expected,
      ),
    ).toBe(false);
    expect(
      matchesOnboardingTestPhrase(
        "Сегодня плохая погода, и я говорю ясно.",
        expected,
      ),
    ).toBe(false);
  });

  it("keeps the active bundled model when onboarding is reopened", () => {
    expect(
      resolveOnboardingModelId([], {
        whisperEndpoint: "http://127.0.0.1:18220",
        whisperModel: "Qwen/Qwen3-ASR-0.6B",
      }),
    ).toBe("qwen3-asr-06b");
  });

  it("prefers an already installed onboarding model", () => {
    expect(
      resolveOnboardingModelId(["whisper-small"], {
        whisperEndpoint: "https://api.openai.com",
        whisperModel: "gpt-4o-transcribe",
      }),
    ).toBe("whisper-small");
  });

  it("offers NVIDIA Nemotron first when no local model is installed", () => {
    expect(
      resolveOnboardingModelId([], {
        whisperEndpoint: "",
        whisperModel: "",
      }),
    ).toBe("nemotron-35-asr-streaming-06b");
  });

  it("activates local STT without removing unrelated settings", () => {
    const model = ONBOARDING_STT_MODELS[0];
    const patch = buildOnboardingLocalSttPatch({
      settings: {
        localModels: {
          existing: { status: "downloaded" },
        },
      },
      model,
      endpoint: "http://127.0.0.1:18220",
    });

    expect(patch).toMatchObject({
      useOwnKey: true,
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: "http://127.0.0.1:18220",
      whisperModel: model.model,
    });
    expect(patch.localModels?.existing).toEqual({ status: "downloaded" });
    expect(patch.localModels?.[model.id]?.status).toBe("downloaded");
  });

  it("formats determinate download progress", () => {
    expect(formatOnboardingDownloadProgress(50_000_000, 200_000_000)).toBe(
      "50 / 200 MB",
    );
    expect(formatOnboardingDownloadProgress(0, null)).toBe("");
  });
});
