import { invoke } from "@tauri-apps/api/core";

import { AppSettings, HistoryEntry } from "./store";
import { processTextWithCloudPrompt } from "./cloudTextProcessing";

/**
 * Long transcripts (videos / hour-long calls) don't fit a model's context, so
 * we map-reduce: split the text, summarize each part (map), then merge the
 * partial summaries in one final pass (reduce). The same logic is reused across
 * backends (Talkis Cloud, a bundled local runtime, or a custom endpoint).
 */
const DIRECT_LIMIT_CHARS = 16000;
const MAX_CHUNK_CHARS = 12000;
const CHUNK_OVERLAP_CHARS = 400;

export type SummaryPromptInput = { prompt: string; temperature?: number };
export type SummaryBackendKind = "cloud" | "custom" | "local";

export interface SummarizeProgress {
  phase: "map" | "reduce" | "single";
  current: number;
  total: number;
}

export interface SummarizeParams {
  text: string;
  prompt: SummaryPromptInput;
  settings: AppSettings;
  onProgress?: (progress: SummarizeProgress) => void;
}

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

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

type RunOnce = (params: {
  text: string;
  prompt: string;
  temperature?: number;
}) => Promise<string>;

export interface ResolvedSummaryBackend {
  kind: SummaryBackendKind;
  label: string;
  run: RunOnce;
}

interface ProcessTextResponse {
  result: string;
}

function cloudRunner(settings: AppSettings): RunOnce {
  return ({ text, prompt, temperature }) =>
    processTextWithCloudPrompt({ text, prompt, settings, temperature });
}

function llmRunner(endpoint: string, model: string, apiKey: string): RunOnce {
  return async ({ text, prompt, temperature }) => {
    const response = await invoke<ProcessTextResponse>("process_text", {
      req: {
        text,
        prompt,
        temperature: temperature ?? null,
        endpoint: endpoint || null,
        model: model || null,
        api_key: apiKey || null,
      },
    });
    return response.result;
  };
}

/**
 * Pick the summary backend from settings: Talkis Cloud subscription, a custom
 * OpenAI-compatible endpoint, or a local runtime (127.0.0.1). Returns null when
 * nothing is configured yet.
 */
export function resolveSummaryBackend(
  settings: AppSettings,
): ResolvedSummaryBackend | null {
  const cloudReady = !settings.useOwnKey && Boolean(settings.deviceToken?.trim());
  if (cloudReady) {
    return { kind: "cloud", label: "Talkis Cloud", run: cloudRunner(settings) };
  }

  const endpoint = settings.llmEndpoint?.trim() ?? "";
  const model = settings.llmModel?.trim() ?? "";
  const apiKey = (settings.llmApiKey?.trim() || settings.apiKey?.trim()) ?? "";
  const isLocal = /127\.0\.0\.1|localhost/i.test(endpoint);

  if (endpoint) {
    return {
      kind: isLocal ? "local" : "custom",
      label: endpoint,
      run: llmRunner(endpoint, model, apiKey),
    };
  }

  // Own OpenAI key without a custom endpoint.
  if (settings.useOwnKey && apiKey) {
    return { kind: "custom", label: "OpenAI", run: llmRunner("", model, apiKey) };
  }

  return null;
}

async function runMapReduce(
  text: string,
  instruction: string,
  temperature: number | undefined,
  run: RunOnce,
  onProgress?: (progress: SummarizeProgress) => void,
): Promise<string> {
  const trimmed = text.trim();

  if (trimmed.length <= DIRECT_LIMIT_CHARS) {
    onProgress?.({ phase: "single", current: 1, total: 1 });
    return run({ text: trimmed, prompt: instruction, temperature });
  }

  const chunks = splitIntoChunks(trimmed);
  const partials: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({ phase: "map", current: index + 1, total: chunks.length });
    const partial = await run({
      text: chunks[index],
      prompt:
        `${instruction}\n\n` +
        `Это часть ${index + 1} из ${chunks.length} длинной расшифровки. ` +
        "Сделай по ней краткие тезисы — позже части объединят в общий результат. " +
        "Не выдумывай то, чего нет в тексте.",
      temperature,
    });
    partials.push(partial.trim());
  }

  onProgress?.({ phase: "reduce", current: chunks.length, total: chunks.length });
  const combined = partials
    .map((partial, index) => `Часть ${index + 1}:\n${partial}`)
    .join("\n\n");

  return run({
    text: combined,
    prompt:
      `${instruction}\n\n` +
      "Выше указана инструкция. Ниже — тезисы по частям длинной расшифровки. " +
      "Объедини их в один связный результат строго по инструкции, без повторов и без новых фактов.",
    temperature,
  });
}

/**
 * Summarize/process a transcript with the given prompt through whichever backend
 * is configured (cloud, custom endpoint, or local runtime). Long transcripts use
 * map-reduce automatically.
 */
export async function summarizeTranscript({
  text,
  prompt,
  settings,
  onProgress,
}: SummarizeParams): Promise<string> {
  const instruction = prompt.prompt.trim();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("Нет текста для обработки");
  }
  if (!instruction) {
    throw new Error("Промпт пустой");
  }

  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error(
      "Нет доступной модели для summary: войдите в Talkis Cloud или укажите текстовую модель во вкладке «Модели».",
    );
  }

  return runMapReduce(
    trimmed,
    instruction,
    prompt.temperature,
    backend.run,
    onProgress,
  );
}
