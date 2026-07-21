import {
  DEFAULT_ONBOARDING_STT_MODEL_ID,
  ONBOARDING_STT_MODELS,
  type OnboardingSttModel,
} from "../config/onboardingSttModels";
import type { AppSettings, AppSettingsPatch } from "./store";

export const ONBOARDING_LOCAL_STT_ENDPOINT = "http://127.0.0.1:8000";

export function normalizeOnboardingTestPhrase(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([,.;!?])\s*/g, "$1 ")
    .trim();
}

export function matchesOnboardingTestPhrase(
  recognized: string,
  expected: string,
): boolean {
  return (
    Boolean(recognized.trim()) &&
    normalizeOnboardingTestPhrase(recognized) ===
      normalizeOnboardingTestPhrase(expected)
  );
}

export function resolveOnboardingModelId(
  installedModels: string[],
  settings: Pick<AppSettings, "whisperEndpoint" | "whisperModel">,
): string {
  const localEndpoint = /127\.0\.0\.1|localhost/i.test(
    settings.whisperEndpoint || "",
  );
  const activeModel = ONBOARDING_STT_MODELS.find(
    (model) => model.model === settings.whisperModel,
  );
  if (localEndpoint && activeModel) {
    return activeModel.id;
  }

  const installed = ONBOARDING_STT_MODELS.find((model) =>
    installedModels.includes(model.model),
  );
  return installed?.id || DEFAULT_ONBOARDING_STT_MODEL_ID;
}

export function buildOnboardingLocalSttPatch({
  settings,
  model,
  endpoint,
}: {
  settings: Pick<AppSettings, "localModels">;
  model: OnboardingSttModel;
  endpoint?: string | null;
}): AppSettingsPatch {
  const now = new Date().toISOString();
  return {
    useOwnKey: true,
    provider: "custom",
    whisperApiKey: "",
    whisperEndpoint: endpoint?.trim() || ONBOARDING_LOCAL_STT_ENDPOINT,
    whisperModel: model.model,
    localModels: {
      ...settings.localModels,
      [model.id]: {
        status: "downloaded",
        downloadedAt: settings.localModels[model.id]?.downloadedAt || now,
        lastCheckedAt: now,
      },
    },
  };
}

export function formatOnboardingDownloadProgress(
  downloadedBytes?: number,
  totalBytes?: number | null,
): string {
  if (!downloadedBytes || !totalBytes || totalBytes <= 0) return "";
  const downloadedMb = Math.round(downloadedBytes / 1_000_000);
  const totalMb = Math.round(totalBytes / 1_000_000);
  return `${downloadedMb} / ${totalMb} MB`;
}
