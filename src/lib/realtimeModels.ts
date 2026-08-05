import type { ApiAdapterSettings } from "./store";

export const TALKIS_CLOUD_REALTIME_ENDPOINT = "https://proxy.talkis.ru";

export type StreamingSttAdapterId =
  | "openai"
  | "deepgram"
  | "mistral"
  | "elevenlabs"
  | "assemblyai"
  | "xai";

export type RealtimeTranslationAdapterId = "openai" | "gemini";

export interface RealtimeModelOption {
  id: string;
  supportsStreaming: true;
}

export interface RealtimeAdapterCatalogEntry {
  id: StreamingSttAdapterId | RealtimeTranslationAdapterId;
  name: string;
  defaultEndpoint: string;
  recommendedModel: string;
  models: RealtimeModelOption[];
}

export const STREAMING_STT_ADAPTERS: RealtimeAdapterCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI API",
    defaultEndpoint: "https://api.openai.com",
    recommendedModel: "gpt-4o-mini-transcribe",
    models: [
      { id: "gpt-4o-mini-transcribe", supportsStreaming: true },
      { id: "gpt-4o-transcribe", supportsStreaming: true },
      // Keep the legacy Talkis alias working for existing saved settings.
      { id: "gpt-realtime-whisper", supportsStreaming: true },
    ],
  },
  {
    id: "deepgram",
    name: "Deepgram API",
    defaultEndpoint: "https://api.deepgram.com",
    recommendedModel: "nova-3",
    models: [
      { id: "nova-3", supportsStreaming: true },
      { id: "nova-2", supportsStreaming: true },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    defaultEndpoint: "https://api.mistral.ai",
    recommendedModel: "voxtral-mini-transcribe-realtime-2602",
    models: [
      { id: "voxtral-mini-transcribe-realtime-2602", supportsStreaming: true },
    ],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs API",
    defaultEndpoint: "https://api.elevenlabs.io",
    recommendedModel: "scribe_v2_realtime",
    models: [{ id: "scribe_v2_realtime", supportsStreaming: true }],
  },
  {
    id: "assemblyai",
    name: "AssemblyAI",
    defaultEndpoint: "https://streaming.assemblyai.com",
    recommendedModel: "u3-rt-pro",
    models: [
      { id: "u3-rt-pro", supportsStreaming: true },
      { id: "whisper-rt", supportsStreaming: true },
    ],
  },
  {
    id: "xai",
    name: "xAI API",
    defaultEndpoint: "https://api.x.ai",
    recommendedModel: "grok-transcribe",
    models: [{ id: "grok-transcribe", supportsStreaming: true }],
  },
];

export const REALTIME_TRANSLATION_ADAPTERS: RealtimeAdapterCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI API",
    defaultEndpoint: "https://api.openai.com",
    recommendedModel: "gpt-realtime",
    models: [
      { id: "gpt-realtime", supportsStreaming: true },
      { id: "gpt-realtime-mini", supportsStreaming: true },
    ],
  },
  {
    id: "gemini",
    name: "Gemini API",
    defaultEndpoint: "https://generativelanguage.googleapis.com",
    recommendedModel: "gemini-3.5-live-translate-preview",
    models: [
      { id: "gemini-3.5-live-translate-preview", supportsStreaming: true },
    ],
  },
];

function normalizedEndpoint(endpoint: string | undefined, fallback: string): string {
  return (endpoint || fallback).trim().replace(/\/+$/, "").toLowerCase();
}

/** A deterministic local comparison token. The API key itself is never returned. */
export function realtimeConfigurationFingerprint({
  provider,
  apiKey,
  model,
  endpoint,
  defaultEndpoint,
}: {
  provider: string;
  apiKey: string;
  model: string;
  endpoint?: string;
  defaultEndpoint: string;
}): string {
  const value = [
    provider.trim().toLowerCase(),
    model.trim(),
    normalizedEndpoint(endpoint, defaultEndpoint),
    apiKey.trim(),
  ].join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `rt-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function hasVerifiedRealtimeCapability(
  adapter: RealtimeAdapterCatalogEntry,
  settings: ApiAdapterSettings | undefined,
): boolean {
  if (!settings?.apiKey.trim() || !settings.model.trim()) return false;
  if (settings.connectionStatus !== "verified") return false;
  if (settings.streamingCapability !== "supported") return false;

  return (
    settings.streamingCapabilityFingerprint ===
    realtimeConfigurationFingerprint({
      provider: adapter.id,
      apiKey: settings.apiKey,
      model: settings.model,
      endpoint: settings.endpoint,
      defaultEndpoint: adapter.defaultEndpoint,
    })
  );
}

/** Realtime is enabled only after the exact key/model/endpoint configuration
 * completed a successful handshake. */
export function canUseConfiguredRealtimeModel(
  adapter: RealtimeAdapterCatalogEntry,
  settings: ApiAdapterSettings | undefined,
): boolean {
  return hasVerifiedRealtimeCapability(adapter, settings);
}

export function batchFallbackModel(provider: string, model: string): string {
  if (provider === "openai" && model.trim() === "gpt-realtime-whisper") {
    return "gpt-4o-transcribe";
  }
  return model;
}
