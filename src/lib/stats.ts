import { emit } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";

import { logError } from "./logger";
import type { HistoryEntry } from "./store";
import {
  applyTranscriptionToStats,
  getEmptyView,
  normalizeStats,
  statsToView,
  type TranscriptionStats,
  type TranscriptionStatsView,
} from "./statsCore";

export type { TranscriptionStats, TranscriptionStatsView } from "./statsCore";

/** Broadcast after stats change so open windows (e.g. the homepage) refresh. */
export const STATS_UPDATED_EVENT = "stats-updated";

// Stored under its own key in the shared store, separate from `settings` and
// `history`, so it survives history pruning and "clear history".
const STATS_STORE_FILE = "talkis.json";
const STATS_KEY = "stats";

let _store: Awaited<ReturnType<typeof load>> | null = null;

async function statsStore() {
  if (!_store) {
    _store = await load(STATS_STORE_FILE);
  }
  return _store;
}

export async function getTranscriptionStats(): Promise<TranscriptionStats> {
  try {
    const store = await statsStore();
    const raw = await store.get<Partial<TranscriptionStats>>(STATS_KEY);
    return normalizeStats(raw);
  } catch (error) {
    void logError(
      "STATS",
      `Failed to read stats: ${error instanceof Error ? error.message : String(error)}`,
    );
    return normalizeStats(null);
  }
}

export async function getTranscriptionStatsView(): Promise<TranscriptionStatsView> {
  return statsToView(await getTranscriptionStats());
}

/** View shown before stats have loaded (all zeros, no speed yet). */
export { getEmptyView };

/**
 * Record a completed transcription into the running totals. De-duplicates by
 * entry id, ignores failed/empty entries, and never throws — statistics must
 * not be able to break the transcription or history pipeline.
 */
export async function recordTranscriptionStats(
  entry: HistoryEntry,
): Promise<void> {
  try {
    if (
      !entry ||
      (entry.status !== undefined && entry.status !== "completed")
    ) {
      return;
    }
    if (!entry.cleaned || !entry.cleaned.trim()) {
      return;
    }

    const store = await statsStore();
    const current = await getTranscriptionStats();
    const next = applyTranscriptionToStats(current, {
      id: entry.id,
      text: entry.cleaned,
      source: entry.source,
      durationSec:
        typeof entry.duration === "number" && entry.duration > 0
          ? entry.duration
          : 0,
      timestamp: entry.timestamp,
      status: entry.status,
    });

    if (next === current) {
      return; // nothing changed (duplicate / empty)
    }

    await store.set(STATS_KEY, next);
    await store.save();
    await emit(STATS_UPDATED_EVENT);
  } catch (error) {
    void logError(
      "STATS",
      `Failed to record stats: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
