import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import {
  AppSettings,
  deleteHistoryEntry,
  deleteHistoryAudio,
  HistoryEntry,
  readHistoryAudio,
  saveHistoryAudio,
} from "../../../lib/store";
import { logError, logInfo } from "../../../lib/logger";
import { tn } from "../../../lib/i18n";
import { formatErrorMessage } from "../../../lib/utils";
import { HISTORY_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { beginProcessing, finishProcessing, isAbortError } from "../../../lib/processingControl";
import { resolveSummaryBackend } from "../../../lib/summarize";
import { LANGUAGES } from "../../../config/languages";

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

interface RecordingAudioSource {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
}

type TranscriptionResult = Pick<HistoryEntry, "raw" | "cleaned" | "dictationTranslation">;

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

async function saveCompletedRecordingAudio({
  entryId,
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
}: RecordingAudioSource & {
  entryId: string;
  settings: AppSettings;
}): Promise<Pick<HistoryEntry, "audioPath" | "audioMimeType" | "audioFileName">> {
  if (!settings.saveRecordingAudio) {
    return {
      audioPath: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    };
  }

  try {
    const saved = await saveHistoryAudio({
      storageDir: settings.transcriptionStorageDir,
      entryId,
      audioBase64,
      mimeType: audioMimeType,
    });

    return {
      audioPath: saved.path,
      audioMimeType: saved.mimeType || audioMimeType,
      audioFileName: saved.fileName || audioFileName,
    };
  } catch (error) {
    logError("HISTORY", `Failed to save recording audio: ${formatErrorMessage(error)}`);
    return {
      audioPath: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    };
  }
}

async function loadRecordingAudioSource(
  entry: HistoryEntry,
): Promise<RecordingAudioSource> {
  if (entry.audioPath) {
    const audio = await readHistoryAudio(entry.audioPath);
    return {
      audioBase64: audio.audioBase64,
      audioMimeType: audio.mimeType || entry.audioMimeType || "audio/webm",
      audioFileName:
        entry.audioFileName ||
        (audio.mimeType?.includes("wav") ? "recording.wav" : "recording.webm"),
    };
  }

  if (entry.audioBase64) {
    return {
      audioBase64: entry.audioBase64,
      audioMimeType: entry.audioMimeType || "audio/webm",
      audioFileName: entry.audioFileName || "recording.webm",
    };
  }

  throw new Error(tn("widget.error.noSavedAudio"));
}

function isLocalSttSettings(settings: AppSettings): boolean {
  return (
    settings.useOwnKey &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "")
  );
}

const STREAMING_LOCAL_STT_MODEL_IDS: Record<string, string> = {
  "nvidia/nemotron-3.5-asr-streaming-0.6b": "nemotron-35-asr-streaming-06b",
  "nvidia/nemotron-speech-streaming-en-0.6b": "nemotron-speech-streaming-en-06b",
  "moonshine-streaming-tiny": "moonshine-streaming-tiny",
  "moonshine-streaming-small": "moonshine-streaming-small",
};

function isLocalSttStreamingEnabled(settings: AppSettings): boolean {
  if (!isLocalSttSettings(settings)) return false;
  const modelId = STREAMING_LOCAL_STT_MODEL_IDS[settings.whisperModel || ""];
  if (!modelId) return false;
  const cachedValue = settings.localModels?.[modelId]?.streamingEnabled;
  return typeof cachedValue === "boolean" ? cachedValue : true;
}

function languageLabel(code: string): string {
  const language = LANGUAGES.find((item) => item.code === code);
  if (!language) return code;
  return `${language.name} (${language.native})`;
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

  if (normalized.includes("translation text model unavailable")) {
    return tn("widget.error.translationModelUnavailable");
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
}): Promise<TranscriptionResult> {
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
}): Promise<TranscriptionResult> {
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
      streaming_enabled: isLocalSttStreamingEnabled(settings),
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
}): Promise<TranscriptionResult> {
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

async function applyDictationTranslation(
  result: TranscriptionResult,
  settings: AppSettings,
): Promise<TranscriptionResult> {
  if (!settings.translation.active) {
    return result;
  }

  const sourceText = result.cleaned.trim();
  if (!sourceText) {
    return result;
  }

  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error("translation text model unavailable");
  }

  const sourceLanguage = settings.language || "auto";
  const targetLanguage = settings.translation.targetLanguage;
  const prompt =
    `Переведи текст с языка "${languageLabel(sourceLanguage)}" на язык "${languageLabel(targetLanguage)}". ` +
    "Верни только перевод, без комментариев, пояснений, markdown-оберток и новых фактов. " +
    "Сохрани смысл, тон, структуру, переносы строк и форматирование исходного текста. " +
    "Если в тексте есть списки, числа, имена, ссылки или технические термины, сохрани их точно, переводя только естественный язык.";

  logInfo(
    "TRANSLATION",
    `Translating dictation via ${backend.kind}: ${sourceLanguage} -> ${targetLanguage}, chars=${sourceText.length}`,
  );

  const translatedText = (await backend.run({
    text: sourceText,
    prompt,
    temperature: 0.1,
  })).trim();

  if (!translatedText) {
    throw new Error("translation returned empty text");
  }

  return {
    raw: result.raw,
    cleaned: translatedText,
    dictationTranslation: {
      provider: backend.kind,
      sourceLanguage,
      targetLanguage,
      sourceText,
      translatedText,
    },
  };
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
    const transcription = await transcribeAudio({
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

    logInfo("API", `Pipeline result received: raw_type=${typeof transcription.raw}, cleaned_type=${typeof transcription.cleaned}`);

    if (!hasRecognizedSpeech(transcription)) {
      logInfo("API", "Nothing recognized, removing placeholder entry, skipping paste");
      await deleteHistoryEntry(baseEntry.id);
      await emit(HISTORY_UPDATED_EVENT, baseEntry);
      return { durationSeconds, hasTranscription: false };
    }

    const result = await applyDictationTranslation(transcription, settings);
    const processingTime = Date.now() - apiStart;

    if (handle.isCancelled()) {
      await finishProcessing(buildInterruptedEntry(baseEntry));
      return { durationSeconds, hasTranscription: false };
    }

    logInfo("API", `Transcription complete in ${processingTime}ms: "${result.cleaned}"`);
    const savedAudio = await saveCompletedRecordingAudio({
      entryId: baseEntry.id,
      audioBase64: base64Audio,
      audioMimeType,
      audioFileName,
      settings,
    });
    await finishProcessing({
      ...baseEntry,
      raw: result.raw,
      cleaned: result.cleaned,
      dictationTranslation: result.dictationTranslation,
      status: "completed",
      errorMessage: undefined,
      processingTime,
      audioPath: savedAudio.audioPath,
      audioBase64: undefined,
      audioMimeType: savedAudio.audioMimeType,
      audioFileName: savedAudio.audioFileName,
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
  const audioSource = await loadRecordingAudioSource(entry);

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
    const transcription = await transcribeAudio({
      audioBase64: audioSource.audioBase64,
      audioMimeType: audioSource.audioMimeType,
      audioFileName: audioSource.audioFileName,
      settings: retrySettings,
      signal: handle.signal,
    });

    if (handle.isCancelled()) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    if (!hasRecognizedSpeech(transcription)) {
      throw new Error(tn("widget.error.speechNotRecognized"));
    }

    const result = await applyDictationTranslation(transcription, retrySettings);

    if (handle.isCancelled()) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    const savedAudio = entry.audioPath && settings.saveRecordingAudio
      ? {
          audioPath: entry.audioPath,
          audioMimeType: entry.audioMimeType || audioSource.audioMimeType,
          audioFileName: entry.audioFileName || audioSource.audioFileName,
        }
      : await saveCompletedRecordingAudio({
          entryId: entry.id,
          ...audioSource,
          settings,
        });

    const updatedEntry: HistoryEntry = {
      ...entry,
      raw: result.raw,
      cleaned: result.cleaned,
      dictationTranslation: result.dictationTranslation,
      status: "completed",
      errorMessage: undefined,
      audioPath: savedAudio.audioPath,
      audioBase64: undefined,
      audioMimeType: savedAudio.audioMimeType,
      audioFileName: savedAudio.audioFileName,
    };

    await finishProcessing(updatedEntry);
    if (!settings.saveRecordingAudio && entry.audioPath) {
      await deleteHistoryAudio(entry.audioPath).catch((error) => {
        logError("HISTORY", `Failed to delete disabled recording audio: ${formatErrorMessage(error)}`);
      });
    }

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
