import type { HistoryEntry } from "./store";
import { formatDurationMs } from "./utils";

export interface DevChatHistoryContext {
  directAnswer?: string;
  contextText?: string;
  sources?: DevChatHistorySource[];
}

export interface DevChatHistorySource {
  entryId: string;
  index: number;
  title: string;
  meta: string;
  preview: string;
}

type UiLanguage = "ru" | "en";
type HistorySource = NonNullable<HistoryEntry["source"]>;

interface HistoryQuestionFilters {
  source?: HistorySource;
  date?: "today" | "yesterday" | "week" | "month";
  fileName?: string;
  speaker?: string;
}

interface ScoredHistoryEntry {
  entryId: string;
  score: number;
  text: string;
  chunks: HistorySearchChunk[];
  timestamp: string;
  source: HistorySource;
  fileName?: string;
  speaker?: string;
  duration: number;
  allowLongContext?: boolean;
}

export interface HistorySearchChunk {
  entryId: string;
  chunkId: string;
  contentHash: string;
  timestamp: string;
  source: HistorySource;
  fileName?: string;
  speaker?: string;
  duration: number;
  text: string;
  embedding?: number[];
}

const MAX_CONTEXT_ENTRIES = 6;
const MAX_ENTRY_CONTEXT_CHARS = 1600;
const MAX_FOCUSED_ENTRY_CONTEXT_CHARS = 8_000;
const MAX_TOTAL_CONTEXT_CHARS = 10_000;
const SEARCH_CHUNK_MAX_CHARS = 1400;
const SEARCH_CHUNK_OVERLAP_CHARS = 180;
const MIN_VECTOR_SIMILARITY = 0.72;
const SEARCH_INDEX_DB_NAME = "talkis-dev-chat-history-index";
const SEARCH_INDEX_DB_VERSION = 1;
const SEARCH_INDEX_STORE_NAME = "chunks";
const SEARCH_INDEX_KEY = "current";

const RU_STOP_WORDS = new Set([
  "а",
  "в",
  "во",
  "говорил",
  "говорили",
  "говорить",
  "где",
  "для",
  "и",
  "или",
  "как",
  "какая",
  "какие",
  "какой",
  "когда",
  "мне",
  "на",
  "найди",
  "о",
  "об",
  "по",
  "покажи",
  "про",
  "с",
  "со",
  "что",
  "я",
]);

const EN_STOP_WORDS = new Set([
  "a",
  "about",
  "and",
  "find",
  "for",
  "how",
  "i",
  "in",
  "is",
  "me",
  "of",
  "on",
  "or",
  "show",
  "the",
  "to",
  "what",
  "when",
  "where",
]);

function entryText(entry: HistoryEntry): string {
  if (entry.mode === "speakers" && entry.segments?.length) {
    return entry.segments
      .map((segment) => `${segment.speakerLabel}: ${segment.text}`)
      .join("\n")
      .trim();
  }

  return (entry.cleaned || entry.raw || "").trim();
}

function shouldIndexEntry(entry: HistoryEntry): boolean {
  return entry.status !== "failed" && entry.status !== "interrupted" && entryText(entry).length > 0;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function entryContentHash(entry: HistoryEntry): string {
  return hashText([
    entryText(entry),
    entry.timestamp,
    entry.source ?? "voice",
    entry.fileName ?? "",
    entry.duration,
    entry.status ?? "",
  ].join("\n"));
}

function normalizeMetadataText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").trim();
}

function splitTextIntoSearchChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= SEARCH_CHUNK_MAX_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + SEARCH_CHUNK_MAX_CHARS, trimmed.length);

    if (end < trimmed.length) {
      const breakStart = start + Math.floor(SEARCH_CHUNK_MAX_CHARS * 0.65);
      const slice = trimmed.slice(breakStart, end);
      const paragraphBreak = slice.lastIndexOf("\n\n");
      const sentenceBreak = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
      const whitespaceBreak = slice.lastIndexOf(" ");
      const breakAt = Math.max(paragraphBreak, sentenceBreak, whitespaceBreak);
      if (breakAt > 0) {
        end = breakStart + breakAt + 1;
      }
    }

    const chunk = trimmed.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= trimmed.length) {
      break;
    }

    start = Math.max(end - SEARCH_CHUNK_OVERLAP_CHARS, start + 1);
  }

  return chunks;
}

export function buildHistorySearchIndex(history: HistoryEntry[]): HistorySearchChunk[] {
  return history.flatMap((entry) => {
    if (!shouldIndexEntry(entry)) return [];
    const speaker = entry.speakers?.map((item) => item.label).join(", ");
    const contentHash = entryContentHash(entry);
    return splitTextIntoSearchChunks(entryText(entry)).map((text, index) => ({
      entryId: entry.id,
      chunkId: `${entry.id}:${index}`,
      contentHash,
      timestamp: entry.timestamp,
      source: entrySource(entry),
      fileName: entry.fileName,
      speaker,
      duration: entry.duration,
      text,
    }));
  });
}

function isStoredChunk(value: unknown): value is HistorySearchChunk {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Partial<HistorySearchChunk>;
  return (
    typeof chunk.entryId === "string" &&
    typeof chunk.chunkId === "string" &&
    typeof chunk.contentHash === "string" &&
    typeof chunk.timestamp === "string" &&
    (chunk.source === "voice" || chunk.source === "file" || chunk.source === "call") &&
    typeof chunk.duration === "number" &&
    typeof chunk.text === "string" &&
    (chunk.embedding === undefined ||
      Array.isArray(chunk.embedding) && chunk.embedding.every((item) => typeof item === "number"))
  );
}

function normalizeStoredIndex(value: unknown): HistorySearchChunk[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredChunk);
}

export function reconcileHistorySearchIndex(
  history: HistoryEntry[],
  existingIndex: HistorySearchChunk[],
): HistorySearchChunk[] {
  const existingByEntry = new Map<string, HistorySearchChunk[]>();
  for (const chunk of existingIndex) {
    const chunks = existingByEntry.get(chunk.entryId) ?? [];
    chunks.push(chunk);
    existingByEntry.set(chunk.entryId, chunks);
  }

  const reconciled: HistorySearchChunk[] = [];

  for (const entry of history) {
    if (!shouldIndexEntry(entry)) continue;

    const contentHash = entryContentHash(entry);
    const existing = existingByEntry.get(entry.id);
    if (existing?.length && existing.every((chunk) => chunk.contentHash === contentHash)) {
      reconciled.push(...existing);
      continue;
    }

    reconciled.push(...buildHistorySearchIndex([entry]));
  }

  return reconciled;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openHistoryIndexDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SEARCH_INDEX_DB_NAME, SEARCH_INDEX_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SEARCH_INDEX_STORE_NAME)) {
        db.createObjectStore(SEARCH_INDEX_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function loadStoredHistorySearchIndex(): Promise<HistorySearchChunk[]> {
  const db = await openHistoryIndexDb();
  try {
    const transaction = db.transaction(SEARCH_INDEX_STORE_NAME, "readonly");
    const value = await requestToPromise<unknown>(
      transaction.objectStore(SEARCH_INDEX_STORE_NAME).get(SEARCH_INDEX_KEY),
    );
    return normalizeStoredIndex(value);
  } finally {
    db.close();
  }
}

export async function saveCachedHistorySearchIndex(index: HistorySearchChunk[]): Promise<void> {
  const db = await openHistoryIndexDb();
  try {
    const transaction = db.transaction(SEARCH_INDEX_STORE_NAME, "readwrite");
    transaction.objectStore(SEARCH_INDEX_STORE_NAME).put(index, SEARCH_INDEX_KEY);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export async function getCachedHistorySearchIndex(
  history: HistoryEntry[],
): Promise<HistorySearchChunk[]> {
  if (typeof indexedDB === "undefined") {
    return buildHistorySearchIndex(history);
  }

  const existing = await loadStoredHistorySearchIndex();
  const next = reconcileHistorySearchIndex(history, existing);
  await saveCachedHistorySearchIndex(next);
  return next;
}

function entrySource(entry: HistoryEntry): HistorySource {
  if (entry.source === "file" || entry.source === "call") {
    return entry.source;
  }
  return "voice";
}

function sourceLabel(source: HistorySource, lang: UiLanguage): string {
  if (lang === "en") {
    if (source === "file") return "file";
    if (source === "call") return "call";
    return "voice";
  }

  if (source === "file") return "файл";
  if (source === "call") return "созвон";
  return "голос";
}

function formatEntryDate(timestamp: string, lang: UiLanguage): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString(lang === "en" ? "en-US" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameLocalDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function parseFilters(question: string, history: HistoryEntry[] = []): HistoryQuestionFilters {
  const normalized = question.toLowerCase();
  const normalizedForMetadata = normalizeMetadataText(question);
  const filters: HistoryQuestionFilters = {};

  if (/(созвон|звонок|звонк|call|meeting)/i.test(normalized)) {
    filters.source = "call";
  } else if (/(файл|файла|file|document|документ)/i.test(normalized)) {
    filters.source = "file";
  } else if (/(голос|диктов|voice|dictation)/i.test(normalized)) {
    filters.source = "voice";
  }

  if (/(сегодня|today)/i.test(normalized)) {
    filters.date = "today";
  } else if (/(вчера|yesterday)/i.test(normalized)) {
    filters.date = "yesterday";
  } else if (/(за неделю|недел[юяи]|week)/i.test(normalized)) {
    filters.date = "week";
  } else if (/(за месяц|месяц|month)/i.test(normalized)) {
    filters.date = "month";
  }

  for (const entry of history) {
    const fileName = entry.fileName?.trim();
    if (fileName && !filters.fileName) {
      const normalizedFileName = normalizeMetadataText(fileName);
      const fileStem = normalizeMetadataText(fileName.replace(/\.[^.]+$/, ""));
      if (
        (normalizedFileName.length > 2 &&
          normalizedForMetadata.includes(normalizedFileName)) ||
        (fileStem.length > 2 &&
          normalizedForMetadata.includes(fileStem))
      ) {
        filters.fileName = fileName;
      }
    }

    if (!filters.speaker) {
      const speakerLabels = [
        ...(entry.speakers?.map((speaker) => speaker.label) ?? []),
        ...(entry.segments?.map((segment) => segment.speakerLabel) ?? []),
      ];
      for (const label of speakerLabels) {
        const normalizedLabel = normalizeMetadataText(label);
        if (normalizedLabel.length > 2 && normalizedForMetadata.includes(normalizedLabel)) {
          filters.speaker = label;
          break;
        }
      }
    }

    if (filters.fileName && filters.speaker) {
      break;
    }
  }

  return filters;
}

function filterHistory(
  history: HistoryEntry[],
  filters: HistoryQuestionFilters,
): HistoryEntry[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now);
  monthStart.setDate(now.getDate() - 30);

  return history.filter((entry) => {
    if (!shouldIndexEntry(entry)) return false;
    if (filters.source && entrySource(entry) !== filters.source) return false;
    if (filters.fileName && entry.fileName !== filters.fileName) return false;
    if (filters.speaker) {
      const hasSpeaker =
        entry.speakers?.some((speaker) => speaker.label === filters.speaker) ||
        entry.segments?.some((segment) => segment.speakerLabel === filters.speaker);
      if (!hasSpeaker) return false;
    }

    if (filters.date) {
      const date = new Date(entry.timestamp);
      if (Number.isNaN(date.getTime())) return false;
      if (filters.date === "today" && !sameLocalDay(date, now)) return false;
      if (filters.date === "yesterday" && !sameLocalDay(date, yesterday)) return false;
      if (filters.date === "week" && date < weekStart) return false;
      if (filters.date === "month" && date < monthStart) return false;
    }

    return true;
  });
}

function sortNewestFirst(history: HistoryEntry[]): HistoryEntry[] {
  return [...history].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function sortOldestFirst(history: HistoryEntry[]): HistoryEntry[] {
  return [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function uniqueChunksByEntry(chunks: HistorySearchChunk[], newestFirst: boolean): HistorySearchChunk[] {
  const entries = new Map<string, HistorySearchChunk>();
  for (const chunk of chunks) {
    if (!entries.has(chunk.entryId)) {
      entries.set(chunk.entryId, chunk);
    }
  }
  return [...entries.values()].sort(
    (a, b) =>
      newestFirst
        ? new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function chunkSortIndex(chunk: HistorySearchChunk): number {
  const parts = chunk.chunkId.split(":");
  const index = Number(parts[parts.length - 1]);
  return Number.isFinite(index) ? index : 0;
}

function chunksTextForEntry(entryId: string, chunks: HistorySearchChunk[]): string {
  return chunks
    .filter((chunk) => chunk.entryId === entryId)
    .sort((a, b) => chunkSortIndex(a) - chunkSortIndex(b))
    .map((chunk) => chunk.text)
    .join("\n\n")
    .trim();
}

function scoredEntryFromChunk(
  chunk: HistorySearchChunk,
  text: string,
  allowLongContext = false,
): ScoredHistoryEntry {
  return {
    entryId: chunk.entryId,
    score: 1,
    text,
    chunks: [chunk],
    timestamp: chunk.timestamp,
    source: chunk.source,
    fileName: chunk.fileName,
    speaker: chunk.speaker,
    duration: chunk.duration,
    allowLongContext,
  };
}

function mentionsLatest(question: string): boolean {
  return (
    /(последн|последняя|последнюю|крайн|latest|last|most recent)/i.test(question)
  );
}

function mentionsFirst(question: string): boolean {
  return /(первая|первую|первое|самая первая|перв[а-я]*|first|oldest)/i.test(question);
}

function mentionsHistoryTarget(question: string): boolean {
  return /(запис|транскриб|расшифр|созвон|звонк|диктов|файл|record|transcript|transcription|call|meeting|file)/i.test(question);
}

function asksForContextTask(question: string): boolean {
  return /(саммари|суммар|суммир|summary|summar|сравн|compare|задач|задачи|task|tasks|action item)/i.test(question);
}

function asksForRecordedSpeech(question: string): boolean {
  return /(говорил|говорила|говорили|сказал|сказала|обсуждал|обсуждали|обсуждалось|said|discussed)/i.test(question);
}

function asksToFindInHistory(question: string): boolean {
  return (
    /(найди|найти|покажи|отыщи|find|show)/i.test(question) &&
    /(задач|задачи|task|tasks|что|про|говор|обсужд|саммари|summary|summar)/i.test(question)
  );
}

function asksAboutHistoryTopic(question: string): boolean {
  return /(что\s+было\s+про|что\s+было\s+по|what\s+was\s+said\s+about|what\s+about)/i.test(question);
}

function asksForLatest(question: string): boolean {
  return (
    mentionsLatest(question) &&
    mentionsHistoryTarget(question) &&
    !asksForContextTask(question)
  );
}

function asksForFirst(question: string): boolean {
  return (
    mentionsFirst(question) &&
    mentionsHistoryTarget(question) &&
    !asksForContextTask(question)
  );
}

function asksForCount(question: string): boolean {
  return (
    /(сколько|количество|count|how many)/i.test(question) &&
    /(запис|транскриб|расшифр|record|transcript|transcription)/i.test(question)
  );
}

function asksAboutHistory(question: string): boolean {
  return (
    mentionsHistoryTarget(question) ||
    asksForRecordedSpeech(question) ||
    asksToFindInHistory(question) ||
    asksAboutHistoryTopic(question) ||
    asksForLatest(question) ||
    asksForFirst(question) ||
    asksForCount(question) ||
    (asksForContextTask(question) && (mentionsLatest(question) || mentionsFirst(question)))
  );
}

export function shouldUseDevChatHistory(question: string): boolean {
  return asksAboutHistory(question);
}

function noMatchingContextAnswer(lang: UiLanguage): string {
  return lang === "en"
    ? "I did not find matching transcription records."
    : "Я не нашёл подходящих записей транскрибации.";
}

function latestAnswer(
  history: HistoryEntry[],
  filters: HistoryQuestionFilters,
  lang: UiLanguage,
): DevChatHistoryContext {
  const filtered = sortNewestFirst(filterHistory(history, filters));
  const latest = filtered[0];

  if (!latest) {
    return {
      directAnswer: noMatchingContextAnswer(lang),
    };
  }

  const text = entryText(latest);
  const preview = text.length > 700 ? `${text.slice(0, 700).trimEnd()}...` : text;
  const source = sourceLabel(entrySource(latest), lang);
  const date = formatEntryDate(latest.timestamp, lang);
  const duration =
    latest.duration > 0 ? `, ${lang === "en" ? "duration" : "длительность"} ${formatDurationMs(latest.duration * 1000, lang)}` : "";

  if (lang === "en") {
    return {
      directAnswer: `Latest matching transcription: ${date}, source: ${source}${duration}.\n\n${preview}`,
      sources: [sourceReferenceFromEntry(latest, 1, lang)],
    };
  }

  return {
    directAnswer: `Последняя подходящая запись транскрибации: ${date}, источник: ${source}${duration}.\n\n${preview}`,
    sources: [sourceReferenceFromEntry(latest, 1, lang)],
  };
}

function firstAnswer(
  history: HistoryEntry[],
  filters: HistoryQuestionFilters,
  lang: UiLanguage,
): DevChatHistoryContext {
  const filtered = sortOldestFirst(filterHistory(history, filters));
  const first = filtered[0];

  if (!first) {
    return {
      directAnswer: noMatchingContextAnswer(lang),
    };
  }

  const text = entryText(first);
  const preview = text.length > 700 ? `${text.slice(0, 700).trimEnd()}...` : text;
  const source = sourceLabel(entrySource(first), lang);
  const date = formatEntryDate(first.timestamp, lang);
  const duration =
    first.duration > 0 ? `, ${lang === "en" ? "duration" : "длительность"} ${formatDurationMs(first.duration * 1000, lang)}` : "";

  if (lang === "en") {
    return {
      directAnswer: `First matching transcription: ${date}, source: ${source}${duration}.\n\n${preview}`,
      sources: [sourceReferenceFromEntry(first, 1, lang)],
    };
  }

  return {
    directAnswer: `Первая подходящая запись транскрибации: ${date}, источник: ${source}${duration}.\n\n${preview}`,
    sources: [sourceReferenceFromEntry(first, 1, lang)],
  };
}

function countAnswer(
  history: HistoryEntry[],
  filters: HistoryQuestionFilters,
  lang: UiLanguage,
): string {
  const count = filterHistory(history, filters).length;

  if (lang === "en") {
    return `Found transcription records: ${count}.`;
  }

  return `Найдено записей транскрибации: ${count}.`;
}

function tokenize(text: string, lang: UiLanguage): string[] {
  const stopWords = lang === "en" ? EN_STOP_WORDS : RU_STOP_WORDS;
  return (text.toLowerCase().match(/[a-zа-яё0-9]+/gi) ?? [])
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export function cosineSimilarity(first: number[], second: number[]): number {
  if (first.length === 0 || first.length !== second.length) {
    return 0;
  }

  let dot = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;
  for (let index = 0; index < first.length; index += 1) {
    const firstValue = first[index] ?? 0;
    const secondValue = second[index] ?? 0;
    dot += firstValue * secondValue;
    firstMagnitude += firstValue * firstValue;
    secondMagnitude += secondValue * secondValue;
  }

  if (firstMagnitude === 0 || secondMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

function scoreChunk(
  chunk: HistorySearchChunk,
  tokens: string[],
  queryEmbedding?: number[],
): number {
  const searchable = [
    chunk.text,
    chunk.fileName ?? "",
    chunk.speaker ?? "",
    chunk.source === "call" ? "созвон звонок call meeting" : "",
    chunk.source === "file" ? "файл документ file document" : "",
    chunk.source === "voice" ? "голос диктовка voice dictation" : "",
  ]
    .join(" ")
    .toLowerCase();
  let textScore = 0;

  for (const token of tokens) {
    const occurrences = searchable.split(token).length - 1;
    if (occurrences > 0) {
      textScore += Math.min(occurrences, 8) * 3;
    }
  }

  const vectorSimilarity =
    queryEmbedding && chunk.embedding
      ? cosineSimilarity(queryEmbedding, chunk.embedding)
      : 0;
  const vectorScore =
    vectorSimilarity >= MIN_VECTOR_SIMILARITY
      ? 6 + (vectorSimilarity - MIN_VECTOR_SIMILARITY) * 20
      : 0;

  if (textScore === 0 && vectorScore === 0) {
    return 0;
  }

  let score = textScore + vectorScore;
  const ageMs = Date.now() - new Date(chunk.timestamp).getTime();
  if (Number.isFinite(ageMs) && ageMs >= 0) {
    score += Math.max(0, 2 - ageMs / (1000 * 60 * 60 * 24 * 30));
  }

  return score;
}

function relevantEntries(
  history: HistoryEntry[],
  question: string,
  lang: UiLanguage,
  searchIndex: HistorySearchChunk[] = buildHistorySearchIndex(history),
  queryEmbedding?: number[],
): ScoredHistoryEntry[] {
  const filters = parseFilters(question, history);
  const allowedEntryIds = new Set(filterHistory(history, filters).map((entry) => entry.id));
  const candidates = searchIndex.filter((chunk) => allowedEntryIds.has(chunk.entryId));
  const tokens = tokenize(question, lang);

  if (asksForContextTask(question) && (mentionsLatest(question) || mentionsFirst(question))) {
    return uniqueChunksByEntry(candidates, mentionsLatest(question))
      .slice(0, 1)
      .map((chunk) =>
        scoredEntryFromChunk(
          chunk,
          chunksTextForEntry(chunk.entryId, candidates) || chunk.text,
          true,
        ),
      );
  }

  if (tokens.length === 0 && !queryEmbedding) {
    return uniqueChunksByEntry(candidates, true)
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((chunk) => scoredEntryFromChunk(chunk, chunk.text));
  }

  const bestByEntry = new Map<string, ScoredHistoryEntry>();

  for (const chunk of candidates) {
    const score = scoreChunk(chunk, tokens, queryEmbedding);
    if (score <= 0) continue;

    const current = bestByEntry.get(chunk.entryId);
    if (!current || score > current.score) {
      bestByEntry.set(chunk.entryId, {
        entryId: chunk.entryId,
        score,
        text: chunk.text,
        chunks: [chunk],
        timestamp: chunk.timestamp,
        source: chunk.source,
        fileName: chunk.fileName,
        speaker: chunk.speaker,
        duration: chunk.duration,
      });
    }
  }

  const bestEntries = [...bestByEntry.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTEXT_ENTRIES);
  if (bestEntries.length > 0) {
    return bestEntries;
  }

  if (asksForContextTask(question) || asksToFindInHistory(question)) {
    return uniqueChunksByEntry(candidates, true)
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((chunk) => scoredEntryFromChunk(chunk, chunk.text));
  }

  return [];
}

function truncateEntryText(text: string, maxChars = MAX_ENTRY_CONTEXT_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function sourceReference(
  item: Pick<ScoredHistoryEntry, "entryId" | "timestamp" | "source" | "fileName" | "duration" | "text">,
  index: number,
  lang: UiLanguage,
): DevChatHistorySource {
  const source = sourceLabel(item.source, lang);
  const date = formatEntryDate(item.timestamp, lang);
  const duration =
    item.duration > 0
      ? `${lang === "en" ? "duration" : "длительность"}: ${formatDurationMs(item.duration * 1000, lang)}`
      : "";
  const file = item.fileName ? `${item.fileName}; ` : "";

  return {
    entryId: item.entryId,
    index,
    title: `[${index}] ${date}`,
    meta: `${file}${lang === "en" ? "source" : "источник"}: ${source}${duration ? `; ${duration}` : ""}`,
    preview: item.text.length > 180 ? `${item.text.slice(0, 180).trimEnd()}...` : item.text,
  };
}

function sourceReferenceFromEntry(
  entry: HistoryEntry,
  index: number,
  lang: UiLanguage,
): DevChatHistorySource {
  return sourceReference(
    {
      entryId: entry.id,
      timestamp: entry.timestamp,
      source: entrySource(entry),
      fileName: entry.fileName,
      duration: entry.duration,
      text: entryText(entry),
    },
    index,
    lang,
  );
}

function buildContextText(
  items: ScoredHistoryEntry[],
  lang: UiLanguage,
): string | undefined {
  if (items.length === 0) return undefined;

  const intro =
    lang === "en"
      ? "Context from Talkis transcription history. Use only these records when answering questions about transcription history. If the answer is not present here, say that the matching record was not found."
      : "Контекст из истории транскрибаций Talkis. Используй только эти записи для ответов об истории транскрибаций. Если ответа нет в этих записях, скажи, что подходящая запись не найдена.";

  let total = intro.length;
  const lines: string[] = [intro];

  for (const [index, item] of items.entries()) {
    const source = sourceLabel(item.source, lang);
    const date = formatEntryDate(item.timestamp, lang);
    const duration =
      item.duration > 0
        ? `; ${lang === "en" ? "duration" : "длительность"}: ${formatDurationMs(item.duration * 1000, lang)}`
        : "";
    const text = truncateEntryText(
      item.text,
      item.allowLongContext ? MAX_FOCUSED_ENTRY_CONTEXT_CHARS : MAX_ENTRY_CONTEXT_CHARS,
    );
    const block = `\n[${index + 1}] ${date}; ${lang === "en" ? "source" : "источник"}: ${source}${duration}\n${text}`;

    if (total + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      break;
    }

    lines.push(block);
    total += block.length;
  }

  return lines.join("\n");
}

export function buildDevChatHistoryContext(
  question: string,
  history: HistoryEntry[],
  lang: UiLanguage,
  searchIndex?: HistorySearchChunk[],
  queryEmbedding?: number[],
): DevChatHistoryContext {
  if (!shouldUseDevChatHistory(question)) {
    return {};
  }

  const filters = parseFilters(question, history);

  if (asksForLatest(question)) {
    return latestAnswer(history, filters, lang);
  }

  if (asksForFirst(question)) {
    return firstAnswer(history, filters, lang);
  }

  if (asksForCount(question)) {
    return { directAnswer: countAnswer(history, filters, lang) };
  }

  const entries = relevantEntries(history, question, lang, searchIndex, queryEmbedding);
  const contextText = buildContextText(entries, lang);
  if (!contextText && asksAboutHistory(question)) {
    return { directAnswer: noMatchingContextAnswer(lang) };
  }

  return contextText
    ? {
        contextText,
        sources: entries.map((item, index) => sourceReference(item, index + 1, lang)),
      }
    : {};
}
