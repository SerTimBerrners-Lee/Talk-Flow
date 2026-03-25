import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import { addHistoryEntry, AppSettings } from "../../../lib/store";
import { logError, logInfo } from "../../../lib/logger";
import { HISTORY_UPDATED_EVENT } from "../../../lib/hotkeyEvents";

export interface ProcessRecordingBlobParams {
  blob: Blob;
  settings: AppSettings;
  recordingStartTimestamp: number;
}

export interface ProcessRecordingBlobResult {
  durationSeconds: number;
  hasTranscription: boolean;
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

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function processRecordingBlob({
  blob,
  settings,
  recordingStartTimestamp,
}: ProcessRecordingBlobParams): Promise<ProcessRecordingBlobResult> {
  const buffer = await blob.arrayBuffer();
  const base64Audio = arrayBufferToBase64(buffer);
  const durationSeconds = Math.floor((Date.now() - recordingStartTimestamp) / 1000);

  logInfo(
    "API",
    `Sending to backend, audio_size: ${base64Audio.length} chars, duration: ${durationSeconds}s`,
  );

  const result = await invoke<{ raw: string; cleaned: string }>("transcribe_and_clean", {
    req: {
      audio_base64: base64Audio,
      language: settings.language,
      api_key: settings.apiKey,
      style: settings.style || "classic",
      whisper_endpoint: settings.whisperEndpoint || null,
      llm_endpoint: settings.llmEndpoint || null,
    },
  });

  if (!result.raw.trim() && !result.cleaned.trim()) {
    logInfo("API", "Nothing recognized, skipping history save and paste");
    return { durationSeconds, hasTranscription: false };
  }

  logInfo("API", `Transcription complete: "${result.cleaned}"`);
  const historyEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    duration: durationSeconds,
    raw: result.raw,
    cleaned: result.cleaned,
  };

  try {
    await addHistoryEntry(historyEntry);
    logInfo("HISTORY", "History entry saved");
    await emit(HISTORY_UPDATED_EVENT, historyEntry);
  } catch (historyError) {
    logError("HISTORY", `Failed to save entry: ${formatErrorMessage(historyError)}`);
  }

  logInfo("PASTE", "Sending cleaned text to paste_text");
  await invoke("paste_text", { text: result.cleaned });
  logInfo("PASTE", "paste_text finished successfully");

  return { durationSeconds, hasTranscription: true };
}
