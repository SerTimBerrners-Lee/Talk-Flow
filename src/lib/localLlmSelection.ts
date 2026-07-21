import type { AppSettings } from "./store";

export interface LocalLlmSelectionSettings {
  llmEndpoint?: string;
  llmModel?: string;
  llmLocalModelId?: string;
}

const BUNDLED_LOCAL_LLM_MODEL_IDS = new Set([
  "qwen3-1.7b-instruct-q4",
  "qwen3-4b-instruct-q4",
  "qwen3-8b-instruct-q4",
  "granite-3.3-2b-instruct-q4",
  "smollm3-3b-q4",
  "phi-4-mini-instruct-q4",
  "gemma-3-4b-it-q4",
  "qwen2.5-3b-instruct-q4",
  "qwen2.5-7b-instruct-q4",
]);

export function isLocalLlmEndpoint(endpoint?: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(endpoint || "");
}

export function isBundledLocalLlmEndpoint(endpoint?: string): boolean {
  const match = (endpoint || "").match(/:(\d{4,5})(?:\/|$)/);
  if (!match) return false;
  const port = Number(match[1]);
  return port === 8011 || (port >= 18200 && port <= 18249);
}

export function isBundledLocalLlmModelId(modelId?: string): boolean {
  return BUNDLED_LOCAL_LLM_MODEL_IDS.has((modelId || "").trim());
}

export function selectedLocalLlmModelId(
  settings: LocalLlmSelectionSettings,
): string {
  if (!isLocalLlmEndpoint(settings.llmEndpoint)) {
    return "";
  }

  const marker = settings.llmLocalModelId?.trim();
  if (marker) {
    return marker;
  }

  const legacyModel = settings.llmModel?.trim() || "";
  if (
    isBundledLocalLlmEndpoint(settings.llmEndpoint) &&
    isBundledLocalLlmModelId(legacyModel)
  ) {
    return legacyModel;
  }

  return "";
}

export function isSelectedLocalLlmModel(
  settings: LocalLlmSelectionSettings,
  modelId: string,
): boolean {
  return selectedLocalLlmModelId(settings) === modelId;
}

export function localLlmDeselectionSettingsPatch(): Partial<AppSettings> {
  return { llmEndpoint: "", llmModel: "none", llmLocalModelId: "" };
}

export function localLlmDeleteSettingsPatch(
  settings: LocalLlmSelectionSettings,
  modelId: string,
): Partial<AppSettings> | null {
  if (!isSelectedLocalLlmModel(settings, modelId)) {
    return null;
  }

  return localLlmDeselectionSettingsPatch();
}

export function customLocalLlmEndpointSettingsPatch({
  endpoint,
  model,
  apiKey,
}: {
  endpoint: string;
  model: string;
  apiKey: string;
}): Partial<AppSettings> {
  return {
    llmEndpoint: endpoint.trim(),
    llmModel: model.trim() || "none",
    llmApiKey: apiKey.trim(),
    llmLocalModelId: "",
  };
}
