import type {
  AppSettings,
  HistoryEntry,
  LiveTranslationChannel,
  LiveTranslationSegment,
} from "../../../lib/store";
import {
  hasVerifiedRealtimeCapability,
  REALTIME_TRANSLATION_ADAPTERS,
  TALKIS_CLOUD_REALTIME_ENDPOINT,
} from "../../../lib/realtimeModels";

export interface LiveTranslationConnectionConfig {
  provider: "talkis-cloud" | "openai" | "gemini";
  apiKey: string;
  model: string;
  endpoint: string;
  adapterId: string;
  supportsVoice: boolean;
}

export function isLocalModelMode(settings: AppSettings): boolean {
  return settings.useOwnKey && /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "");
}

export function resolveLiveTranslationConnection(
  settings: AppSettings,
): LiveTranslationConnectionConfig {
  if (!settings.useOwnKey) {
    const deviceToken = settings.deviceToken.trim();
    if (!deviceToken) {
      throw new Error("Войдите в Talkis и выберите активную облачную подписку.");
    }
    return {
      provider: "talkis-cloud",
      apiKey: deviceToken,
      model: "gpt-realtime",
      endpoint: TALKIS_CLOUD_REALTIME_ENDPOINT,
      adapterId: "talkis-cloud",
      supportsVoice: true,
    };
  }

  if (isLocalModelMode(settings)) {
    throw new Error(
      "Синхронный перевод недоступен для локальных моделей. Выберите «Облако» или «API».",
    );
  }

  const catalogAdapter = REALTIME_TRANSLATION_ADAPTERS.find(
    (adapter) => adapter.id === settings.selectedTranslationAdapter,
  );
  const adapter = settings.translationAdapters[settings.selectedTranslationAdapter];
  if (!catalogAdapter || !hasVerifiedRealtimeCapability(catalogAdapter, adapter)) {
    throw new Error("Проверьте realtime-подключение в «Модели → API → Перевод».");
  }

  return {
    provider: catalogAdapter.id as "openai" | "gemini",
    apiKey: adapter.apiKey,
    model: adapter.model,
    endpoint: adapter.endpoint || catalogAdapter.defaultEndpoint,
    adapterId: catalogAdapter.id,
    supportsVoice: catalogAdapter.id === "openai",
  };
}

export interface LiveTranslationEventPayload {
  sessionId: string;
  channel: LiveTranslationChannel;
  status: "started" | "partial" | "final" | "error";
  original: string;
  translated: string;
  startedAtMs: number;
  message?: string;
}

export interface LiveTranslationOverlayState {
  sessionId: string;
  finals: LiveTranslationSegment[];
  partials: Partial<Record<LiveTranslationChannel, LiveTranslationSegment>>;
  error?: string;
}

function mergeText(previous: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return previous;
  if (!previous || next.startsWith(previous)) return next;
  return `${previous}${/\s$/.test(previous) || /^[\s.,!?;:]/.test(incoming) ? "" : " "}${incoming}`.trim();
}

function mergeConsecutiveSegments(
  previous: LiveTranslationSegment,
  incoming: LiveTranslationSegment,
): LiveTranslationSegment {
  const translated = mergeText(previous.translated, incoming.translated);
  const stableTranslatedLength = incoming.state === "partial"
    ? previous.state === "final"
      ? previous.translated.length
      : previous.stableTranslatedLength || 0
    : undefined;
  return {
    ...previous,
    original: mergeText(previous.original, incoming.original),
    translated,
    state: incoming.state,
    stableTranslatedLength,
    ...(incoming.endedAtMs ? { endedAtMs: incoming.endedAtMs } : {}),
  };
}

function coalesceConsecutiveSegments(
  segments: LiveTranslationSegment[],
): LiveTranslationSegment[] {
  return segments.reduce<LiveTranslationSegment[]>((result, segment) => {
    const previous = result[result.length - 1];
    if (previous?.channel === segment.channel) {
      result[result.length - 1] = mergeConsecutiveSegments(previous, segment);
    } else {
      result.push(segment);
    }
    return result;
  }, []);
}

export function createLiveTranslationOverlayState(
  sessionId: string,
): LiveTranslationOverlayState {
  return { sessionId, finals: [], partials: {} };
}

export function applyLiveTranslationEvent(
  state: LiveTranslationOverlayState,
  event: LiveTranslationEventPayload,
): LiveTranslationOverlayState {
  if (event.sessionId !== state.sessionId) return state;
  if (event.status === "started") return state;
  if (event.status === "error") return { ...state, error: event.message || "Live translation error" };

  const previous = state.partials[event.channel];
  const segment: LiveTranslationSegment = {
    sessionId: state.sessionId,
    channel: event.channel,
    startedAtMs: previous?.startedAtMs || event.startedAtMs,
    original: mergeText(previous?.original || "", event.original),
    translated: mergeText(previous?.translated || "", event.translated),
    state: event.status === "final" ? "final" : "partial",
    ...(event.status === "partial" ? { stableTranslatedLength: 0 } : {}),
    ...(event.status === "final" ? { endedAtMs: Date.now() } : {}),
  };

  if (event.status === "partial") {
    return {
      ...state,
      partials: { ...state.partials, [event.channel]: segment },
      error: undefined,
    };
  }

  const finalSegment = {
    ...(previous || segment),
    ...segment,
    original: event.original.trim() || previous?.original || segment.original,
    translated: event.translated.trim() || previous?.translated || segment.translated,
    state: "final" as const,
    stableTranslatedLength: undefined,
    endedAtMs: Date.now(),
  };
  const partials = { ...state.partials };
  delete partials[event.channel];
  const lastFinal = state.finals[state.finals.length - 1];
  const finals = lastFinal?.channel === finalSegment.channel
    ? [
        ...state.finals.slice(0, -1),
        mergeConsecutiveSegments(lastFinal, finalSegment),
      ]
    : [...state.finals, finalSegment].slice(-8);
  return {
    ...state,
    finals,
    partials,
    error: undefined,
  };
}

export function liveTranslationVisibleSegments(
  state: LiveTranslationOverlayState,
): LiveTranslationSegment[] {
  return coalesceConsecutiveSegments([
    ...state.finals,
    ...(["mic", "system"] as const)
      .map((channel) => state.partials[channel])
      .filter((segment): segment is LiveTranslationSegment => Boolean(segment)),
  ]);
}

export function buildLiveTranslationHistoryEntry({
  state,
  adapterId,
  targetLanguage,
  startedAt,
  callTracks,
}: {
  state: LiveTranslationOverlayState;
  adapterId: string;
  targetLanguage: string;
  startedAt: number;
  callTracks?: HistoryEntry["callTracks"];
}): HistoryEntry {
  const partials = (["mic", "system"] as const)
    .map((channel) => state.partials[channel])
    .filter((segment): segment is LiveTranslationSegment => Boolean(segment))
    .map((segment) => ({
      ...segment,
      state: "final" as const,
      stableTranslatedLength: undefined,
      endedAtMs: Date.now(),
    }));
  const segments = coalesceConsecutiveSegments(
    [...state.finals, ...partials].sort(
      (left, right) => left.startedAtMs - right.startedAtMs,
    ),
  ).slice(-8);
  const label = (channel: LiveTranslationChannel): string =>
    channel === "mic" ? "Вы" : "Системный звук";
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(startedAt).toISOString(),
    duration: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    raw: segments.map((segment) => `${label(segment.channel)}: ${segment.original}`).join("\n"),
    cleaned: segments.map((segment) => `${label(segment.channel)}: ${segment.translated}`).join("\n"),
    source: "liveTranslation",
    status: state.error ? "failed" : "completed",
    errorMessage: state.error,
    callTracks,
    liveTranslation: { targetLanguage, adapterId, segments },
  };
}
