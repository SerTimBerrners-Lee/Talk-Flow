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

interface SelectionTranslationBackend {
  kind: SummaryBackendKind;
  run: (params: {
    text: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<string>;
}

export interface SelectionTranslationProgress {
  sourceText: string;
  translatedText: string;
  current: number;
  total: number;
}

export function selectionTranslationLanguageLabel(languageCode: string): string {
  if (languageCode === "auto") {
    return "auto";
  }

  const language = LANGUAGES.find((item) => item.code === languageCode);
  return language ? `${language.native} (${language.name})` : languageCode;
}

export function buildSelectionTranslationPrompt(targetLanguage: string): string {
  return (
    `Переведи текст на язык "${selectionTranslationLanguageLabel(targetLanguage)}". ` +
    "Исходный язык определи автоматически. " +
    "Верни только перевод, без комментариев, пояснений, markdown-оберток, кавычек и новых фактов. " +
    "Сохрани смысл, тон, структуру, переносы строк и форматирование исходного текста. " +
    "Если в тексте есть списки, числа, имена, ссылки, код или технические термины, сохрани их точно, переводя только естественный язык."
  );
}

export async function translateSelectedTextWithBackend({
  text,
  targetLanguage,
  backend,
  onProgress,
}: {
  text: string;
  targetLanguage: string;
  backend: SelectionTranslationBackend;
  onProgress?: (progress: SelectionTranslationProgress) => void;
}): Promise<string> {
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
        text: sourceText,
        prompt,
        temperature: 0.1,
      })
    ).trim();

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
    const chunkPrompt =
      `${prompt}\n\n` +
      `Это фрагмент ${index + 1} из ${chunks.length} длинного выделенного текста. ` +
      "Переведи только этот фрагмент и верни только его перевод. Не упоминай номер фрагмента.";
    const translated = (
      await backend.run({
        text: chunks[index],
        prompt: chunkPrompt,
        temperature: 0.1,
      })
    ).trim();

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

export async function translateSelectedText({
  text,
  settings,
  onProgress,
}: {
  text: string;
  settings: AppSettings;
  onProgress?: (progress: SelectionTranslationProgress) => void;
}): Promise<string> {
  const backend = resolveSummaryBackend(settings);
  if (!backend) {
    throw new Error(tn("widget.selectionTranslation.noModel"));
  }

  const targetLanguage = settings.translation.selectionTargetLanguage;
  logInfo(
    "TRANSLATION",
    `Translating selected text via ${backend.kind}: auto -> ${targetLanguage}, chars=${text.trim().length}`,
  );

  return translateSelectedTextWithBackend({
    text,
    targetLanguage,
    backend,
    onProgress,
  });
}
