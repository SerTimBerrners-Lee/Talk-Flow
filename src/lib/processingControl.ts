import { emit } from "@tauri-apps/api/event";

import { addHistoryEntry, updateHistoryEntry, type HistoryEntry } from "./store";
import { HISTORY_UPDATED_EVENT } from "./hotkeyEvents";
import { logError, logInfo } from "./logger";
import { tn } from "./i18n";

// Cancellation registry for in-flight transcription jobs. Lives in the widget
// process (where all transcription runs). The history table in the Settings
// window triggers cancellation by emitting PROCESSING_CANCEL_REQUEST_EVENT,
// which the widget forwards to cancelProcessing().

const interruptedMessage = (): string => tn("processing.interrupted");

interface ActiveProcessing {
  cancelled: boolean;
  abort: AbortController;
  /** The persisted "processing" entry, used to flip the row to interrupted instantly. */
  entry: HistoryEntry;
}

const active = new Map<string, ActiveProcessing>();

export interface ProcessingHandle {
  readonly id: string;
  /** Pass to fetch() so cloud requests are truly aborted on cancel. */
  readonly signal: AbortSignal;
  /** True once the user (or a forced stop) cancelled this job. */
  isCancelled(): boolean;
  /** Remove the job from the registry. Call in a finally block. */
  finish(): void;
}

async function persist(entry: HistoryEntry, mode: "add" | "update"): Promise<void> {
  if (mode === "add") {
    await addHistoryEntry(entry);
  } else {
    await updateHistoryEntry(entry);
  }
  await emit(HISTORY_UPDATED_EVENT, entry);
}

/**
 * Mark an entry "processing", persist it (so it appears as a live row in the
 * history table), and register it for cancellation.
 *
 * @param mode "add" for a brand-new recording, "update" when re-processing an
 *             already-stored entry.
 */
export async function beginProcessing(
  entry: HistoryEntry,
  mode: "add" | "update",
): Promise<ProcessingHandle> {
  // Drop any stale controller for this id (e.g. a fast second retry).
  active.get(entry.id)?.abort.abort();

  const abort = new AbortController();

  const processingEntry: HistoryEntry = {
    ...entry,
    status: "processing",
    errorMessage: undefined,
  };
  active.set(entry.id, { cancelled: false, abort, entry: processingEntry });
  await persist(processingEntry, mode);
  logInfo("PROCESSING", `Started entry=${entry.id} source=${entry.source ?? "voice"}`);

  return {
    id: entry.id,
    signal: abort.signal,
    isCancelled: () => active.get(entry.id)?.cancelled ?? false,
    finish: () => {
      active.delete(entry.id);
    },
  };
}

/** Persist a terminal state (completed / failed / interrupted) and notify. */
export async function finishProcessing(entry: HistoryEntry): Promise<void> {
  await persist(entry, "update");
  logInfo("PROCESSING", `Settled entry=${entry.id} status=${entry.status ?? "completed"}`);
}

/**
 * Request cancellation of an in-flight job. Safe to call repeatedly (only the
 * first call has an effect). The row is flipped to "interrupted" IMMEDIATELY —
 * without waiting for the underlying job to settle — because a local STT
 * `invoke` keeps running after abort and would otherwise leave the row spinning
 * until it finishes, making users click stop repeatedly.
 */
export async function cancelProcessing(entryId: string): Promise<boolean> {
  const item = active.get(entryId);
  if (!item) {
    return false;
  }
  if (item.cancelled) {
    return true; // already cancelling — ignore extra clicks
  }

  item.cancelled = true;
  item.abort.abort();
  logInfo("PROCESSING", `Cancellation requested for entry=${entryId}`);

  try {
    await persist(
      { ...item.entry, status: "interrupted", errorMessage: interruptedMessage() },
      "update",
    );
  } catch (error) {
    void logError(
      "PROCESSING",
      `Failed to flag entry interrupted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return true;
}

export function isProcessingActive(entryId: string): boolean {
  return active.has(entryId);
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}
