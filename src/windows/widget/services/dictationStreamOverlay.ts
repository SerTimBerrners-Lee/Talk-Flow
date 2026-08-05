import { invoke } from "@tauri-apps/api/core";

import type { DictationStreamUpdatePayload } from "../../../lib/hotkeyEvents";
import { logInfo } from "../../../lib/logger";
import type { AppSettings } from "../../../lib/store";
import {
  canUseConfiguredRealtimeModel,
  STREAMING_STT_ADAPTERS,
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

const LOCAL_STREAMING_STT_MODELS = [
  {
    catalogIds: [
      "nemotron-35-asr-streaming-06b",
      "nvidia/nemotron-3.5-asr-streaming-0.6b",
    ],
    model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
  },
  {
    catalogIds: [
      "nemotron-speech-streaming-en-06b",
      "nvidia/nemotron-speech-streaming-en-0.6b",
    ],
    model: "nvidia/nemotron-speech-streaming-en-0.6b",
  },
  {
    catalogIds: ["moonshine-streaming-small"],
    model: "moonshine-streaming-small",
  },
  {
    catalogIds: ["moonshine-streaming-tiny"],
    model: "moonshine-streaming-tiny",
  },
] as const;
const STREAMING_LOCAL_STT_MODELS = new Set<string>(
  LOCAL_STREAMING_STT_MODELS.map((candidate) => candidate.model),
);

function isLocalSttSettings(settings: AppSettings): boolean {
  return (
    settings.useOwnKey &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "")
  );
}

function isManagedLocalSttEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      return false;
    }

    const port = Number(url.port || "80");
    return (
      port === 8000 ||
      port === 8001 ||
      port === 8002 ||
      (port >= 18000 && port <= 18149)
    );
  } catch {
    return false;
  }
}

export function resolveLiveDictationRuntimeEndpoint(
  configuredEndpoint: string,
  runtimeEndpoint?: string | null,
): string | null {
  return runtimeEndpoint?.trim() || configuredEndpoint.trim() || null;
}

export async function warmUpLiveDictationRuntime(
  settings: AppSettings,
  requiredModel?: string,
): Promise<string | null> {
  if (!isManagedLocalSttEndpoint(settings.whisperEndpoint || "")) {
    return null;
  }

  const result = await invoke<{
    success: boolean;
    models: string[];
    message: string;
    whisper_endpoint?: string | null;
  }>("list_stt_models", {
    req: {
      api_key: settings.apiKey,
      whisper_api_key: settings.whisperApiKey || null,
      whisper_endpoint: settings.whisperEndpoint || null,
      local_models_dir: settings.localModelsDir || null,
    },
  });

  logInfo(
    "DICTATION_STREAM",
    `Local STT runtime warm-up: success=${result.success}, models=${result.models.length}, endpoint=${result.whisper_endpoint || settings.whisperEndpoint}, message=${result.message}`,
  );
  if (!result.success) {
    throw new Error(result.message || "Local STT runtime is unavailable");
  }
  if (
    requiredModel &&
    !result.models.some(
      (model) => model.trim().toLowerCase() === requiredModel.toLowerCase(),
    )
  ) {
    throw new Error(`Local streaming model is unavailable: ${requiredModel}`);
  }

  return resolveLiveDictationRuntimeEndpoint(
    settings.whisperEndpoint || "",
    result.whisper_endpoint,
  );
}

export function resolveLocalCallStreamingModel(
  settings: AppSettings,
): string | null {
  const selectedModel = (settings.whisperModel || "").trim();
  if (STREAMING_LOCAL_STT_MODELS.has(selectedModel)) {
    return selectedModel;
  }

  const installed = settings.localModels || {};
  return (
    LOCAL_STREAMING_STT_MODELS.find((candidate) =>
      candidate.catalogIds.some((id) => installed[id]?.status === "downloaded"),
    )?.model || null
  );
}

export function isLocalSttStreamingEnabled(settings: AppSettings): boolean {
  if (!settings.realtimeTranscriptionEnabled) return false;
  if (!isLocalSttSettings(settings)) return false;
  return STREAMING_LOCAL_STT_MODELS.has(settings.whisperModel || "");
}

export function createCallLiveDictationOptions(
  settings: AppSettings,
  requestId: string,
): NativeLiveDictationOptions | null {
  if (settings.realtimeTranscriptionEnabled && isLocalSttSettings(settings)) {
    const model = resolveLocalCallStreamingModel(settings);
    if (!model) {
      return null;
    }
    return {
      requestId,
      model,
      language: settings.language || "auto",
      endpoint: settings.whisperEndpoint || "",
      streamingEnabled: true,
      provider: "local",
      apiKey: "",
    };
  }

  return createNativeLiveDictationOptions(settings, requestId);
}

export function isApiSttStreamingEnabled(settings: AppSettings): boolean {
  if (!settings.realtimeTranscriptionEnabled || !settings.useOwnKey)
    return false;
  if (isLocalSttSettings(settings)) return false;
  const adapter = STREAMING_STT_ADAPTERS.find(
    (candidate) => candidate.id === settings.selectedApiAdapter,
  );
  if (!adapter) return false;
  return canUseConfiguredRealtimeModel(
    adapter,
    settings.apiAdapters[settings.selectedApiAdapter],
  );
}

export function isCloudSttStreamingEnabled(_settings: AppSettings): boolean {
  // Talkis Cloud dictation is deliberately batch-only. Its full-audio result is
  // more accurate than the realtime draft and is the only text shown/pasted.
  return false;
}

export function isSttStreamingEnabled(settings: AppSettings): boolean {
  return (
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
  status: Extract<
    WidgetTextOverlayStatus,
    "dictating" | "inserting" | "done" | "error"
  >;
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
  const status: Extract<
    WidgetTextOverlayStatus,
    "dictating" | "done" | "error"
  > =
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
