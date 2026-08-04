import type { AppSettings } from "../../../lib/store";

import { isCloudSttStreamingEnabled } from "./dictationStreamOverlay";

export type LiveTranscriptionReconciliationMode = "talkis-cloud" | "openai";

export function resolveLiveTranscriptionReconciliationMode(
  settings: AppSettings,
  hasLiveTranscription: boolean,
): LiveTranscriptionReconciliationMode | null {
  if (!hasLiveTranscription) return null;

  if (isCloudSttStreamingEnabled(settings)) {
    return "talkis-cloud";
  }

  if (!settings.useOwnKey || settings.selectedApiAdapter !== "openai") {
    return null;
  }

  const configuredModel =
    settings.apiAdapters.openai?.model?.trim() || settings.whisperModel?.trim();
  return configuredModel === "gpt-realtime-whisper" ? "openai" : null;
}
