import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import { HISTORY_UPDATED_EVENT } from "./hotkeyEvents";
import { logError, logInfo } from "./logger";
import { beginProcessing, finishProcessing } from "./processingControl";
import { tn } from "./i18n";
import {
  addHistoryEntry,
  type AppSettings,
  type HistoryEntry,
} from "./store";

const callInterruptedMessage = (): string => tn("callCapture.interrupted");
import {
  type FileTranscriptionResult,
  toFileTranscriptionErrorMessage,
  transcribeFilePathOnly,
  transcribeFileOnly,
  type FileTranscriptionProgress,
  type FileTranscriptionStatus,
} from "./fileTranscription";

export type CaptureTargetKind = "systemOutput" | "process" | "window";
export type CallCaptureStatus = "starting" | "recording" | "stopped" | "failed";
export type CallCaptureTrackKind = "mic" | "system";

export interface CaptureTarget {
  id: string;
  label: string;
  kind: CaptureTargetKind;
  platform: string;
}

export interface StartCallCaptureRequest {
  targetId?: string | null;
  includeMic?: boolean;
  includeSystem?: boolean;
  micDeviceId?: string | null;
  sampleRate?: number | null;
  storageDir?: string | null;
}

export interface CallCaptureTrack {
  kind: CallCaptureTrackKind;
  label: string;
  path: string;
  channels: number;
  sampleRate: number;
}

export interface CallCaptureSession {
  id: string;
  platform: string;
  status: CallCaptureStatus;
  startedAt: string;
  endedAt?: string | null;
  directory: string;
  tracks: CallCaptureTrack[];
}

export async function listCallCaptureTargets(): Promise<CaptureTarget[]> {
  return invoke<CaptureTarget[]>("list_call_capture_targets");
}

export async function startCallCapture(
  req: StartCallCaptureRequest,
): Promise<CallCaptureSession> {
  return invoke<CallCaptureSession>("start_call_capture", { req });
}

export async function stopCallCapture(
  sessionId: string,
): Promise<CallCaptureSession> {
  return invoke<CallCaptureSession>("stop_call_capture", { sessionId });
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

export async function saveCallCaptureMicTrack(
  sessionId: string,
  blob: Blob,
): Promise<CallCaptureTrack> {
  const audioBase64 = arrayBufferToBase64(await blob.arrayBuffer());
  return invoke<CallCaptureTrack>("save_call_capture_mic_track", {
    sessionId,
    audioBase64,
    mimeType: blob.type || null,
  });
}

export async function getCallCaptureStatus(
  sessionId: string,
): Promise<CallCaptureSession> {
  return invoke<CallCaptureSession>("get_call_capture_status", { sessionId });
}

export async function getCallCaptureDurationMs(
  sessionId: string,
): Promise<number> {
  return invoke<number>("get_call_capture_duration_ms", { sessionId });
}

export async function saveFailedCallCaptureEntry({
  session,
  errorMessage,
  startedAt,
}: {
  session: CallCaptureSession;
  errorMessage: string;
  startedAt?: number;
}): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    duration: startedAt
      ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      : 0,
    raw: "",
    cleaned: "",
    source: "call",
    fileName: tn("callCapture.fileName"),
    status: "failed",
    errorMessage,
    processingTime: startedAt ? Date.now() - startedAt : undefined,
    callSessionId: session.id,
    callTracks: session.tracks.map((track) => ({
      kind: track.kind,
      label: track.label,
      path: track.path,
    })),
  };

  await addHistoryEntry(entry);
  await emit(HISTORY_UPDATED_EVENT, entry);
  return entry;
}

function callTrackTitle(track: CallCaptureTrack): string {
  return track.kind === "mic" ? tn("callCapture.speakerYou") : tn("callCapture.speakerCall");
}

function formatTrackTranscript(track: CallCaptureTrack, text: string): string {
  return `${callTrackTitle(track)}:\n${text.trim()}`;
}

function micPlainText(part: string): string {
  const label = tn("callCapture.speakerYou").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return part.replace(new RegExp(`^${label}:\\s*`, "i"), "").trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatSpeakerTranscript(
  segments: NonNullable<FileTranscriptionResult["segments"]>,
): string {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}] ${segment.speakerLabel}: ${segment.text.trim()}`,
    )
    .join("\n");
}

function orderedSpeakerIds(result: FileTranscriptionResult): string[] {
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  result.speakers?.forEach((speaker) => {
    if (seen.has(speaker.id)) return;
    seen.add(speaker.id);
    orderedIds.push(speaker.id);
  });

  result.segments?.forEach((segment) => {
    if (seen.has(segment.speakerId)) return;
    seen.add(segment.speakerId);
    orderedIds.push(segment.speakerId);
  });

  return orderedIds;
}

function normalizeCallSpeakerResult(
  result: FileTranscriptionResult,
  source: "system" | "micFallback",
): FileTranscriptionResult {
  if (!result.segments?.length) {
    return result;
  }

  const firstMicSpeakerId =
    source === "micFallback" ? result.segments[0]?.speakerId : null;
  const labelsById = new Map<string, string>();
  let guestIndex = 1;

  orderedSpeakerIds(result).forEach((speakerId) => {
    if (speakerId === firstMicSpeakerId) {
      labelsById.set(speakerId, tn("callCapture.speakerYou"));
      return;
    }

    labelsById.set(speakerId, tn("callCapture.speakerGuestN", { index: guestIndex }));
    guestIndex += 1;
  });

  const speakers = orderedSpeakerIds(result).map((speakerId) => ({
    id: speakerId,
    label: labelsById.get(speakerId) || tn("callCapture.speakerGuestN", { index: 1 }),
  }));
  const segments = result.segments.map((segment) => ({
    ...segment,
    speakerLabel:
      labelsById.get(segment.speakerId) || segment.speakerLabel || tn("callCapture.speakerGuestN", { index: 1 }),
  }));

  return {
    ...result,
    text: formatSpeakerTranscript(segments),
    speakers,
    segments,
  };
}

function addSpeakerResultToHistoryDraft(
  result: FileTranscriptionResult,
  speakersById: Map<string, NonNullable<HistoryEntry["speakers"]>[number]>,
  speakerSegments: NonNullable<HistoryEntry["segments"]>,
  source: "system" | "micFallback",
): string | null {
  if (!result.segments?.length) {
    return null;
  }

  const normalized = normalizeCallSpeakerResult(result, source);

  normalized.speakers?.forEach((speaker) => {
    speakersById.set(speaker.id, speaker);
  });
  speakerSegments.push(...(normalized.segments || []));
  return normalized.text;
}

interface TranscribeCallCaptureSessionParams {
  session: CallCaptureSession;
  settings: AppSettings;
  startedAt?: number;
  micFile?: File | null;
  onStatus?: (status: FileTranscriptionStatus) => void;
  onProgress?: (progress: FileTranscriptionProgress) => void;
  /** Fires with the new entry id once the "processing" row exists. */
  onStarted?: (entryId: string) => void;
}

async function buildCallCaptureHistoryEntry({
  session,
  settings,
  startedAt,
  micFile,
  onStatus,
  onProgress,
}: TranscribeCallCaptureSessionParams, overrides?: {
  id?: string;
  timestamp?: string;
  duration?: number;
}): Promise<HistoryEntry> {
  const orderedTracks = [...session.tracks].sort((left, right) => {
    if (left.kind === right.kind) return 0;
    return left.kind === "mic" ? -1 : 1;
  });

  const parts: string[] = [];
  const speakerSegments: NonNullable<HistoryEntry["segments"]> = [];
  const speakersById = new Map<
    string,
    NonNullable<HistoryEntry["speakers"]>[number]
  >();
  let mode: HistoryEntry["mode"] = "plain";
  let requiredSystemDiarizationFailed = false;
  let micPlainPart: string | null = null;
  let micPathTrack: CallCaptureTrack | null = null;
  let usedMicDiarizationFallback = false;

  const failedTracks: string[] = [];

  if (micFile) {
    try {
      const micResult = await transcribeFileOnly({
        file: micFile,
        settings,
        onStatus,
      });
      micPlainPart = `${tn("callCapture.speakerYou")}:\n${micResult.text.trim()}`;
    } catch (error) {
      const message = toFileTranscriptionErrorMessage(error, { settings });
      failedTracks.push(`${tn("callCapture.trackMic")}: ${message}`);
      void logError(
        "CALL_CAPTURE",
        `Mic track transcription failed: ${errorMessage(error)}`,
      );
    }
  }

  for (const track of orderedTracks.filter(
    (track) => !(track.kind === "mic" && micFile),
  )) {
    if (track.kind === "mic") {
      micPathTrack = track;
    }

    const shouldDiarizeSystemTrack =
      track.kind === "system" && settings.fileSpeakerDiarization === true;

    try {
      const result = await transcribeFilePathOnly({
        filePath: track.path,
        settings,
        onStatus,
        onProgress,
        speakerDiarization: shouldDiarizeSystemTrack,
      });

      const speakerText = addSpeakerResultToHistoryDraft(
        result,
        speakersById,
        speakerSegments,
        "system",
      );
      if (speakerText) {
        mode = "speakers";
        parts.push(speakerText);
        continue;
      }

      if (shouldDiarizeSystemTrack) {
        throw new Error(tn("callCapture.errDiarizationNoSegments"));
      }

      if (track.kind === "mic") {
        micPlainPart = formatTrackTranscript(track, result.text);
      } else {
        parts.push(formatTrackTranscript(track, result.text));
      }
    } catch (error) {
      const message = toFileTranscriptionErrorMessage(error, { settings });
      failedTracks.push(`${callTrackTitle(track).toLowerCase()}: ${message}`);
      requiredSystemDiarizationFailed =
        requiredSystemDiarizationFailed || shouldDiarizeSystemTrack;
      void logError(
        "CALL_CAPTURE",
        `${track.kind} track transcription failed: ${errorMessage(error)}`,
      );
    }
  }

  if (requiredSystemDiarizationFailed) {
    if (micPathTrack && settings.fileSpeakerDiarization === true) {
      try {
        const micSpeakerResult = await transcribeFilePathOnly({
          filePath: micPathTrack.path,
          settings,
          onStatus,
          onProgress,
          speakerDiarization: true,
        });

        const speakerText = addSpeakerResultToHistoryDraft(
          micSpeakerResult,
          speakersById,
          speakerSegments,
          "micFallback",
        );
        if (speakerText) {
          mode = "speakers";
          parts.push(speakerText);
          usedMicDiarizationFallback = true;
          requiredSystemDiarizationFailed = false;
          void logInfo(
            "CALL_CAPTURE",
            "System track had no diarizable speech; used mic track diarization fallback.",
          );
        }
      } catch (error) {
        const message = toFileTranscriptionErrorMessage(error, { settings });
        failedTracks.push(`${tn("callCapture.trackMic")}: ${message}`);
        void logError(
          "CALL_CAPTURE",
          `Mic track diarization fallback failed: ${errorMessage(error)}`,
        );
      }
    }

    if (requiredSystemDiarizationFailed) {
      throw new Error(failedTracks.join("; "));
    }
  }

  if (micPlainPart && !usedMicDiarizationFallback) {
    parts.unshift(micPlainPart);

    if (speakerSegments.length > 0) {
      const selfSpeakerId = "call_self";
      speakersById.set(selfSpeakerId, { id: selfSpeakerId, label: tn("callCapture.speakerYou") });
      speakerSegments.unshift({
        start: 0,
        end: 0,
        speakerId: selfSpeakerId,
        speakerLabel: tn("callCapture.speakerYou"),
        text: micPlainText(micPlainPart),
      });
    }
  }

  const text = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) {
    throw new Error(
      failedTracks.length > 0
        ? failedTracks.join("; ")
        : tn("callCapture.errNoSpeech"),
    );
  }

  const entry: HistoryEntry = {
    id: overrides?.id ?? crypto.randomUUID(),
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    duration: overrides?.duration ?? 0,
    raw: text,
    cleaned: text,
    source: "call",
    fileName: tn("callCapture.fileName"),
    status: "completed",
    processingTime: startedAt ? Date.now() - startedAt : undefined,
    mode,
    speakers:
      speakersById.size > 0
        ? Array.from(speakersById.values()).sort((left, right) => {
            const youLabel = tn("callCapture.speakerYou");
            if (left.label === youLabel) return -1;
            if (right.label === youLabel) return 1;
            return 0;
          })
        : undefined,
    segments: speakerSegments.length > 0 ? speakerSegments : undefined,
    callSessionId: session.id,
    callTracks: session.tracks.map((track) => ({
      kind: track.kind,
      label: track.label,
      path: track.path,
    })),
  };

  return entry;
}

export async function transcribeCallCaptureSession(
  params: TranscribeCallCaptureSessionParams,
): Promise<HistoryEntry> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const duration = params.startedAt
    ? Math.max(0, Math.round((Date.now() - params.startedAt) / 1000))
    : 0;

  // Show the call as a live "processing" row (with a stop button) while its
  // tracks transcribe — call/file STT can take a long time.
  const baseEntry: HistoryEntry = {
    id,
    timestamp,
    duration,
    raw: "",
    cleaned: "",
    source: "call",
    fileName: tn("callCapture.fileName"),
    status: "processing",
    callSessionId: params.session.id,
    callTracks: params.session.tracks.map((track) => ({
      kind: track.kind,
      label: track.label,
      path: track.path,
    })),
  };

  const interruptedEntry = (): HistoryEntry => ({
    ...baseEntry,
    status: "interrupted",
    errorMessage: callInterruptedMessage(),
  });

  const handle = await beginProcessing(baseEntry, "add");
  params.onStarted?.(id);

  try {
    const built = await buildCallCaptureHistoryEntry(params, { id, timestamp, duration });

    // STT via `invoke` can't be aborted mid-flight; if the user stopped while it
    // ran, discard the late result and mark the row interrupted.
    if (handle.isCancelled()) {
      const interrupted = interruptedEntry();
      await finishProcessing(interrupted);
      return interrupted;
    }

    await finishProcessing(built);
    return built;
  } catch (error) {
    if (handle.isCancelled()) {
      const interrupted = interruptedEntry();
      await finishProcessing(interrupted);
      return interrupted;
    }

    void logError("CALL_CAPTURE", `Call transcription failed: ${errorMessage(error)}`);
    const failed: HistoryEntry = {
      ...baseEntry,
      status: "failed",
      errorMessage: tn("callCapture.errProcessRetry"),
    };
    await finishProcessing(failed);
    return failed;
  } finally {
    handle.finish();
  }
}

function sessionFromHistoryEntry(entry: HistoryEntry): CallCaptureSession {
  return {
    id: entry.callSessionId || entry.id,
    platform: "macos",
    status: "stopped",
    startedAt: entry.timestamp,
    endedAt: null,
    directory: "",
    tracks: (entry.callTracks || []).map((track) => ({
      kind: track.kind,
      label: track.label,
      path: track.path,
      channels: track.kind === "mic" ? 1 : 2,
      sampleRate: 48_000,
    })),
  };
}

export async function retryCallCaptureHistoryEntry(
  entry: HistoryEntry,
  settings: AppSettings,
): Promise<HistoryEntry> {
  if (!entry.callTracks?.length) {
    throw new Error(tn("callCapture.errNoSavedTracks"));
  }

  const session = sessionFromHistoryEntry(entry);
  const handle = await beginProcessing(entry, "update");

  try {
    const updatedEntry = await buildCallCaptureHistoryEntry(
      {
        session,
        settings,
        startedAt: Date.now(),
      },
      {
        id: entry.id,
        timestamp: entry.timestamp,
        duration: entry.duration,
      },
    );

    if (handle.isCancelled()) {
      const interrupted: HistoryEntry = {
        ...entry,
        status: "interrupted",
        errorMessage: callInterruptedMessage(),
      };
      await finishProcessing(interrupted);
      return interrupted;
    }

    await finishProcessing(updatedEntry);
    return updatedEntry;
  } catch (error) {
    if (handle.isCancelled()) {
      const interrupted: HistoryEntry = {
        ...entry,
        status: "interrupted",
        errorMessage: callInterruptedMessage(),
      };
      await finishProcessing(interrupted);
      return interrupted;
    }

    const userFacingMessage = toFileTranscriptionErrorMessage(error, { settings });
    const failedEntry: HistoryEntry = {
      ...entry,
      status: "failed",
      errorMessage: userFacingMessage,
    };

    await finishProcessing(failedEntry);
    void logError("CALL_CAPTURE", `Retry call capture failed: ${errorMessage(error)}`);
    throw new Error(userFacingMessage);
  } finally {
    handle.finish();
  }
}
