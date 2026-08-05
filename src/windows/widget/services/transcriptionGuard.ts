export interface TranscriptionText {
  raw: string;
  cleaned: string;
}

export interface AudioSignalStats {
  peak: number;
  rms: number;
}

export type TranscriptionRejectionReason =
  | "empty"
  | "known-silence-hallucination"
  | "unexpected-short-script";

export interface GuardedTranscription<T extends TranscriptionText> {
  transcription: T | null;
  rejectionReason: TranscriptionRejectionReason | null;
  cleanedFallbackReason: TranscriptionRejectionReason | null;
}

const KNOWN_SILENCE_HALLUCINATIONS = new Set([
  "продолжение следует",
  "to be continued",
  "спасибо за просмотр",
  "thanks for watching",
  "извините я не могу помочь с этой просьбой",
  "извините но я не могу помочь с этой просьбой",
  "i am sorry i cannot help with this request",
  "i m sorry i can t help with this request",
]);

function normalizeTranscript(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isKnownSilenceHallucination(normalized: string): boolean {
  if (KNOWN_SILENCE_HALLUCINATIONS.has(normalized)) {
    return true;
  }

  return (
    /^извините(?: но)? я не могу (?:помочь(?: с (?:этой|данной) просьбой)?|выполнить (?:эту|данную) просьбу)$/u.test(
      normalized,
    ) ||
    /^(?:i am|i m) sorry (?:but )?i (?:cannot|can t) (?:help|assist)(?: with (?:this|that) request)?$/u.test(
      normalized,
    )
  );
}

function isUnexpectedShortHangul(
  normalized: string,
  language: string,
): boolean {
  const selectedLanguage = language.trim().toLowerCase();
  if (selectedLanguage === "auto" || selectedLanguage === "ko") {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  return (
    normalized.length <= 32 &&
    tokens.length <= 3 &&
    /\p{Script=Hangul}/u.test(normalized) &&
    /^[\p{Script=Hangul}\p{N}\s]+$/u.test(normalized)
  );
}

function rejectionReasonForText(
  value: string,
  language: string,
): TranscriptionRejectionReason | null {
  const normalized = normalizeTranscript(value);
  if (!normalized) {
    return "empty";
  }
  if (isKnownSilenceHallucination(normalized)) {
    return "known-silence-hallucination";
  }
  if (isUnexpectedShortHangul(normalized, language)) {
    return "unexpected-short-script";
  }
  return null;
}

export function guardTranscriptionResult<T extends TranscriptionText>(
  transcription: T,
  language: string,
): GuardedTranscription<T> {
  const raw = transcription.raw.trim();
  const cleaned = transcription.cleaned.trim();
  const rawReason = rejectionReasonForText(raw, language);
  const cleanedReason = rejectionReasonForText(cleaned, language);

  if (raw && rawReason) {
    return {
      transcription: null,
      rejectionReason: rawReason,
      cleanedFallbackReason: null,
    };
  }

  if (!raw && cleanedReason) {
    return {
      transcription: null,
      rejectionReason: cleanedReason,
      cleanedFallbackReason: null,
    };
  }

  if (!raw && !cleaned) {
    return {
      transcription: null,
      rejectionReason: "empty",
      cleanedFallbackReason: null,
    };
  }

  if (raw && cleanedReason) {
    return {
      transcription: {
        ...transcription,
        raw,
        cleaned: raw,
      },
      rejectionReason: null,
      cleanedFallbackReason: cleanedReason,
    };
  }

  return {
    transcription: {
      ...transcription,
      raw,
      cleaned: cleaned || raw,
    },
    rejectionReason: null,
    cleanedFallbackReason: null,
  };
}

export function isClearlySilentAudio(
  stats: AudioSignalStats | null | undefined,
): boolean {
  if (!stats) return false;
  if (!Number.isFinite(stats.peak) || !Number.isFinite(stats.rms)) return false;
  return stats.peak < 0.001 && stats.rms < 0.0001;
}
