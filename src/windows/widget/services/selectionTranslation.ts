import { invoke } from "@tauri-apps/api/core";

import type { AppSettings } from "../../../lib/store";
import { tn } from "../../../lib/i18n";
import { logInfo } from "../../../lib/logger";
import {
  LOCAL_TEXT_PROCESSING_LIMITS,
  resolveSummaryBackend,
  splitIntoChunks,
  type SummaryBackendKind,
} from "../../../lib/summarize";
import { LANGUAGES } from "../../../config/languages";

const DIRECT_LIMIT_CHARS = 12000;
const CHUNK_LIMIT_CHARS = 9000;
const NLLB_TRANSLATOR_PROVIDER = "nllb-200";
const OPUS_RU_EN_TRANSLATOR_PROVIDER = "opus-mt-ru-en";
const LEGACY_LOCAL_TRANSLATOR_PROVIDER = "trad";
const TRANSLATION_SOURCE_START = "<<<TALKIS_TRANSLATION_SOURCE>>>";
const TRANSLATION_SOURCE_END = "<<<END_TALKIS_TRANSLATION_SOURCE>>>";

interface SelectionTranslationBackend {
  kind: SummaryBackendKind | "localTranslator";
  run: (params: {
    text: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }) => Promise<string>;
}

interface LocalTranslatorInfo {
  provider: string;
  status: "not_installed" | "downloading" | "ready" | "error";
  message?: string | null;
}

interface LocalTranslatorRequest {
  provider: string;
  text: string;
  source_language: string;
  target_language: string;
}

interface SelectionTranslationDependencies {
  resolveSummaryBackend?: typeof resolveSummaryBackend;
  listLocalTranslators?: () => Promise<LocalTranslatorInfo[]>;
  translateWithLocalTranslator?: (
    req: LocalTranslatorRequest,
  ) => Promise<string>;
}

export interface SelectionTranslationProgress {
  sourceText: string;
  translatedText: string;
  current: number;
  total: number;
}

function throwIfTranslationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Selection translation superseded", "AbortError");
  }
}

export function selectionTranslationLanguageLabel(
  languageCode: string,
): string {
  if (languageCode === "auto") {
    return "auto";
  }

  const language = LANGUAGES.find((item) => item.code === languageCode);
  return language ? `${language.native} (${language.name})` : languageCode;
}

export function buildSelectionTranslationPrompt(
  targetLanguage: string,
): string {
  return (
    `Переведи текст на язык "${selectionTranslationLanguageLabel(targetLanguage)}". ` +
    "Исходный язык определи автоматически. " +
    "Верни только перевод, без комментариев, пояснений, markdown-оберток, кавычек и новых фактов. " +
    "Не проси пользователя предоставить текст: текст уже передан в сообщении пользователя. " +
    `Если текст передан между маркерами ${TRANSLATION_SOURCE_START} и ${TRANSLATION_SOURCE_END}, переводи только содержимое между маркерами, сами маркеры и заголовок не выводи. ` +
    "Если исходный текст уже на целевом языке, верни исходный текст без изменений. " +
    "Сохрани смысл, тон, структуру, переносы строк и форматирование исходного текста. " +
    "Если в тексте есть списки, числа, имена, ссылки, код или технические термины, сохрани их точно, переводя только естественный язык."
  );
}

export function buildSelectionTranslationSourcePayload(
  sourceText: string,
): string {
  return [
    "ТЕКСТ ДЛЯ ПЕРЕВОДА:",
    TRANSLATION_SOURCE_START,
    sourceText,
    TRANSLATION_SOURCE_END,
  ].join("\n");
}

function textForSelectionTranslationBackend(
  backend: SelectionTranslationBackend,
  sourceText: string,
): string {
  return backend.kind === "localTranslator"
    ? sourceText
    : buildSelectionTranslationSourcePayload(sourceText);
}

export async function translateSelectedTextWithBackend({
  text,
  targetLanguage,
  backend,
  onProgress,
  signal,
}: {
  text: string;
  targetLanguage: string;
  backend: SelectionTranslationBackend;
  onProgress?: (progress: SelectionTranslationProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfTranslationAborted(signal);
  const sourceText = text.trim();
  if (!sourceText) {
    throw new Error(tn("widget.selectionTranslation.noSelection"));
  }

  const prompt = buildSelectionTranslationPrompt(targetLanguage);
  const limits =
    backend.kind === "local"
      ? LOCAL_TEXT_PROCESSING_LIMITS
      : { directChars: DIRECT_LIMIT_CHARS, chunkChars: CHUNK_LIMIT_CHARS };

  if (sourceText.length <= limits.directChars) {
    const translated = (
      await backend.run({
        text: textForSelectionTranslationBackend(backend, sourceText),
        prompt,
        temperature: 0.1,
        signal,
      })
    ).trim();
    throwIfTranslationAborted(signal);

    if (!translated) {
      throw new Error(tn("widget.selectionTranslation.emptyResult"));
    }

    onProgress?.({
      sourceText,
      translatedText: translated,
      current: 1,
      total: 1,
    });

    return translated;
  }

  const chunks = splitIntoChunks(sourceText, limits.chunkChars, 0);
  const translatedChunks: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    throwIfTranslationAborted(signal);
    const chunkPrompt =
      `${prompt}\n\n` +
      `Это фрагмент ${index + 1} из ${chunks.length} длинного выделенного текста. ` +
      "Переведи только этот фрагмент и верни только его перевод. Не упоминай номер фрагмента.";
    const translated = (
      await backend.run({
        text: textForSelectionTranslationBackend(backend, chunks[index]),
        prompt: chunkPrompt,
        temperature: 0.1,
        signal,
      })
    ).trim();
    throwIfTranslationAborted(signal);

    if (!translated) {
      throw new Error(tn("widget.selectionTranslation.emptyResult"));
    }

    translatedChunks.push(translated);
    onProgress?.({
      sourceText,
      translatedText: translatedChunks.join("\n\n").trim(),
      current: index + 1,
      total: chunks.length,
    });
  }

  return translatedChunks.join("\n\n").trim();
}

async function listLocalTranslators(): Promise<LocalTranslatorInfo[]> {
  return invoke<LocalTranslatorInfo[]>("list_local_translators");
}

async function translateWithLocalTranslator(
  req: LocalTranslatorRequest,
): Promise<string> {
  return invoke<string>("translate_with_local_translator", { req });
}

function resolveLocalTranslatorProvider(provider: string): string | null {
  if (provider === LEGACY_LOCAL_TRANSLATOR_PROVIDER) {
    return NLLB_TRANSLATOR_PROVIDER;
  }
  if (
    provider === NLLB_TRANSLATOR_PROVIDER ||
    provider === OPUS_RU_EN_TRANSLATOR_PROVIDER
  ) {
    return provider;
  }
  return null;
}

async function resolveLocalTranslatorBackend(
  settings: AppSettings,
  targetLanguage: string,
  deps: SelectionTranslationDependencies,
): Promise<SelectionTranslationBackend | null> {
  const selectedProvider = resolveLocalTranslatorProvider(
    settings.translation.selectionLocalTranslatorProvider,
  );
  if (!selectedProvider) {
    return null;
  }

  const list = deps.listLocalTranslators || listLocalTranslators;
  const translate =
    deps.translateWithLocalTranslator || translateWithLocalTranslator;

  let translators: LocalTranslatorInfo[];
  try {
    translators = await list();
  } catch (err) {
    logInfo(
      "TRANSLATION",
      `${selectedProvider} unavailable, list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  const localTranslator = translators.find(
    (item) => item.provider === selectedProvider,
  );
  if (!localTranslator || localTranslator.status !== "ready") {
    const reason = localTranslator
      ? `${localTranslator.status}${localTranslator.message ? `: ${localTranslator.message}` : ""}`
      : "not listed";
    logInfo(
      "TRANSLATION",
      `${selectedProvider} unavailable, fallback candidate: ${reason}`,
    );
    return null;
  }

  return {
    kind: "localTranslator",
    run: async ({ text }) =>
      translate({
        provider: selectedProvider,
        text,
        source_language: "auto",
        target_language: targetLanguage,
      }),
  };
}

function resolveLlmTranslationBackend(
  settings: AppSettings,
  deps: SelectionTranslationDependencies,
): SelectionTranslationBackend | null {
  const resolveBackend = deps.resolveSummaryBackend || resolveSummaryBackend;
  return resolveBackend(settings);
}

export async function translateSelectedText({
  text,
  settings,
  onProgress,
  signal,
  deps = {},
}: {
  text: string;
  settings: AppSettings;
  onProgress?: (progress: SelectionTranslationProgress) => void;
  signal?: AbortSignal;
  deps?: SelectionTranslationDependencies;
}): Promise<string> {
  throwIfTranslationAborted(signal);
  const targetLanguage = settings.translation.selectionTargetLanguage;
  const selectedLocalProvider =
    resolveLocalTranslatorProvider(
      settings.translation.selectionLocalTranslatorProvider,
    ) || settings.translation.selectionLocalTranslatorProvider;
  const localTranslatorBackend = await resolveLocalTranslatorBackend(
    settings,
    targetLanguage,
    deps,
  );
  throwIfTranslationAborted(signal);
  const llmBackend = (): SelectionTranslationBackend | null =>
    resolveLlmTranslationBackend(settings, deps);

  if (localTranslatorBackend) {
    logInfo(
      "TRANSLATION",
      `Translating selected text via ${selectedLocalProvider}: auto -> ${targetLanguage}, chars=${text.trim().length}`,
    );
    try {
      return await translateSelectedTextWithBackend({
        text,
        targetLanguage,
        backend: localTranslatorBackend,
        onProgress,
        signal,
      });
    } catch (err) {
      throwIfTranslationAborted(signal);
      logInfo(
        "TRANSLATION",
        `${selectedLocalProvider} failed, trying LLM fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      const fallbackBackend = llmBackend();
      if (!fallbackBackend) {
        throw new Error(tn("widget.selectionTranslation.noModel"));
      }
      logInfo(
        "TRANSLATION",
        `Translating selected text via nllb_fallback_llm (${fallbackBackend.kind}): auto -> ${targetLanguage}, chars=${text.trim().length}`,
      );
      return translateSelectedTextWithBackend({
        text,
        targetLanguage,
        backend: fallbackBackend,
        onProgress,
        signal,
      });
    }
  }

  const backend = llmBackend();
  if (!backend) {
    throw new Error(tn("widget.selectionTranslation.noModel"));
  }

  logInfo(
    "TRANSLATION",
    `Translating selected text via llm (${backend.kind}): auto -> ${targetLanguage}, chars=${text.trim().length}`,
  );

  return translateSelectedTextWithBackend({
    text,
    targetLanguage,
    backend,
    onProgress,
    signal,
  });
}
