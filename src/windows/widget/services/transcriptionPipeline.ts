import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import { AppSettings, deleteHistoryEntry, HistoryEntry } from "../../../lib/store";
import { logError, logInfo } from "../../../lib/logger";
import { tn } from "../../../lib/i18n";
import { formatErrorMessage } from "../../../lib/utils";
import { HISTORY_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { beginProcessing, finishProcessing, isAbortError } from "../../../lib/processingControl";

export interface ProcessRecordingBlobParams {
  blob: Blob;
  settings: AppSettings;
  recordingStartTimestamp: number;
}

export interface ProcessRecordingBlobResult {
  durationSeconds: number;
  hasTranscription: boolean;
}

export interface RetryHistoryEntryResult {
  hasTranscription: boolean;
  updatedEntry: HistoryEntry;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function isLocalSttSettings(settings: AppSettings): boolean {
  return (
    settings.useOwnKey &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "")
  );
}

function isAuthFailureLike(normalized: string): boolean {
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("api-ключ") ||
    normalized.includes("ключ доступа") ||
    (normalized.includes("авторизоваться") && normalized.includes("api"))
  );
}

function toUserFacingErrorMessage(error: unknown, settings: AppSettings): string {
  const raw = formatErrorMessage(error);
  const normalized = raw.toLowerCase();
  const isLocalStt = isLocalSttSettings(settings);

  const missingModelMatch = raw.match(/Model ['"]([^'"]+)['"] is not installed locally/i);
  if (missingModelMatch) {
    const model = missingModelMatch[1];
    return tn("widget.error.modelNotDownloaded", { model });
  }

  if (
    normalized.includes("connection refused") ||
    normalized.includes("tcp connect error") ||
    normalized.includes("error trying to connect") ||
    normalized.includes("failed to connect") ||
    normalized.includes("os error 61") ||
    normalized.includes("os error 111")
  ) {
    return tn("widget.error.localRuntimeStartFailed");
  }

  if (normalized.includes("unsupported_country_region_territory") || normalized.includes("country, region, or territory not supported")) {
    return tn("widget.error.regionUnsupported");
  }

  if (normalized.includes("403") || normalized.includes("forbidden")) {
    if (isLocalStt) {
      return tn("widget.error.localRuntimeRejected");
    }

    if (normalized.includes("subscription inactive") || normalized.includes("активная подписка") || normalized.includes("cloud mode")) {
      return tn("widget.error.subscriptionRequired");
    }

    return tn("widget.error.requestRejected");
  }

  if (normalized.includes("invalid or expired token") || normalized.includes("token expired") || normalized.includes("token missing user id")) {
    return tn("widget.error.cloudSessionExpired");
  }

  if (normalized.includes("talkis cloud session missing")) {
    return tn("widget.error.cloudSignInRequired");
  }

  if (normalized.includes("talkis cloud returned an invalid response")) {
    return tn("widget.error.cloudInvalidResponse");
  }

  if (normalized.includes("subscription check failed") || normalized.includes("cloud auth unavailable")) {
    return tn("widget.error.cloudUnavailable");
  }

  if (isAuthFailureLike(normalized)) {
    if (isLocalStt) {
      return tn("widget.error.localRuntimeRejected");
    }

    return tn("widget.error.authFailed");
  }

  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return tn("widget.error.rateLimited");
  }

  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("failed to fetch") || normalized.includes("timed out")) {
    return tn("widget.error.networkFailed");
  }

  if (normalized.includes("500") || normalized.includes("502") || normalized.includes("503") || normalized.includes("504") || normalized.includes("server")) {
    return tn("widget.error.serverUnavailable");
  }

  return tn("widget.error.processingFailed");
}

function normalizeTranscriptForPlaceholderCheck(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?…\s]+$/g, "")
    .replace(/\s+/g, " ");
}

function hasRecognizedSpeech(result: { raw: string; cleaned: string }): boolean {
  const raw = result.raw.trim();
  const cleaned = result.cleaned.trim();
  const normalizedRaw = normalizeTranscriptForPlaceholderCheck(raw);
  const normalizedCleaned = normalizeTranscriptForPlaceholderCheck(cleaned);
  const placeholderPhrases = new Set([
    "продолжение следует",
    "продолжение следует...",
    "to be continued",
  ]);

  if (!raw && !cleaned) {
    return false;
  }

  if (placeholderPhrases.has(normalizedRaw) && (!cleaned || placeholderPhrases.has(normalizedCleaned))) {
    return false;
  }

  if (!raw && placeholderPhrases.has(normalizedCleaned)) {
    return false;
  }

  return true;
}

const PROXY_BASE_URL = "https://proxy.talkis.ru";

async function transcribeViaProxy({
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
  signal,
}: {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
  signal?: AbortSignal;
}): Promise<{ raw: string; cleaned: string }> {
  logInfo("API", `Sending to proxy, audio_size: ${audioBase64.length} chars`);

  // Decode base64 → binary → Blob
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: audioMimeType });

  const form = new FormData();
  form.append("file", blob, audioFileName);
  form.append("language", settings.language || "ru");
  form.append("style", settings.style || "classic");

  const resp = await fetch(`${PROXY_BASE_URL}/api/transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.deviceToken}`,
    },
    body: form,
    signal,
  });

  const body = await resp.text();

  if (!resp.ok) {
    logError("API", `Proxy error (${resp.status}): ${body}`);
    throw new Error(`Proxy error (${resp.status}): ${body}`);
  }

  try {
    const parsed = JSON.parse(body) as { raw?: string; cleaned?: string };
    const result = {
      raw: typeof parsed.raw === "string" ? parsed.raw : "",
      cleaned: typeof parsed.cleaned === "string" ? parsed.cleaned : "",
    };

    logInfo("API", `Proxy response parsed: raw_type=${typeof parsed.raw}, cleaned_type=${typeof parsed.cleaned}, cleaned_len=${result.cleaned.length}`);
    return result;
  } catch (error) {
    logError("API", `Proxy success response parse failed: ${formatErrorMessage(error)}; body=${body}`);
    throw new Error("Talkis Cloud returned an invalid response");
  }
}

async function transcribeViaBackend({
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
}: {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
}): Promise<{ raw: string; cleaned: string }> {
  logInfo("API", `Sending to backend, audio_size: ${audioBase64.length} chars`);

  const result = await invoke<{ raw: string; cleaned: string }>("transcribe_and_clean", {
    req: {
      audio_base64: audioBase64,
      language: settings.language,
      api_key: settings.apiKey,
      whisper_api_key: settings.whisperApiKey || null,
      llm_api_key: null,
      style: settings.style || "classic",
      whisper_endpoint: settings.whisperEndpoint || null,
      local_models_dir: settings.localModelsDir || null,
      llm_endpoint: null,
      whisper_model: settings.whisperModel || null,
      llm_model: "none",
      file_name: audioFileName,
      mime_type: audioMimeType,
    },
  });

  return result;
}

async function transcribeAudio({
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
  signal,
}: {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
  signal?: AbortSignal;
}): Promise<{ raw: string; cleaned: string }> {
  // Subscription mode: send to proxy
  if (!settings.useOwnKey && settings.deviceToken?.trim()) {
    return transcribeViaProxy({ audioBase64, audioMimeType, audioFileName, settings, signal });
  }

  if (!settings.useOwnKey) {
    throw new Error("Talkis Cloud session missing");
  }

  // Own key mode: send to Rust backend
  return transcribeViaBackend({ audioBase64, audioMimeType, audioFileName, settings });
}

async function pasteCleanedText(text: string): Promise<void> {
  logInfo("PASTE", "Sending cleaned text to paste_text");
  await invoke("paste_text", { text });
  logInfo("PASTE", "paste_text command finished; target app insertion cannot be confirmed reliably");
}

export async function processRecordingBlob({
  blob,
  settings,
  recordingStartTimestamp,
}: ProcessRecordingBlobParams): Promise<ProcessRecordingBlobResult> {
  const buffer = await blob.arrayBuffer();
  const base64Audio = arrayBufferToBase64(buffer);
  const durationSeconds = Math.floor((Date.now() - recordingStartTimestamp) / 1000);
  const audioMimeType = blob.type || "audio/webm";
  const audioFileName = audioMimeType.includes("wav") ? "recording.wav" : "recording.webm";

  // Persist a "processing" entry up front so the recording shows as a live row
  // in the history table (with a stop button) and keeps its audio for re-runs.
  const baseEntry: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    duration: durationSeconds,
    raw: "",
    cleaned: "",
    source: "voice",
    status: "processing",
    audioBase64: base64Audio,
    audioMimeType,
    audioFileName,
    language: settings.language,
    style: settings.style || "classic",
  };

  const handle = await beginProcessing(baseEntry, "add");

  try {
    const apiStart = Date.now();
    const result = await transcribeAudio({
      audioBase64: base64Audio,
      audioMimeType,
      audioFileName,
      settings,
      signal: handle.signal,
    });

    if (handle.isCancelled()) {
      await finishProcessing(buildInterruptedEntry(baseEntry));
      return { durationSeconds, hasTranscription: false };
    }

    logInfo("API", `Pipeline result received: raw_type=${typeof result.raw}, cleaned_type=${typeof result.cleaned}`);
    const processingTime = Date.now() - apiStart;

    if (!hasRecognizedSpeech(result)) {
      logInfo("API", "Nothing recognized, removing placeholder entry, skipping paste");
      await deleteHistoryEntry(baseEntry.id);
      await emit(HISTORY_UPDATED_EVENT, baseEntry);
      return { durationSeconds, hasTranscription: false };
    }

    logInfo("API", `Transcription complete in ${processingTime}ms: "${result.cleaned}"`);
    await finishProcessing({
      ...baseEntry,
      raw: result.raw,
      cleaned: result.cleaned,
      status: "completed",
      errorMessage: undefined,
      processingTime,
      audioBase64: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    });

    let pasteFailed = false;
    try {
      await pasteCleanedText(result.cleaned);
    } catch (pasteError) {
      pasteFailed = true;
      logError("PASTE", `Paste failed after successful transcription: ${formatErrorMessage(pasteError)}`);
    }

    logInfo("PASTE", pasteFailed
      ? "Automatic paste command failed; latest text remains copyable from the idle widget"
      : "Automatic paste command completed without OS-level errors");
    return { durationSeconds, hasTranscription: true };
  } catch (error) {
    if (handle.isCancelled() || isAbortError(error)) {
      logInfo("API", "Processing cancelled by user; marking entry interrupted");
      await finishProcessing(buildInterruptedEntry(baseEntry));
      return { durationSeconds, hasTranscription: false };
    }

    const rawErrorMessage = error instanceof Error
      ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
      : String(error);
    logError("API", `Pipeline raw error: ${rawErrorMessage}`);

    const userFacingErrorMessage = toUserFacingErrorMessage(error, settings);
    await finishProcessing({
      ...baseEntry,
      status: "failed",
      errorMessage: userFacingErrorMessage,
    });
    throw new Error(userFacingErrorMessage);
  } finally {
    handle.finish();
  }
}

function buildInterruptedEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    status: "interrupted",
    errorMessage: tn("widget.processing.interrupted"),
  };
}

export async function retryHistoryEntry(
  entry: HistoryEntry,
  settings: AppSettings,
  options?: { shouldPaste?: boolean },
): Promise<RetryHistoryEntryResult> {
  if (!entry.audioBase64) {
    throw new Error(tn("widget.error.noSavedAudio"));
  }

  const retrySettings: AppSettings = {
    ...settings,
    language: entry.language || settings.language,
    style: entry.style || settings.style,
  };
  const shouldPaste = options?.shouldPaste ?? false;

  // Re-runs go through the same lifecycle: shown as "processing" again and
  // cancellable from the table.
  const handle = await beginProcessing(entry, "update");

  try {
    const result = await transcribeAudio({
      audioBase64: entry.audioBase64,
      audioMimeType: entry.audioMimeType || "audio/webm",
      audioFileName: entry.audioFileName || "recording.webm",
      settings: retrySettings,
      signal: handle.signal,
    });

    if (handle.isCancelled()) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    if (!hasRecognizedSpeech(result)) {
      throw new Error(tn("widget.error.speechNotRecognized"));
    }

    const updatedEntry: HistoryEntry = {
      ...entry,
      raw: result.raw,
      cleaned: result.cleaned,
      status: "completed",
      errorMessage: undefined,
      audioBase64: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    };

    await finishProcessing(updatedEntry);

    if (shouldPaste) {
      try {
        await pasteCleanedText(result.cleaned);
      } catch (pasteError) {
        logError("PASTE", `Retry paste failed: ${formatErrorMessage(pasteError)}`);
      }
    }

    return {
      hasTranscription: true,
      updatedEntry,
    };
  } catch (error) {
    if (handle.isCancelled() || isAbortError(error)) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    const userFacingErrorMessage = toUserFacingErrorMessage(error, retrySettings);
    const failedEntry: HistoryEntry = {
      ...entry,
      status: "failed",
      errorMessage: userFacingErrorMessage,
    };

    await finishProcessing(failedEntry);
    throw new Error(userFacingErrorMessage);
  } finally {
    handle.finish();
  }
}
