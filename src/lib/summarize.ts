import { AppSettings, HistoryEntry, PromptPreset } from "./store";
import { processTextWithCloudPrompt } from "./cloudTextProcessing";

/** Flatten a transcript history entry to plain text suitable for summarization. */
export function transcriptToText(
  entry: Pick<HistoryEntry, "cleaned" | "mode" | "segments">,
): string {
  if (entry.mode === "speakers" && entry.segments?.length) {
    return entry.segments
      .map((segment) => `${segment.speakerLabel}: ${segment.text}`)
      .join("\n");
  }

  return entry.cleaned ?? "";
}

/**
 * Длинные транскрипты (видео/часовые звонки) не влезают в контекст модели, и
 * облачный proxy вернёт ошибку длины. Поэтому при превышении порога делаем
 * map-reduce: режем текст на части, суммируем каждую (map), затем объединяем
 * частичные выжимки одним финальным проходом (reduce).
 */
const DIRECT_LIMIT_CHARS = 16000;
const MAX_CHUNK_CHARS = 12000;
const CHUNK_OVERLAP_CHARS = 400;

export type SummaryPromptInput = Pick<PromptPreset, "prompt" | "temperature">;

export interface SummarizeParams {
  text: string;
  prompt: SummaryPromptInput;
  settings: AppSettings;
  /** Optional progress callback for the UI (current/total map steps + phase). */
  onProgress?: (progress: SummarizeProgress) => void;
}

export interface SummarizeProgress {
  phase: "map" | "reduce" | "single";
  current: number;
  total: number;
}

/** Whether the text is long enough to trigger map-reduce instead of a single call. */
export function willUseMapReduce(text: string): boolean {
  return text.trim().length > DIRECT_LIMIT_CHARS;
}

/**
 * Split text into overlapping chunks, preferring to break on paragraph or
 * sentence boundaries near the limit so chunks stay readable.
 */
export function splitIntoChunks(
  text: string,
  maxChars: number = MAX_CHUNK_CHARS,
  overlap: number = CHUNK_OVERLAP_CHARS,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);

    if (end < trimmed.length) {
      // Look for a clean break in the last fifth of the window.
      const windowStart = start + Math.floor(maxChars * 0.8);
      const slice = trimmed.slice(windowStart, end);
      const breakRel = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );

      if (breakRel > 0) {
        end = windowStart + breakRel + 1;
      }
    }

    const chunk = trimmed.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= trimmed.length) {
      break;
    }

    // Always advance to avoid an infinite loop when overlap >= chunk size.
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

/**
 * Summarize/process a transcript through the Talkis Cloud proxy using the given
 * prompt. Falls back to map-reduce for long transcripts.
 */
export async function summarizeWithCloud({
  text,
  prompt,
  settings,
  onProgress,
}: SummarizeParams): Promise<string> {
  const instruction = prompt.prompt.trim();
  const temperature = prompt.temperature;
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("Нет текста для обработки");
  }
  if (!instruction) {
    throw new Error("Промпт пустой");
  }

  if (trimmed.length <= DIRECT_LIMIT_CHARS) {
    onProgress?.({ phase: "single", current: 1, total: 1 });
    return processTextWithCloudPrompt({
      text: trimmed,
      prompt: instruction,
      settings,
      temperature,
    });
  }

  const chunks = splitIntoChunks(trimmed);
  const partials: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({ phase: "map", current: index + 1, total: chunks.length });
    const partial = await processTextWithCloudPrompt({
      text: chunks[index],
      prompt:
        `${instruction}\n\n` +
        `Это часть ${index + 1} из ${chunks.length} длинной расшифровки. ` +
        "Сделай по ней краткие тезисы — позже части объединят в общий результат. " +
        "Не выдумывай то, чего нет в тексте.",
      settings,
      temperature,
    });
    partials.push(partial.trim());
  }

  onProgress?.({ phase: "reduce", current: chunks.length, total: chunks.length });
  const combined = partials
    .map((partial, index) => `Часть ${index + 1}:\n${partial}`)
    .join("\n\n");

  return processTextWithCloudPrompt({
    text: combined,
    prompt:
      `${instruction}\n\n` +
      "Выше указана инструкция. Ниже — тезисы по частям длинной расшифровки. " +
      "Объедини их в один связный результат строго по инструкции, без повторов и без новых фактов.",
    settings,
    temperature,
  });
}
