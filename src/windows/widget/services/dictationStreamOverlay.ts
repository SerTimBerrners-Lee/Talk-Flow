import type { DictationStreamUpdatePayload } from "../../../lib/hotkeyEvents";
import type { AppSettings } from "../../../lib/store";
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
}

export interface LiveTranscriptionResult {
  requestId: string;
  text: string;
}

const STREAMING_LOCAL_STT_MODEL_IDS: Record<string, string> = {
  "nvidia/nemotron-3.5-asr-streaming-0.6b": "nemotron-35-asr-streaming-06b",
  "nvidia/nemotron-speech-streaming-en-0.6b": "nemotron-speech-streaming-en-06b",
  "moonshine-streaming-tiny": "moonshine-streaming-tiny",
  "moonshine-streaming-small": "moonshine-streaming-small",
};

function isLocalSttSettings(settings: AppSettings): boolean {
  return (
    settings.useOwnKey &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "")
  );
}

export function isLocalSttStreamingEnabled(settings: AppSettings): boolean {
  if (!isLocalSttSettings(settings)) return false;
  const modelId = STREAMING_LOCAL_STT_MODEL_IDS[settings.whisperModel || ""];
  if (!modelId) return false;
  const cachedValue = settings.localModels?.[modelId]?.streamingEnabled;
  return typeof cachedValue === "boolean" ? cachedValue : true;
}

export function createNativeLiveDictationOptions(
  settings: AppSettings,
  requestId: string,
): NativeLiveDictationOptions | null {
  if (!isLocalSttStreamingEnabled(settings)) {
    return null;
  }

  return {
    requestId,
    model: settings.whisperModel || "",
    language: settings.language || "auto",
    endpoint: settings.whisperEndpoint || "",
    streamingEnabled: true,
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
