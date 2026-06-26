import type { AppSettings } from "./store";

export interface LocalLlmSelectionSettings {
  llmEndpoint?: string;
  llmModel?: string;
  llmLocalModelId?: string;
}

export function isLocalLlmEndpoint(endpoint?: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(endpoint || "");
}

export function selectedLocalLlmModelId(
  settings: LocalLlmSelectionSettings,
): string {
  if (!isLocalLlmEndpoint(settings.llmEndpoint)) {
    return "";
  }

  return settings.llmLocalModelId?.trim() || settings.llmModel?.trim() || "";
}

export function isSelectedLocalLlmModel(
  settings: LocalLlmSelectionSettings,
  modelId: string,
): boolean {
  return selectedLocalLlmModelId(settings) === modelId;
}

export function localLlmDeleteSettingsPatch(
  settings: LocalLlmSelectionSettings,
  modelId: string,
): Partial<AppSettings> | null {
  if (!isSelectedLocalLlmModel(settings, modelId)) {
    return null;
  }

  return { llmEndpoint: "", llmModel: "none", llmLocalModelId: "" };
}
