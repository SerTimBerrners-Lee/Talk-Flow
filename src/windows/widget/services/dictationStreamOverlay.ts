import type { DictationStreamUpdatePayload } from "../../../lib/hotkeyEvents";
import type { AppSettings } from "../../../lib/store";
import {
  canUseConfiguredRealtimeModel,
  STREAMING_STT_ADAPTERS,
  TALKIS_CLOUD_REALTIME_ENDPOINT,
  TALKIS_CLOUD_REALTIME_TRANSCRIPTION_MODEL,
} from "../../../lib/realtimeModels";
import type {
  WidgetTextOverlayState,
  WidgetTextOverlayStatus,
} from "../widgetConstants";

export interface NativeLiveDictationOptions {
  requestId: string;
  model: string;
  language: string;
  endpoint: string;
  streamingEnabled: boolean;
  provider?: string;
  apiKey?: string;
}

export interface LiveTranscriptionResult {
  requestId: string;
  text: string;
}

const STREAMING_LOCAL_STT_MODELS = new Set([
  "nvidia/nemotron-3.5-asr-streaming-0.6b",
  "nvidia/nemotron-speech-streaming-en-0.6b",
  "moonshine-streaming-tiny",
  "moonshine-streaming-small",
]);

function isLocalSttSettings(settings: AppSettings): boolean {
  return (
    settings.useOwnKey &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "")
  );
}

export function isLocalSttStreamingEnabled(settings: AppSettings): boolean {
  if (!settings.realtimeTranscriptionEnabled) return false;
  if (!isLocalSttSettings(settings)) return false;
  return STREAMING_LOCAL_STT_MODELS.has(settings.whisperModel || "");
}

export function isApiSttStreamingEnabled(settings: AppSettings): boolean {
  if (!settings.realtimeTranscriptionEnabled || !settings.useOwnKey) return false;
  const adapter = STREAMING_STT_ADAPTERS.find(
    (candidate) => candidate.id === settings.selectedApiAdapter,
  );
  if (!adapter) return false;
  return canUseConfiguredRealtimeModel(
    adapter,
    settings.apiAdapters[settings.selectedApiAdapter],
  );
}

export function isCloudSttStreamingEnabled(settings: AppSettings): boolean {
  return (
    settings.realtimeTranscriptionEnabled &&
    !settings.useOwnKey &&
    Boolean(settings.deviceToken?.trim())
  );
}

export function isSttStreamingEnabled(settings: AppSettings): boolean {
  return (
    isCloudSttStreamingEnabled(settings) ||
    isLocalSttStreamingEnabled(settings) ||
    isApiSttStreamingEnabled(settings)
  );
}

export function createNativeLiveDictationOptions(
  settings: AppSettings,
  requestId: string,
): NativeLiveDictationOptions | null {
  if (!isSttStreamingEnabled(settings)) {
    return null;
  }

  if (isCloudSttStreamingEnabled(settings)) {
    return {
      requestId,
      provider: "talkis-cloud",
      apiKey: settings.deviceToken.trim(),
      model: TALKIS_CLOUD_REALTIME_TRANSCRIPTION_MODEL,
      language: settings.language || "auto",
      endpoint: TALKIS_CLOUD_REALTIME_ENDPOINT,
      streamingEnabled: true,
    };
  }

  const isLocal = isLocalSttSettings(settings);
  const adapter = isLocal
    ? null
    : settings.apiAdapters[settings.selectedApiAdapter];

  return {
    requestId,
    model: isLocal ? settings.whisperModel || "" : adapter?.model || "",
    language: settings.language || "auto",
    endpoint: isLocal
      ? settings.whisperEndpoint || ""
      : adapter?.endpoint ||
        STREAMING_STT_ADAPTERS.find(
          (candidate) => candidate.id === settings.selectedApiAdapter,
        )?.defaultEndpoint ||
        "",
    streamingEnabled: true,
    provider: isLocal ? "local" : settings.selectedApiAdapter,
    apiKey: isLocal ? "" : adapter?.apiKey || "",
  };
}

export function createDictationOverlayState({
  requestId,
  status,
  text,
  message,
}: {
  requestId: string;
  status: Extract<WidgetTextOverlayStatus, "dictating" | "inserting" | "done" | "error">;
  text: string;
  message?: string;
}): WidgetTextOverlayState {
  return {
    status,
    sourceText: "",
    translatedText: text,
    targetLanguage: "",
    requestId,
    ...(message ? { message } : {}),
  };
}

export function dictationOverlayStateFromStreamUpdate(
  payload: DictationStreamUpdatePayload,
): WidgetTextOverlayState {
  const status: Extract<WidgetTextOverlayStatus, "dictating" | "done" | "error"> =
    payload.status === "error"
      ? "error"
      : payload.status === "final"
        ? "done"
        : "dictating";

  return createDictationOverlayState({
    requestId: payload.requestId,
    status,
    text: payload.text,
    message: payload.message,
  });
}

export function shouldApplyDictationStreamUpdate(
  activeRequestId: string | null | undefined,
  payload: DictationStreamUpdatePayload,
): boolean {
  return Boolean(activeRequestId) && payload.requestId === activeRequestId;
}
