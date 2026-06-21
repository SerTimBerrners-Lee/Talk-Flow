// Pure, dependency-free statistics logic for transcribed-words tracking.
//
// Kept free of Tauri / store imports so it can be unit-tested in isolation and
// reused from any window. Persistence and event emission live in `stats.ts`.

export const STATS_VERSION = 1 as const;

/** How many recent transcription ids we remember to de-duplicate re-counts. */
export const COUNTED_IDS_LIMIT = 600;

export type StatSource = "voice" | "file" | "call" | undefined;
export type StatStatus = "processing" | "completed" | "failed" | "interrupted" | undefined;

export interface TranscriptionStats {
  version: number;
  /** Words across every successful transcription, never pruned. */
  allTimeWords: number;
  /** Words bucketed by calendar month, key format `YYYY-MM`. */
  monthlyWords: Record<string, number>;
  /** Words spoken via voice dictation only — basis for the speed metric. */
  voiceWords: number;
  /** Voice dictation seconds accumulated — basis for the speed metric. */
  voiceDurationSec: number;
  /** Bounded ring of already-counted ids, guards against double counting. */
  countedIds: string[];
  updatedAt: string;
}

export interface StatInput {
  id: string;
  text: string;
  source: StatSource;
  durationSec: number;
  timestamp: string;
  status?: StatStatus;
}

export interface TranscriptionStatsView {
  monthWords: number;
  allTimeWords: number;
  /** Average words per minute of voice dictation. */
  averageWpm: number;
  /** Whether enough voice data exists to show a meaningful speed. */
  hasSpeed: boolean;
}

export function createEmptyStats(): TranscriptionStats {
  return {
    version: STATS_VERSION,
    allTimeWords: 0,
    monthlyWords: {},
    voiceWords: 0,
    voiceDurationSec: 0,
    countedIds: [],
    updatedAt: "",
  };
}

/** Repair a value loaded from disk so every field has a usable default. */
export function normalizeStats(
  raw: Partial<TranscriptionStats> | null | undefined,
): TranscriptionStats {
  const base = createEmptyStats();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  return {
    version: STATS_VERSION,
    allTimeWords: Number.isFinite(raw.allTimeWords) ? Number(raw.allTimeWords) : 0,
    monthlyWords:
      raw.monthlyWords && typeof raw.monthlyWords === "object" ? { ...raw.monthlyWords } : {},
    voiceWords: Number.isFinite(raw.voiceWords) ? Number(raw.voiceWords) : 0,
    voiceDurationSec: Number.isFinite(raw.voiceDurationSec) ? Number(raw.voiceDurationSec) : 0,
    countedIds: Array.isArray(raw.countedIds)
      ? raw.countedIds.filter((id) => typeof id === "string")
      : [],
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

// Hiragana/Katakana + CJK Unified (ext A + base) + compatibility ideographs.
const CJK_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/**
 * Count words in a language-robust way: whitespace tokens for alphabetic
 * scripts (Russian, English, ...) plus one word per CJK character, since those
 * scripts are not whitespace-delimited.
 */
export function countWords(text: string): number {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return 0;
  }

  const cjk = (trimmed.match(CJK_REGEX) || []).length;
  const rest = trimmed.replace(CJK_REGEX, " ").trim();
  const restWords = rest ? rest.split(/\s+/).length : 0;
  return cjk + restWords;
}

export function monthKeyOf(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeSource(source: StatSource): "voice" | "file" | "call" {
  return source === "file" || source === "call" ? source : "voice";
}

/**
 * Fold one transcription into the accumulator. Pure: returns the SAME reference
 * when nothing should change (failed, empty, or already counted) so callers can
 * cheaply detect no-ops with `next === prev`.
 */
export function applyTranscriptionToStats(
  stats: TranscriptionStats,
  input: StatInput,
): TranscriptionStats {
  // Count only finished, successful transcriptions (or legacy entries with no
  // status). Skip processing / failed / interrupted.
  if (input.status && input.status !== "completed") {
    return stats;
  }

  const text = (input.text || "").trim();
  if (!text) {
    return stats;
  }

  if (stats.countedIds.includes(input.id)) {
    return stats;
  }

  const words = countWords(text);
  if (words <= 0) {
    return stats;
  }

  const month = monthKeyOf(input.timestamp);
  const source = normalizeSource(input.source);
  const isVoice = source === "voice" && input.durationSec > 0;

  const countedIds = [...stats.countedIds, input.id];
  if (countedIds.length > COUNTED_IDS_LIMIT) {
    countedIds.splice(0, countedIds.length - COUNTED_IDS_LIMIT);
  }

  return {
    ...stats,
    version: STATS_VERSION,
    allTimeWords: stats.allTimeWords + words,
    monthlyWords: {
      ...stats.monthlyWords,
      [month]: (stats.monthlyWords[month] || 0) + words,
    },
    voiceWords: stats.voiceWords + (isVoice ? words : 0),
    voiceDurationSec: stats.voiceDurationSec + (isVoice ? input.durationSec : 0),
    countedIds,
    updatedAt: new Date().toISOString(),
  };
}

/** Zeroed view for first render before persisted stats have loaded. */
export function getEmptyView(): TranscriptionStatsView {
  return { monthWords: 0, allTimeWords: 0, averageWpm: 0, hasSpeed: false };
}

export function statsToView(
  stats: TranscriptionStats,
  now: Date = new Date(),
): TranscriptionStatsView {
  const month = monthKeyOf(now);
  const hasSpeed = stats.voiceDurationSec > 0 && stats.voiceWords > 0;
  const averageWpm = hasSpeed
    ? Math.round(stats.voiceWords / (stats.voiceDurationSec / 60))
    : 0;

  return {
    monthWords: stats.monthlyWords[month] || 0,
    allTimeWords: stats.allTimeWords,
    averageWpm,
    hasSpeed,
  };
}
