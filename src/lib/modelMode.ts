import type { AppSettings } from "./store";

export const TALKIS_CLOUD_STT_MODEL = "gpt-4o-transcribe";

type TalkisCloudModeSettingsPatch = Partial<Omit<AppSettings, "translation">>;

export function talkisCloudModeSettingsPatch(
  extra: TalkisCloudModeSettingsPatch = {},
): TalkisCloudModeSettingsPatch {
  return {
    ...extra,
    useOwnKey: false,
    provider: "openai",
    whisperApiKey: "",
    whisperEndpoint: "",
    whisperModel: TALKIS_CLOUD_STT_MODEL,
  };
}
