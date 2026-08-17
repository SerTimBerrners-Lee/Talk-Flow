import type { AppSettings } from "./store";

export const TALKIS_CLOUD_STT_MODEL = "gpt-4o-transcribe";
export const DEFAULT_LOCAL_STT_ENDPOINT = "http://127.0.0.1:8000";
export const DEFAULT_LOCAL_STT_MODEL = "whisper-large-v3-turbo";

type ModelModeSettingsPatch = Partial<Omit<AppSettings, "translation">>;

interface ApiModelModeSelection {
  adapterId: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

interface LocalModelModeSelection {
  endpoint?: string;
  model?: string;
}

export function talkisCloudModeSettingsPatch(
  extra: ModelModeSettingsPatch = {},
): ModelModeSettingsPatch {
  return {
    ...extra,
    useOwnKey: false,
    provider: "openai",
    whisperApiKey: "",
    whisperEndpoint: "",
    whisperModel: TALKIS_CLOUD_STT_MODEL,
  };
}

export function apiModelModeSettingsPatch(
  selection: ApiModelModeSelection,
  extra: ModelModeSettingsPatch = {},
): ModelModeSettingsPatch {
  return {
    ...extra,
    useOwnKey: true,
    provider: "openai",
    selectedApiAdapter: selection.adapterId,
    apiKey: selection.apiKey?.trim() || "",
    whisperApiKey: "",
    whisperEndpoint: selection.endpoint?.trim() || "",
    whisperModel: selection.model?.trim() || "whisper-1",
  };
}

export function localModelModeSettingsPatch(
  selection: LocalModelModeSelection = {},
  extra: ModelModeSettingsPatch = {},
): ModelModeSettingsPatch {
  return {
    ...extra,
    useOwnKey: true,
    provider: "custom",
    whisperApiKey: "",
    whisperEndpoint:
      selection.endpoint?.trim() || DEFAULT_LOCAL_STT_ENDPOINT,
    whisperModel: selection.model?.trim() || DEFAULT_LOCAL_STT_MODEL,
  };
}
