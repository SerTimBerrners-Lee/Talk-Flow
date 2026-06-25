import { invoke } from "@tauri-apps/api/core";

import { AppSettings, HistoryEntry } from "./store";
import { processTextWithCloudPrompt } from "./cloudTextProcessing";
import { tn } from "./i18n";

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
 * Runner for the BUNDLED local runtime. The sidecar process dies when the app
 * is closed, but `llmEndpoint` stays persisted — so a summary after restart hits
 * a dead port ("error sending request"). We (re)start the runtime first via
 * `start_local_llm` (idempotent: returns immediately with the live base URL if
 * already running) and use whatever port it reports, since it can change.
 */
function localLlmRunner(
  modelId: string,
  fallbackEndpoint: string,
  model: string,
  apiKey: string,
): RunOnce {
  let baseUrl: string | null = null;
  return async ({ text, prompt, temperature }) => {
    if (!baseUrl) {
      baseUrl = await invoke<string>("start_local_llm", { modelId });
    }
    const response = await invoke<ProcessTextResponse>("process_text", {
      req: {
        text,
        prompt,
        temperature: temperature ?? null,
        endpoint: baseUrl || fallbackEndpoint || null,
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
  // Only the BUNDLED runtime can be auto-(re)started; a user's own local server
  // (Ollama/LM Studio) has no marker, so we just use its endpoint as-is.
  const localModelId = settings.llmLocalModelId?.trim() ?? "";

  if (endpoint) {
    const run =
      isLocal && localModelId
        ? localLlmRunner(localModelId, endpoint, model, apiKey)
        : llmRunner(endpoint, model, apiKey);
    return { kind: isLocal ? "local" : "custom", label: endpoint, run };
  }

  // Own OpenAI key without a custom endpoint.
  if (settings.useOwnKey && apiKey) {
    return { kind: "custom", label: "OpenAI", run: llmRunner("", model, apiKey) };
  }

  return null;
}

/**
 * True when summarization can run with the current settings — i.e. a text
 * backend is resolvable (cloud sign-in, a custom API, or a local runtime).
 * When false, summary triggers should be disabled and the user pointed at the
 * «Models» tab to pick a text model.
 */
export function isSummaryAvailable(settings: AppSettings): boolean {
  return resolveSummaryBackend(settings) !== null;
}

const GENERATE_PROMPT_INSTRUCTION =
  "Ты — опытный prompt-инженер. По данным ниже (название и/или черновик) составь готовую " +
  "инструкцию-промпт для модели, которая обрабатывает расшифровку разговора или текста " +
  "(саммари и т.п.). НАЗВАНИЕ задаёт цель промпта — обязательно учитывай его. Сделай " +
  "инструкцию чёткой, конкретной и однозначной, на языке названия/черновика. НЕ выполняй " +
  "инструкцию и не обрабатывай никакой текст — верни ТОЛЬКО готовый текст промпта, без " +
  "пояснений, кавычек и преамбул.";

/**
 * Generate a prompt instruction from its title and/or draft body using whichever
 * text backend is configured (cloud / local runtime / custom endpoint). The title
 * feeds the generation (it states the prompt's goal). Used by the «Сгенерировать
 * промпт» button; requires a backend ({@link isSummaryAvailable}).
 */
export async function generatePromptText(
  settings: AppSettings,
  input: { title?: string; draft?: string },
): Promise<string> {
  const title = (input.title ?? "").trim();
  const draft = (input.draft ?? "").trim();
  if (!title && !draft) {
    throw new Error(tn("summarize.errEmptyPrompt"));
  }
  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error(tn("summarize.errNoModel"));
  }
  const payload = [
    title ? `Название промпта: ${title}` : null,
    draft ? `Черновик промпта:\n${draft}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const generated = await backend.run({
    text: payload,
    prompt: GENERATE_PROMPT_INSTRUCTION,
    temperature: 0.4,
  });
  return generated.trim();
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
    throw new Error(tn("summarize.errNoText"));
  }
  if (!instruction) {
    throw new Error(tn("summarize.errEmptyPrompt"));
  }

  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error(tn("summarize.errNoModel"));
  }

  return runMapReduce(
    trimmed,
    instruction,
    prompt.temperature,
    backend.run,
    onProgress,
  );
}
