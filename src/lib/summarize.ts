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
const LOCAL_DIRECT_LIMIT_CHARS = 6000;
const LOCAL_MAX_CHUNK_CHARS = 4500;
const MAP_MAX_TOKENS = 260;
const REDUCE_MAX_TOKENS = 360;
const FINAL_MAX_TOKENS = 1200;
export const LOCAL_TEXT_PROCESSING_LIMITS = {
  directChars: LOCAL_DIRECT_LIMIT_CHARS,
  chunkChars: LOCAL_MAX_CHUNK_CHARS,
} as const;

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
  shouldCancel?: () => boolean;
}

export interface ProcessLongTextParams extends SummarizeParams {
  emptyTextError?: string;
  emptyPromptError?: string;
  noModelError?: string;
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
  maxTokens?: number;
  signal?: AbortSignal;
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
  return ({ text, prompt, temperature, signal }) =>
    processTextWithCloudPrompt({ text, prompt, settings, temperature, signal });
}

function llmRunner(endpoint: string, model: string, apiKey: string): RunOnce {
  return async ({ text, prompt, temperature, maxTokens }) => {
    const response = await invoke<ProcessTextResponse>("process_text", {
      req: {
        text,
        prompt,
        temperature: temperature ?? null,
        max_tokens: maxTokens ?? null,
        endpoint: endpoint || null,
        model: model || null,
        api_key: apiKey || null,
      },
    });
    return response.result;
  };
}

function isRestartableLocalLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sending request|connect|connection|refused|closed|terminated|reset|timed out|timeout/i.test(
    message,
  );
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
  return async ({ text, prompt, temperature, maxTokens }) => {
    let lastRestartableError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!baseUrl || attempt > 0) {
        if (attempt > 0) {
          await invoke<void>("stop_local_llm").catch(() => {});
        }
        baseUrl = await invoke<string>("start_local_llm", { modelId });
      }

      try {
        const response = await invoke<ProcessTextResponse>("process_text", {
          req: {
            text,
            prompt,
            temperature: temperature ?? null,
            max_tokens: maxTokens ?? null,
            endpoint: baseUrl || fallbackEndpoint || null,
            model: model || null,
            api_key: apiKey || null,
          },
        });
        return response.result;
      } catch (error) {
        if (!isRestartableLocalLlmError(error)) {
          throw error;
        }
        lastRestartableError = error;
        baseUrl = null;
      }
    }

    const message =
      lastRestartableError instanceof Error
        ? lastRestartableError.message
        : String(lastRestartableError);
    throw new Error(
      `Локальная текстовая модель не смогла обработать фрагмент после нескольких перезапусков runtime. ` +
        `Попробуйте выбрать модель крупнее или облачный режим для длинных записей. Детали: ${message}`,
    );
  };
}

function formatPartialBlocks(blocks: string[]): string {
  return blocks
    .map((partial, index) => `Часть ${index + 1}:\n${partial}`)
    .join("\n\n");
}

function groupBlocksByLimit(blocks: string[], maxChars: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];

  for (const block of blocks) {
    const candidate = [...current, block];
    const candidateLength = formatPartialBlocks(candidate).length;
    if (current.length > 0 && candidateLength > maxChars) {
      groups.push(current);
      current = [block];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

// The bundled local text runtime prefers 127.0.0.1:8011, then falls back to
// 18200–18249 (see src-tauri/src/llm_runtime.rs). It can only auto-start when a
// model is selected (llmLocalModelId); an endpoint in that range with NO selected
// model is a dead port, so we must not treat it as a usable backend.
function isBundledLocalRuntime(endpoint: string): boolean {
  const match = endpoint.match(/:(\d{4,5})(?:\/|$)/);
  if (!match) return false;
  const port = Number(match[1]);
  return port === 8011 || (port >= 18200 && port <= 18249);
}

/**
 * Pick the summary backend from settings: Talkis Cloud subscription, a custom
 * OpenAI-compatible endpoint, or a local runtime (127.0.0.1). Returns null when
 * nothing is configured yet.
 */
export function resolveSummaryBackend(
  settings: AppSettings,
): ResolvedSummaryBackend | null {
  const cloudReady =
    !settings.useOwnKey && Boolean(settings.deviceToken?.trim());
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

  // "none" is the persisted sentinel for an intentionally unselected text
  // model. Never send it to an OpenAI-compatible endpoint as a real model id.
  if (!model || model.toLowerCase() === "none") {
    return null;
  }

  if (endpoint) {
    // Bundled runtime referenced but no model selected → nothing will start it
    // (dead port). Treat as not configured so the UI tells the user to pick a
    // model instead of failing with a raw "error sending request".
    if (isLocal && !localModelId && isBundledLocalRuntime(endpoint)) {
      return null;
    }
    const run =
      isLocal && localModelId
        ? localLlmRunner(localModelId, endpoint, model, apiKey)
        : llmRunner(endpoint, model, apiKey);
    return { kind: isLocal ? "local" : "custom", label: endpoint, run };
  }

  // Own OpenAI key without a custom endpoint.
  if (settings.useOwnKey && apiKey) {
    return {
      kind: "custom",
      label: "OpenAI",
      run: llmRunner("", model, apiKey),
    };
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
  "Ты — опытный prompt-инженер. По данным ниже (название и/или черновик) составь ПОДРОБНУЮ, " +
  "готовую инструкцию-промпт для модели, которая обрабатывает расшифровку разговора или текста " +
  "(саммари, протокол, конспект и т.п.). НАЗВАНИЕ задаёт цель промпта — обязательно учитывай его " +
  "и раскрывай именно эту задачу.\n" +
  "Промпт должен быть детальным и развёрнутым (не короче 6–10 предложений), а не общим в пару строк. " +
  "Обязательно пропиши в нём:\n" +
  "1) роль и цель модели;\n" +
  "2) что именно нужно извлечь и осветить — конкретные пункты под цель из названия " +
  "(например, для урока с учеником: тема занятия, разобранный материал, ошибки и затруднения ученика, " +
  "достигнутый прогресс, домашнее задание, рекомендации; для встречи: решения, задачи, ответственные, сроки);\n" +
  "3) структуру результата — разделы с заголовками и маркированные списки;\n" +
  "4) требуемый уровень детализации, тон и язык вывода (тот же, что у исходного текста);\n" +
  "5) что игнорировать (слова-паразиты, оговорки, посторонние реплики, повторы).\n" +
  "Пиши на языке названия/черновика. НЕ выполняй инструкцию и не обрабатывай никакой текст — " +
  "верни ТОЛЬКО готовый текст промпта, без пояснений, кавычек и преамбул.";

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

export async function runTextMapReduce(
  text: string,
  instruction: string,
  temperature: number | undefined,
  run: RunOnce,
  onProgress?: (progress: SummarizeProgress) => void,
  shouldCancel?: () => boolean,
  limits: { directChars: number; chunkChars: number } = {
    directChars: DIRECT_LIMIT_CHARS,
    chunkChars: MAX_CHUNK_CHARS,
  },
): Promise<string> {
  const trimmed = text.trim();
  const throwIfCancelled = (): void => {
    if (shouldCancel?.()) {
      throw new Error("Саммари остановлено.");
    }
  };

  throwIfCancelled();

  if (trimmed.length <= limits.directChars) {
    onProgress?.({ phase: "single", current: 1, total: 1 });
    const result = await run({
      text: trimmed,
      prompt: instruction,
      temperature,
    });
    throwIfCancelled();
    return result;
  }

  const chunks = splitIntoChunks(trimmed, limits.chunkChars);
  const partials: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    throwIfCancelled();
    onProgress?.({ phase: "map", current: index + 1, total: chunks.length });
    const partial = await run({
      text: chunks[index],
      prompt:
        `${instruction}\n\n` +
        `Это часть ${index + 1} из ${chunks.length} длинного текста. ` +
        "Сейчас НЕ пиши финальное саммари. Извлеки только факты для будущего итогового ответа: " +
        "тема, разобранный материал, ошибки/затруднения, прогресс, домашнее задание, рекомендации, решения и действия — только если они есть в этом фрагменте. " +
        "Верни до 8 коротких маркеров, без вступления, без просьб прислать текст, без выдуманных фактов.",
      temperature,
      maxTokens: MAP_MAX_TOKENS,
    });
    throwIfCancelled();
    partials.push(partial.trim());
  }

  throwIfCancelled();
  onProgress?.({
    phase: "reduce",
    current: chunks.length,
    total: chunks.length,
  });
  let reduceInputs = partials;
  let combined = formatPartialBlocks(reduceInputs);

  while (combined.length > limits.directChars && reduceInputs.length > 1) {
    const groups = groupBlocksByLimit(reduceInputs, limits.directChars);
    if (groups.length <= 1) {
      break;
    }

    const merged: string[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      throwIfCancelled();
      onProgress?.({
        phase: "reduce",
        current: index + 1,
        total: groups.length,
      });
      const partial = await run({
        text: formatPartialBlocks(groups[index]),
        prompt:
          `${instruction}\n\n` +
          `Ниже — группа ${index + 1} из ${groups.length} промежуточных фактов по длинному тексту. ` +
          "Сейчас НЕ пиши финальное саммари. Сожми и объедини факты в до 10 коротких маркеров строго по инструкции. " +
          "Удаляй повторы, не добавляй новых фактов, не проси прислать текст.",
        temperature,
        maxTokens: REDUCE_MAX_TOKENS,
      });
      throwIfCancelled();
      merged.push(partial.trim());
    }

    reduceInputs = merged;
    combined = formatPartialBlocks(reduceInputs);
  }

  const result = await run({
    text: combined,
    prompt:
      `${instruction}\n\n` +
      "Выше указана инструкция. Ниже — факты по частям длинного текста. " +
      "Объедини их в один связный итоговый результат строго по инструкции, без повторов и без новых фактов. " +
      "Не упоминай номера частей и не проси прислать исходный текст.",
    temperature,
    maxTokens: FINAL_MAX_TOKENS,
  });
  throwIfCancelled();
  return result;
}

/**
 * Run an explicit text prompt with automatic chunking for long inputs. This is
 * intentionally generic: chat, summaries, and prompt tools can all route large
 * text through the same bounded calls instead of sending an oversized local LLM
 * request that may kill the runtime.
 */
export async function processLongTextWithPrompt({
  text,
  prompt,
  settings,
  onProgress,
  shouldCancel,
  emptyTextError = tn("summarize.errNoText"),
  emptyPromptError = tn("summarize.errEmptyPrompt"),
  noModelError = tn("summarize.errNoModel"),
}: ProcessLongTextParams): Promise<string> {
  const instruction = prompt.prompt.trim();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error(emptyTextError);
  }
  if (!instruction) {
    throw new Error(emptyPromptError);
  }

  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error(noModelError);
  }

  return runTextMapReduce(
    trimmed,
    instruction,
    prompt.temperature,
    backend.run,
    onProgress,
    shouldCancel,
    backend.kind === "local" ? LOCAL_TEXT_PROCESSING_LIMITS : undefined,
  );
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
  shouldCancel,
}: SummarizeParams): Promise<string> {
  return processLongTextWithPrompt({
    text,
    prompt,
    settings,
    onProgress,
    shouldCancel,
  });
}
