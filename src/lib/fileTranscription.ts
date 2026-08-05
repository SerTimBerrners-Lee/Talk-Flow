import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { AppSettings, type HistoryEntry } from "./store";
import { fetchCloudProfile } from "./cloudAuth";
import { logError, logInfo } from "./logger";
import { beginProcessing, finishProcessing } from "./processingControl";
import { formatErrorMessage } from "./utils";
import { tn } from "./i18n";

const fileInterruptedMessage = (): string => tn("fileTranscription.interrupted");

const PROXY_BASE_URL = "https://proxy.talkis.ru";
const TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const INPUT_MAX_BYTES = 200 * 1024 * 1024;
const FILE_TRANSCRIPTION_PROGRESS_EVENT = "file-transcription-progress";
const DIARIZED_WHISPER_ENDPOINT = "http://127.0.0.1:8000";
const DIARIZED_WHISPER_MODEL = "whisper-large-v3-turbo";
const CLOUD_CAPABILITIES_CACHE_MS = 60_000;
const DIARIZED_WHISPER_MODEL_OPTIONS = [
  "whisper-large-v3-turbo",
  "whisper-large-v3",
  "whisper-medium",
  "whisper-small",
  "whisper-base",
  "whisper-tiny",
] as const;
const STRONG_DIARIZED_WHISPER_MODELS = new Set(["whisper-large-v3-turbo", "whisper-large-v3", "whisper-medium"]);

const DIRECT_EXTENSIONS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

export type FileTranscriptionStatus = "reading" | "converting" | "uploading" | "preparing" | "diarizing" | "transcribing" | "assembling" | "done";

export interface FileTranscriptionProgress {
  status: FileTranscriptionStatus;
  currentChunk: number;
  totalChunks: number;
  message: string;
}

export interface FileTranscriptionResult {
  text: string;
  converted: boolean;
  uploadedFileName: string;
  uploadedSizeBytes: number;
  mode: "plain" | "speakers";
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
}

export interface Speaker {
  id: string;
  label: string;
}

export interface SpeakerTranscriptSegment {
  start: number;
  end: number;
  speakerId: string;
  speakerLabel: string;
  text: string;
}

function formatSpeakerTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function identifyFirstFileSpeakerAsUser(
  result: FileTranscriptionResult,
): FileTranscriptionResult {
  if (!result.segments?.length) {
    return result;
  }

  const orderedIds: string[] = [];
  for (const segment of result.segments) {
    if (!orderedIds.includes(segment.speakerId)) {
      orderedIds.push(segment.speakerId);
    }
  }
  for (const speaker of result.speakers || []) {
    if (!orderedIds.includes(speaker.id)) {
      orderedIds.push(speaker.id);
    }
  }

  const labels = new Map<string, string>();
  orderedIds.forEach((speakerId, index) => {
    labels.set(
      speakerId,
      index === 0
        ? tn("callCapture.speakerYou")
        : tn("callCapture.speakerGuestN", { index }),
    );
  });
  const speakers = orderedIds.map((id) => ({
    id,
    label: labels.get(id) || tn("callCapture.speakerGuestN", { index: 1 }),
  }));
  const segments = result.segments.map((segment) => ({
    ...segment,
    speakerLabel:
      labels.get(segment.speakerId) ||
      tn("callCapture.speakerGuestN", { index: 1 }),
  }));
  const text = segments
    .map(
      (segment) =>
        `[${formatSpeakerTimestamp(segment.start)}] ${segment.speakerLabel}: ${segment.text.trim()}`,
    )
    .join("\n");

  return {
    ...result,
    text,
    speakers,
    segments,
  };
}

interface NativeTranscriptionResult {
  raw: string;
  cleaned: string;
  mode?: "plain" | "speakers";
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
}

interface PreparedMediaResponse {
  audio_base64: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

interface PreparedTranscriptionFile {
  audioBase64: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  converted: boolean;
}

interface FileTranscriptionProgressPayload {
  request_id: string;
  status: FileTranscriptionStatus;
  current_chunk: number;
  total_chunks: number;
  message: string;
}

interface FilePathRequestSettings {
  whisperApiKey: string | null;
  whisperEndpoint: string | null;
  whisperModel: string | null;
  useOwnKey: boolean;
  deviceToken: string | null;
}

interface CloudTranscriptionCapabilities {
  fileTranscription: boolean;
  speakerDiarization: boolean;
  speakerDiarizationProvider?: string;
  speakerDiarizationMaxSpeakers?: number;
}

interface FileTranscriptionErrorContext {
  settings?: Pick<AppSettings, "useOwnKey" | "provider" | "whisperEndpoint"> | null;
  localStt?: boolean;
}

let cloudCapabilitiesCache: { value: CloudTranscriptionCapabilities; expiresAt: number } | null = null;

function fileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop();
  return name || tn("fileTranscription.fallbackFileName");
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function mimeTypeForFile(file: File): string {
  if (file.type.trim()) {
    return file.type;
  }

  return MIME_BY_EXTENSION[fileExtension(file.name)] || "application/octet-stream";
}

function shouldConvert(file: File): boolean {
  const extension = fileExtension(file.name);
  const isDirectFormat = DIRECT_EXTENSIONS.has(extension);
  const isVideo = file.type.startsWith("video/");

  return isVideo || !isDirectFormat || file.size > TRANSCRIPTION_MAX_BYTES;
}

function isLocalSttSettings(
  settings: Pick<AppSettings, "useOwnKey" | "provider" | "whisperEndpoint">,
): boolean {
  return /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "");
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

function buildFilePathRequestSettings(
  settings: AppSettings,
  speakerDiarization: boolean,
  useCloudSpeakerDiarization: boolean,
): FilePathRequestSettings {
  const isLocalStt = isLocalSttSettings(settings);

  if (!speakerDiarization || useCloudSpeakerDiarization) {
    return {
      whisperApiKey: isLocalStt ? null : settings.whisperApiKey || null,
      whisperEndpoint: settings.whisperEndpoint || null,
      whisperModel: settings.whisperModel || null,
      useOwnKey: isLocalStt ? true : settings.useOwnKey,
      deviceToken: isLocalStt ? null : settings.deviceToken || null,
    };
  }

  return {
    whisperApiKey: null,
    whisperEndpoint: DIARIZED_WHISPER_ENDPOINT,
    whisperModel: getDiarizedWhisperModel(settings),
    useOwnKey: true,
    deviceToken: null,
  };
}

export async function getCloudTranscriptionCapabilities(force = false): Promise<CloudTranscriptionCapabilities> {
  const now = Date.now();
  if (!force && cloudCapabilitiesCache && cloudCapabilitiesCache.expiresAt > now) {
    return cloudCapabilitiesCache.value;
  }

  const response = await fetch(`${PROXY_BASE_URL}/api/capabilities`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Proxy capabilities error (${response.status}): ${body}`);
  }

  let parsed: Partial<CloudTranscriptionCapabilities>;
  try {
    parsed = JSON.parse(body) as Partial<CloudTranscriptionCapabilities>;
  } catch (error) {
    logError("FILE_TRANSCRIPTION", `Proxy capabilities parse failed: ${formatErrorMessage(error)}; body=${body}`);
    throw new Error("Talkis Cloud returned invalid capabilities");
  }

  const capabilities: CloudTranscriptionCapabilities = {
    fileTranscription: parsed.fileTranscription === true,
    speakerDiarization: parsed.speakerDiarization === true,
    speakerDiarizationProvider: typeof parsed.speakerDiarizationProvider === "string" ? parsed.speakerDiarizationProvider : undefined,
    speakerDiarizationMaxSpeakers: typeof parsed.speakerDiarizationMaxSpeakers === "number" ? parsed.speakerDiarizationMaxSpeakers : undefined,
  };

  cloudCapabilitiesCache = {
    value: capabilities,
    expiresAt: now + CLOUD_CAPABILITIES_CACHE_MS,
  };

  return capabilities;
}

export async function canUseCloudSpeakerDiarization(settings: AppSettings, force = false): Promise<boolean> {
  if (settings.useOwnKey || !settings.deviceToken?.trim()) {
    return false;
  }

  try {
    const profile = await fetchCloudProfile({ force });
    if (profile?.subscription.active !== true) {
      return false;
    }

    const capabilities = await getCloudTranscriptionCapabilities(force);
    return capabilities.speakerDiarization === true;
  } catch (error) {
    logError("FILE_TRANSCRIPTION", `Cloud diarization capability check failed: ${formatErrorMessage(error)}`);
    return false;
  }
}

function getDiarizedWhisperModel(settings: AppSettings): string {
  const currentModel = (settings.whisperModel || "").trim().toLowerCase();
  const currentOption = DIARIZED_WHISPER_MODEL_OPTIONS.find((model) => (
    model.toLowerCase() === currentModel && settings.localModels?.[model]?.status === "downloaded"
  ));

  if (currentOption && STRONG_DIARIZED_WHISPER_MODELS.has(currentOption)) {
    return currentOption;
  }

  const strongestDownloadedOption = DIARIZED_WHISPER_MODEL_OPTIONS.find((model) => (
    STRONG_DIARIZED_WHISPER_MODELS.has(model) && settings.localModels?.[model]?.status === "downloaded"
  ));

  return strongestDownloadedOption || currentOption || DIARIZED_WHISPER_MODEL_OPTIONS.find((model) => (
    settings.localModels?.[model]?.status === "downloaded"
  )) || DIARIZED_WHISPER_MODEL;
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) {
    return tn("fileTranscription.sizeBytes", { value: 0 });
  }

  if (bytes >= 1024 * 1024) {
    return tn("fileTranscription.sizeMb", { value: (bytes / 1024 / 1024).toFixed(1) });
  }

  if (bytes >= 1024) {
    return tn("fileTranscription.sizeKb", { value: Math.round(bytes / 1024) });
  }

  return tn("fileTranscription.sizeBytes", { value: bytes });
}

export function getFileTranscriptionPercent(
  status: FileTranscriptionStatus | "idle" | "error",
  progress: FileTranscriptionProgress | null,
): number {
  if (status === "done") return 100;
  if (status === "error" || status === "idle") return 0;
  if (status === "reading") return 12;
  if (status === "converting") return 32;
  if (status === "uploading") return 58;
  if (status === "preparing") return 18;
  if (status === "diarizing") return 42;
  if (status === "assembling") return 96;

  if (status === "transcribing" && progress && progress.totalChunks > 0) {
    const currentChunk = Math.max(0, Math.min(progress.currentChunk, progress.totalChunks));
    const chunkProgress = currentChunk / progress.totalChunks;
    return Math.max(58, Math.min(94, Math.round(58 + chunkProgress * 36)));
  }

  if (status === "transcribing") return 70;

  return 0;
}

export function toFileTranscriptionErrorMessage(
  error: unknown,
  context: FileTranscriptionErrorContext = {},
): string {
  const raw = formatErrorMessage(error);
  const normalized = raw.toLowerCase();
  const isLocalRuntimeError =
    context.localStt === true ||
    (context.settings ? isLocalSttSettings(context.settings) : false) ||
    normalized.includes("локальный stt runtime") ||
    normalized.includes("local stt runtime") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("localhost");

  if (normalized.includes("ffmpeg") || normalized.includes("медиаконвертер")) {
    return tn("fileTranscription.errMediaConverterUnavailable");
  }

  if (normalized.includes("больше 25") || normalized.includes("too large")) {
    return tn("fileTranscription.errTooLargeShorter");
  }

  if (
    normalized.includes("1 гб") ||
    normalized.includes("1 gb") ||
    normalized.includes("8 гб") ||
    normalized.includes("8 gb")
  ) {
    return tn("fileTranscription.errTooLargeMax8gb");
  }

  if (normalized.includes("unsupported") || normalized.includes("не удалось извлечь аудио")) {
    return tn("fileTranscription.errCannotReadAudio");
  }

  if (normalized.includes("talkis cloud session missing")) {
    return tn("fileTranscription.errCloudSessionMissing");
  }

  if (normalized.includes("speaker diarization is not configured")) {
    return tn("fileTranscription.errCloudDiarizationNotConfigured");
  }

  if (normalized.includes("cloud speaker diarization unavailable")) {
    return tn("fileTranscription.errCloudDiarizationUnavailable");
  }

  if (
    isLocalRuntimeError &&
    (
      normalized.includes("403") ||
      normalized.includes("forbidden") ||
      isAuthFailureLike(normalized) ||
      normalized.includes("отклонил запрос")
    )
  ) {
    return tn("fileTranscription.errLocalRuntimeRejected");
  }

  if (
    normalized.includes("subscription inactive") ||
    normalized.includes("insufficient_cloud_tokens") ||
    normalized.includes("402") ||
    normalized.includes("403")
  ) {
    return tn("fileTranscription.errSubscriptionInactive");
  }

  if (normalized.includes("не удалось подготовить аудио для разделения говорящих")) {
    return tn("fileTranscription.errCannotPrepareDiarization");
  }

  if (normalized.includes("таймкод")) {
    return tn("fileTranscription.errNeedTimestampModel");
  }

  if (
    normalized.includes("разделения говорящих ещё не скачана")
    || normalized.includes("sherpa-diarization-pyannote-titanet-int8") && normalized.includes("ещё не скачана")
  ) {
    return tn("fileTranscription.errDownloadDiarizationComponents");
  }

  if (
    normalized.includes("sherpa-onnx установлен")
    && (normalized.includes("diarization binary") || normalized.includes("binary для разметки говорящих"))
  ) {
    return tn("fileTranscription.errRuntimeIncomplete");
  }

  if (normalized.includes("sherpa-onnx diarization не вернул сегменты")) {
    return tn("fileTranscription.errNoSpeakerSegments");
  }

  if (normalized.includes("sherpa-onnx diarization завершился с ошибкой")) {
    return raw;
  }

  if (normalized.includes("not installed locally") || normalized.includes("ещё не скачана")) {
    return tn("fileTranscription.errLocalModelNotInstalled");
  }

  if (isAuthFailureLike(normalized)) {
    return tn("fileTranscription.errAuthFailed");
  }

  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return tn("fileTranscription.errRateLimit");
  }

  const isCloudDiarizationError =
    normalized.includes("proxy diarized") ||
    normalized.includes("diarized stt failed");
  const isTimeoutError =
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("time-out") ||
    normalized.includes("deadline exceeded") ||
    normalized.includes("504 gateway");

  if (isCloudDiarizationError && isTimeoutError) {
    return tn("fileTranscription.errCloudDiarizationTimeout");
  }

  if (isCloudDiarizationError) {
    return tn("fileTranscription.errCloudDiarizationFailed");
  }

  if (
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("gateway")
  ) {
    return tn("fileTranscription.errNetwork");
  }

  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("timed out")) {
    return tn("fileTranscription.errNetwork");
  }

  return tn("fileTranscription.errGeneric");
}

async function prepareFile(
  file: File,
  onStatus?: (status: FileTranscriptionStatus) => void,
): Promise<PreparedTranscriptionFile> {
  if (file.size <= 0) {
    throw new Error(tn("fileTranscription.errEmptyFile"));
  }

  if (file.size > INPUT_MAX_BYTES) {
    throw new Error(tn("fileTranscription.errTooLargeForPrep"));
  }

  onStatus?.("reading");
  const audioBase64 = arrayBufferToBase64(await file.arrayBuffer());

  if (!shouldConvert(file)) {
    return {
      audioBase64,
      fileName: file.name,
      mimeType: mimeTypeForFile(file),
      sizeBytes: file.size,
      converted: false,
    };
  }

  onStatus?.("converting");
  const prepared = await invoke<PreparedMediaResponse>("prepare_media_for_transcription", {
    req: {
      file_base64: audioBase64,
      file_name: file.name,
    },
  });

  return {
    audioBase64: prepared.audio_base64,
    fileName: prepared.file_name,
    mimeType: prepared.mime_type,
    sizeBytes: prepared.size_bytes,
    converted: true,
  };
}

async function transcribeViaProxy(
  prepared: PreparedTranscriptionFile,
  settings: AppSettings,
): Promise<{ raw: string; cleaned: string }> {
  const blob = base64ToBlob(prepared.audioBase64, prepared.mimeType);
  const form = new FormData();
  form.append("file", blob, prepared.fileName);
  form.append("language", settings.language || "ru");
  form.append("style", settings.style || "classic");

  const response = await fetch(`${PROXY_BASE_URL}/api/transcribe-only`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.deviceToken}`,
    },
    body: form,
  });

  const body = await response.text();

  if (!response.ok) {
    logError("FILE_TRANSCRIPTION", `Proxy error (${response.status}): ${body}`);
    throw new Error(`Proxy error (${response.status}): ${body}`);
  }

  try {
    const parsed = JSON.parse(body) as { raw?: string; cleaned?: string };
    return {
      raw: typeof parsed.raw === "string" ? parsed.raw : "",
      cleaned: typeof parsed.cleaned === "string" ? parsed.cleaned : "",
    };
  } catch (error) {
    logError("FILE_TRANSCRIPTION", `Proxy response parse failed: ${formatErrorMessage(error)}; body=${body}`);
    throw new Error("Talkis Cloud returned an invalid response");
  }
}

async function transcribeViaBackend(
  prepared: PreparedTranscriptionFile,
  settings: AppSettings,
): Promise<NativeTranscriptionResult> {
  const isLocalStt = isLocalSttSettings(settings);

  return invoke<NativeTranscriptionResult>("transcribe_only", {
    req: {
      audio_base64: prepared.audioBase64,
      language: settings.language,
      api_key: settings.apiKey,
      whisper_api_key: isLocalStt ? null : settings.whisperApiKey || null,
      llm_api_key: null,
      style: settings.style || "classic",
      whisper_endpoint: settings.whisperEndpoint || null,
      local_models_dir: settings.localModelsDir || null,
      llm_endpoint: null,
      whisper_model: settings.whisperModel || null,
      llm_model: "none",
      file_name: prepared.fileName,
      mime_type: prepared.mimeType,
      mode: "transcribe_only",
    },
  });
}

async function transcribePreparedFile(
  prepared: PreparedTranscriptionFile,
  settings: AppSettings,
): Promise<NativeTranscriptionResult> {
  if (isLocalSttSettings(settings)) {
    return transcribeViaBackend(prepared, settings);
  }

  if (!settings.useOwnKey && settings.deviceToken?.trim()) {
    return transcribeViaProxy(prepared, settings);
  }

  if (!settings.useOwnKey) {
    throw new Error("Talkis Cloud session missing");
  }

  return transcribeViaBackend(prepared, settings);
}

export async function transcribeFileOnly({
  file,
  settings,
  onStatus,
}: {
  file: File;
  settings: AppSettings;
  onStatus?: (status: FileTranscriptionStatus) => void;
}): Promise<FileTranscriptionResult> {
  const prepared = await prepareFile(file, onStatus);
  onStatus?.("uploading");

  logInfo(
    "FILE_TRANSCRIPTION",
    `Sending ${prepared.fileName}, size=${prepared.sizeBytes}, converted=${prepared.converted}`,
  );

  const result = await transcribePreparedFile(prepared, settings);
  const text = (result.raw || result.cleaned).trim();

  if (!text) {
    throw new Error(tn("fileTranscription.errNoSpeech"));
  }

  return {
    text,
    converted: prepared.converted,
    uploadedFileName: prepared.fileName,
    uploadedSizeBytes: prepared.sizeBytes,
    mode: "plain",
  };
}

export async function transcribeFilePathOnly({
  filePath,
  settings,
  onStatus,
  onProgress,
  speakerDiarization = false,
  identifyFirstSpeakerAsUser = false,
}: {
  filePath: string;
  settings: AppSettings;
  onStatus?: (status: FileTranscriptionStatus) => void;
  onProgress?: (progress: FileTranscriptionProgress) => void;
  speakerDiarization?: boolean;
  identifyFirstSpeakerAsUser?: boolean;
}): Promise<FileTranscriptionResult> {
  const requestId = crypto.randomUUID();
  const fileName = fileNameFromPath(filePath);

  const unlisten = await listen<FileTranscriptionProgressPayload>(
    FILE_TRANSCRIPTION_PROGRESS_EVENT,
    (event) => {
      if (event.payload.request_id !== requestId) return;

      const progress: FileTranscriptionProgress = {
        status: event.payload.status,
        currentChunk: event.payload.current_chunk || 0,
        totalChunks: event.payload.total_chunks || 0,
        message: event.payload.message || "",
      };

      onStatus?.(progress.status);
      onProgress?.(progress);
    },
  );

  try {
    onStatus?.("preparing");
    onProgress?.({
      status: "preparing",
      currentChunk: 0,
      totalChunks: 0,
      message: tn("fileTranscription.statusPreparing"),
    });

    logInfo("FILE_TRANSCRIPTION", `Sending file path ${fileName} through native pipeline`);
    const isLocalStt = isLocalSttSettings(settings);
    const effectiveUseOwnKey = isLocalStt || settings.useOwnKey;
    const useCloudSpeakerDiarization = speakerDiarization && !isLocalStt && await canUseCloudSpeakerDiarization(settings);
    if (speakerDiarization && !effectiveUseOwnKey && !useCloudSpeakerDiarization) {
      throw new Error("Cloud speaker diarization unavailable");
    }
    const requestSettings = buildFilePathRequestSettings(settings, speakerDiarization, useCloudSpeakerDiarization);

    const result = await invoke<NativeTranscriptionResult>("transcribe_file_path", {
      req: {
        request_id: requestId,
        file_path: filePath,
        file_name: fileName,
        file_size: null,
        language: settings.language,
        api_key: settings.apiKey,
        whisper_api_key: requestSettings.whisperApiKey,
        style: settings.style || "classic",
        whisper_endpoint: requestSettings.whisperEndpoint,
        local_models_dir: settings.localModelsDir || null,
        whisper_model: requestSettings.whisperModel,
        use_own_key: requestSettings.useOwnKey,
        device_token: requestSettings.deviceToken,
        speaker_diarization: speakerDiarization,
      },
    });
    const text = (result.raw || result.cleaned).trim();

    if (!text) {
      throw new Error(tn("fileTranscription.errNoSpeech"));
    }

    const transcription: FileTranscriptionResult = {
      text,
      converted: true,
      uploadedFileName: fileName,
      uploadedSizeBytes: 0,
      mode: result.mode || "plain",
      speakers: result.speakers,
      segments: result.segments,
    };
    return identifyFirstSpeakerAsUser
      ? identifyFirstFileSpeakerAsUser(transcription)
      : transcription;
  } catch (error) {
    void logError(
      "FILE_TRANSCRIPTION",
      `Native file transcription failed: ${formatErrorMessage(error)}`,
    );
    throw error;
  } finally {
    unlisten();
  }
}

/**
 * Re-process a file history entry (interrupted or failed) from its stored source
 * path. Goes through the shared processing lifecycle so it shows as a live row
 * and can be cancelled. The source file must still exist on disk.
 */
export async function retryFileHistoryEntry(
  entry: HistoryEntry,
  settings: AppSettings,
): Promise<HistoryEntry> {
  if (!entry.filePath) {
    throw new Error(tn("fileTranscription.errNoSavedFile"));
  }

  const startedAt = Date.now();
  const handle = await beginProcessing(entry, "update");

  try {
    const result = await transcribeFilePathOnly({
      filePath: entry.filePath,
      settings,
      speakerDiarization: settings.fileSpeakerDiarization === true,
      identifyFirstSpeakerAsUser: true,
    });

    if (handle.isCancelled()) {
      const interrupted: HistoryEntry = {
        ...entry,
        status: "interrupted",
        errorMessage: fileInterruptedMessage(),
      };
      await finishProcessing(interrupted);
      return interrupted;
    }

    const updated: HistoryEntry = {
      ...entry,
      raw: result.text,
      cleaned: result.text,
      status: "completed",
      errorMessage: undefined,
      processingTime: Date.now() - startedAt,
      mode: result.mode,
      speakers: result.speakers,
      segments: result.segments,
    };
    await finishProcessing(updated);
    return updated;
  } catch (error) {
    if (handle.isCancelled()) {
      const interrupted: HistoryEntry = {
        ...entry,
        status: "interrupted",
        errorMessage: fileInterruptedMessage(),
      };
      await finishProcessing(interrupted);
      return interrupted;
    }

    const message = formatErrorMessage(error);
    void logError("WIDGET_FILE", `File retry failed: ${message}`);
    const userFacingMessage = toFileTranscriptionErrorMessage(error, { settings });
    const failed: HistoryEntry = {
      ...entry,
      status: "failed",
      errorMessage: userFacingMessage,
    };
    await finishProcessing(failed);
    throw new Error(userFacingMessage);
  }
}
