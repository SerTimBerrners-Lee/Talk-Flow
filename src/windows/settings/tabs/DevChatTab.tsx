import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactElement, UIEvent } from "react";

import { LANGUAGES } from "../../../config/languages";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLanguage,
  IconLoader2,
  IconRotate2,
} from "../../../lib/icons";
import {
  buildDevChatHistoryContext,
  getCachedHistorySearchIndex,
  shouldUseDevChatHistory,
  type DevChatHistoryContext,
  type DevChatHistorySource,
} from "../../../lib/devChatHistoryContext";
import {
  embedHistoryQuery,
  ensureHistorySearchEmbeddings,
} from "../../../lib/historyEmbeddings";
import { getHistory, getSettings, type AppSettings } from "../../../lib/store";
import { LOCAL_TEXT_PROCESSING_LIMITS, processLongTextWithPrompt } from "../../../lib/summarize";
import { useI18n } from "../../../lib/i18n";
import { formatDurationMs, formatErrorMessage } from "../../../lib/utils";
import { translateSelectedText } from "../../widget/services/selectionTranslation";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  durationMs?: number;
  sources?: DevChatHistorySource[];
}

type RunningStatus = "searching" | "thinking" | "translating";

interface QuickSuggestion {
  label: string;
  prompt: string;
}

interface ChatTranslationRequest {
  text: string;
  targetLanguage?: string;
}

const DEV_CHAT_SYSTEM_PROMPT =
  "Ты — локальная текстовая модель в тестовом чате Talkis. Ниже дана история диалога. Ответь только на последнее сообщение пользователя: прямо, кратко и на языке пользователя.";

const DEV_CHAT_LONG_TEXT_PROMPT =
  "Ты — локальная текстовая модель в тестовом чате Talkis. Ниже дана история диалога. " +
  "Ответь на последнее сообщение пользователя на его языке. Если последнее сообщение содержит большой текст, " +
  "расшифровку или документ и отдельную инструкцию к обработке, следуй этой инструкции и сохрани требуемую структуру. " +
  "Если явной инструкции нет, дай краткое структурированное саммари. Не выдумывай факты, которых нет в тексте.";

const DEV_CHAT_DB_NAME = "talkis-dev-chat";
const DEV_CHAT_DB_VERSION = 1;
const DEV_CHAT_STORE_NAME = "state";
const DEV_CHAT_MESSAGES_KEY = "messages";
const DEV_CHAT_INITIAL_VISIBLE_MESSAGES = 40;
const DEV_CHAT_VISIBLE_INCREMENT = 40;
const DEV_CHAT_COLLAPSED_TEXT_CHARS = 6000;
const TRANSLATION_INTENT_PATTERN =
  /^\s*(?:(?:привет|здравствуй|здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|hi|hello|hey)[,!.]?\s*)?(?:(?:пожалуйста|please)[,.]?\s*)?(?:(?:можешь|можно|надо|нужно|помоги)\s+)?(?:мне\s+)?(?:переведи|перевести|сделай\s+перевод|translate)(?:$|[\s:,.!?'"»”])/i;
const TRANSLATION_REFERENCE_PATTERN =
  /\b(это|этот текст|его|последнее сообщение|предыдущее сообщение|прошлое сообщение|последний ответ|предыдущий ответ|last message|previous message|last response|previous response|this|it|that)\b/i;
const COMMON_LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ["английский", "английскии", "англ", "english"],
  ru: ["русский", "русскии", "рус", "russian"],
  es: ["испанский", "испанскии", "испан", "spanish", "espanol"],
  fr: ["французский", "французскии", "франц", "french", "francais"],
  de: ["немецкий", "немецкии", "нем", "german", "deutsch"],
  it: ["итальянский", "итальянскии", "итал", "italian", "italiano"],
  pt: ["португальский", "португальскии", "portuguese", "portugues"],
  zh: ["китайский", "китайскии", "chinese", "中文"],
  ja: ["японский", "японскии", "japanese"],
  ko: ["корейский", "корейскии", "korean"],
  uk: ["украинский", "украинскии", "ukrainian"],
  kk: ["казахский", "казахскии", "қазақша", "kazakh"],
  tr: ["турецкий", "турецкии", "turkish", "turkce"],
};

function chatPayload(messages: ChatMessage[]): string {
  const lines = messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "Пользователь" : "Модель"}: ${message.text}`);
  return lines.join("\n\n");
}

function normalizeTextToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function textContainsLanguageAlias(text: string, alias: string): boolean {
  if (alias.length <= 2) {
    return text.split(/\s+/).includes(alias);
  }

  return text.includes(alias);
}

function resolveLanguageCodeFromText(text: string): string | null {
  const normalized = normalizeTextToken(text);
  if (!normalized) return null;

  for (const [code, aliases] of Object.entries(COMMON_LANGUAGE_ALIASES)) {
    if (aliases.some((alias) => textContainsLanguageAlias(normalized, normalizeTextToken(alias)))) {
      return code;
    }
  }

  for (const language of LANGUAGES) {
    if (language.code === "auto") continue;
    const aliases = [language.code, language.name, language.native]
      .map(normalizeTextToken)
      .filter(Boolean);
    if (aliases.some((alias) => textContainsLanguageAlias(normalized, alias))) {
      return language.code;
    }
  }

  return null;
}

function resolveRequestedTargetLanguage(commandText: string): string | null {
  const normalized = normalizeTextToken(commandText);
  const match = normalized.match(/(?:^|\s)(?:на|в|to|into|in)\s+(.{2,80})/);
  if (match?.[1]) {
    return resolveLanguageCodeFromText(match[1]);
  }

  return null;
}

function stripWrappedText(text: string): string {
  return text
    .trim()
    .replace(/^```[^\n]*\n?/, "")
    .replace(/```$/, "")
    .replace(/^["'«“]+/, "")
    .replace(/["'»”]+$/, "")
    .trim();
}

function stripLeadingTargetPhrase(text: string): string {
  return text.replace(/^(?:на|в|to|into|in)\s+\S+(?:\s+язык)?\s*/i, "").trim();
}

function stripTrailingTargetPhrase(text: string): string {
  return text.replace(/\s+(?:на|в|to|into|in)\s+\S+(?:\s+язык)?\s*$/i, "").trim();
}

function stripTranslationCommandPrefix(text: string): string {
  return text
    .replace(
      /^\s*(?:(?:привет|здравствуй|здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|hi|hello|hey)[,!.]?\s*)?(?:(?:пожалуйста|please)[,.]?\s*)?(?:(?:можешь|можно|надо|нужно|помоги)\s+)?(?:мне\s+)?(?:переведи|перевести|сделай\s+перевод|translate)(?:\s+(?:этот|следующий|данный|this|the following)?\s*(?:текст|сообщение|фразу|предложение|message|text|phrase|sentence))?/i,
      "",
    )
    .trim();
}

function extractExplicitTranslationText(text: string): string | null {
  const trimmed = text.trim();
  const fenceMatch = /```[^\n]*\n([\s\S]*?)```/.exec(trimmed);
  if (fenceMatch?.[1]) {
    return stripWrappedText(fenceMatch[1]);
  }

  const separatorIndex = trimmed.search(/[:：]/);
  if (separatorIndex >= 0 && separatorIndex < 280) {
    const sourceText = stripWrappedText(trimmed.slice(separatorIndex + 1));
    return sourceText || null;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length > 1 && TRANSLATION_INTENT_PATTERN.test(lines[0] ?? "")) {
    const sourceText = stripWrappedText(lines.slice(1).join("\n"));
    if (sourceText) return sourceText;
  }

  const candidate = stripWrappedText(
    stripTrailingTargetPhrase(
      stripLeadingTargetPhrase(stripTranslationCommandPrefix(trimmed)),
    ).replace(/^[:：,.;—-]+/, ""),
  );
  if (!candidate || TRANSLATION_REFERENCE_PATTERN.test(candidate)) {
    return null;
  }

  return candidate;
}

function lastMessageText(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messages[index]?.text.trim();
    if (text) return text;
  }

  return null;
}

function detectChatTranslationRequest(
  latestUserText: string,
  previousMessages: ChatMessage[],
): ChatTranslationRequest | null {
  const trimmed = latestUserText.trim();
  if (!TRANSLATION_INTENT_PATTERN.test(trimmed)) {
    return null;
  }

  const instructionSegment = trimmed.split(/[:：\n]/, 1)[0] ?? trimmed;
  const targetLanguage = resolveRequestedTargetLanguage(instructionSegment) ?? undefined;
  const explicitText = extractExplicitTranslationText(trimmed);
  if (explicitText) {
    return { text: explicitText, targetLanguage };
  }

  if (TRANSLATION_REFERENCE_PATTERN.test(trimmed)) {
    const previousText = lastMessageText(previousMessages);
    if (previousText) {
      return { text: previousText, targetLanguage };
    }
  }

  return null;
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

function openDevChatDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEV_CHAT_DB_NAME, DEV_CHAT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEV_CHAT_STORE_NAME)) {
        db.createObjectStore(DEV_CHAT_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function normalizeStoredMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): ChatMessage[] => {
    const role = (item as Partial<ChatMessage> | null)?.role;
    const text = (item as Partial<ChatMessage> | null)?.text;

    if (
      !item ||
      typeof item !== "object" ||
      role !== "user" && role !== "assistant" ||
      typeof text !== "string"
    ) {
      return [];
    }

    const message = item as Partial<ChatMessage>;
    return [
      {
        id: typeof message.id === "string" && message.id.length > 0 ? message.id : crypto.randomUUID(),
        role,
        text,
        durationMs:
          typeof message.durationMs === "number" && Number.isFinite(message.durationMs)
            ? message.durationMs
            : undefined,
        sources: Array.isArray(message.sources)
          ? message.sources.flatMap((source, index): DevChatHistorySource[] => {
              if (
                !source ||
                typeof source !== "object" ||
                typeof source.entryId !== "string" ||
                typeof source.title !== "string" ||
                typeof source.meta !== "string" ||
                typeof source.preview !== "string"
              ) {
                return [];
              }

              return [
                {
                  entryId: source.entryId,
                  index: typeof source.index === "number" ? source.index : index + 1,
                  title: source.title,
                  meta: source.meta,
                  preview: source.preview,
                },
              ];
            })
          : undefined,
      },
    ];
  });
}

async function loadStoredMessages(): Promise<ChatMessage[]> {
  const db = await openDevChatDb();
  try {
    const transaction = db.transaction(DEV_CHAT_STORE_NAME, "readonly");
    const request = transaction.objectStore(DEV_CHAT_STORE_NAME).get(DEV_CHAT_MESSAGES_KEY);
    const value = await requestToPromise<unknown>(request);
    return normalizeStoredMessages(value);
  } finally {
    db.close();
  }
}

async function saveStoredMessages(messages: ChatMessage[]): Promise<void> {
  const db = await openDevChatDb();
  try {
    const transaction = db.transaction(DEV_CHAT_STORE_NAME, "readwrite");
    transaction.objectStore(DEV_CHAT_STORE_NAME).put(messages, DEV_CHAT_MESSAGES_KEY);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

async function clearStoredMessages(): Promise<void> {
  const db = await openDevChatDb();
  try {
    const transaction = db.transaction(DEV_CHAT_STORE_NAME, "readwrite");
    transaction.objectStore(DEV_CHAT_STORE_NAME).delete(DEV_CHAT_MESSAGES_KEY);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

function splitEmbeddedInstruction(text: string): { sourceText: string; instruction: string | null } {
  const match = /(?:^|\n)\s*Роль модели\s*:/i.exec(text);
  if (!match || match.index < 1000) {
    return { sourceText: text, instruction: null };
  }

  const sourceText = text.slice(0, match.index).trim();
  const instruction = text.slice(match.index).trim();
  if (sourceText.length < 1000 || instruction.length < 40) {
    return { sourceText: text, instruction: null };
  }

  return { sourceText, instruction };
}

export function DevChatTab({
  isActive = false,
  onOpenHistoryEntry,
}: {
  isActive?: boolean;
  onOpenHistoryEntry?: (entryId: string) => void;
}): ReactElement {
  const { lang, t } = useI18n();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(DEV_CHAT_INITIAL_VISIBLE_MESSAGES);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningStatus, setRunningStatus] = useState<RunningStatus>("thinking");
  const [error, setError] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(
    () => messagesLoaded && input.trim().length > 0 && !running,
    [input, messagesLoaded, running],
  );
  const visibleMessages = useMemo(() => {
    const firstVisibleIndex = Math.max(0, messages.length - visibleMessageCount);
    return messages.slice(firstVisibleIndex);
  }, [messages, visibleMessageCount]);
  const hiddenMessageCount = messages.length - visibleMessages.length;
  const quickSuggestions = useMemo<QuickSuggestion[]>(
    () => [
      {
        label: t("devChat.suggestionLatest"),
        prompt:
          lang === "en"
            ? "Show the latest transcription record. Include date, source, duration, a concise but complete content summary, and cite the source."
            : "Покажи последнюю запись транскрибации. Укажи дату, источник, длительность, краткое, но полное содержание и источник.",
      },
      {
        label: t("devChat.suggestionToday"),
        prompt:
          lang === "en"
            ? "Analyze today's transcription records. Give a structured answer: main topics, decisions, tasks, important details, and sources."
            : "Проанализируй записи транскрибации за сегодня. Дай структурированный ответ: основные темы, решения, задачи, важные детали и источники.",
      },
      {
        label: t("devChat.suggestionTasks"),
        prompt:
          lang === "en"
            ? "Find tasks in the transcription records. Return a structured list with task, context, owner or participant if available, deadline if available, and source."
            : "Найди задачи в записях транскрибации. Верни структурированный список: задача, контекст, владелец или участник если есть, срок если есть, источник.",
      },
      {
        label: t("devChat.suggestionLastCallSummary"),
        prompt:
          lang === "en"
            ? "Create a detailed structured summary of the latest call transcription. Include agenda/topics, key points, decisions, tasks, risks/questions, and cite the source."
            : "Сделай подробное структурированное саммари последнего созвона из транскрибации. Включи темы, ключевые тезисы, решения, задачи, риски или открытые вопросы и источник.",
      },
    ],
    [lang, t],
  );

  const isNearMessagesBottom = (element: HTMLDivElement): boolean =>
    element.scrollHeight - element.scrollTop - element.clientHeight < 88;

  const updateScrollToBottomVisibility = (element: HTMLDivElement | null): void => {
    if (!element) return;
    setShowScrollToBottom(messages.length > 0 && !isNearMessagesBottom(element));
  };

  const scrollToLatest = (behavior: ScrollBehavior): void => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior });
    setShowScrollToBottom(false);
  };

  const revealEarlierMessages = (): void => {
    const scroller = scrollContainerRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;

    setVisibleMessageCount((current) =>
      Math.min(messages.length, current + DEV_CHAT_VISIBLE_INCREMENT),
    );

    window.requestAnimationFrame(() => {
      if (!scroller) return;
      scroller.scrollTop += scroller.scrollHeight - previousHeight;
      updateScrollToBottomVisibility(scroller);
    });
  };

  const toggleMessageExpanded = (messageId: string): void => {
    setExpandedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const generateAssistantMessage = async (
    contextMessages: ChatMessage[],
    latestUserText: string,
    startedAt: number,
  ): Promise<ChatMessage> => {
    const translationRequest = detectChatTranslationRequest(
      latestUserText,
      contextMessages.slice(0, -1),
    );
    if (translationRequest) {
      setRunningStatus("translating");
      const settings = await getSettings({ reload: true });
      const translationSettings: AppSettings = {
        ...settings,
        translation: {
          ...settings.translation,
          selectionTargetLanguage:
            translationRequest.targetLanguage ||
            settings.translation.selectionTargetLanguage,
        },
      };
      const translated = await translateSelectedText({
        text: translationRequest.text,
        settings: translationSettings,
      });

      return {
        id: crypto.randomUUID(),
        role: "assistant",
        text: translated.trim() || t("widget.selectionTranslation.emptyResult"),
        durationMs: Date.now() - startedAt,
      };
    }

    const isLongText = latestUserText.length > LOCAL_TEXT_PROCESSING_LIMITS.directChars;
    const embedded = isLongText
      ? splitEmbeddedInstruction(latestUserText)
      : { sourceText: latestUserText, instruction: null };
    let historyContext: DevChatHistoryContext = {};
    let resolvedSettings: AppSettings | null = null;
    if (!isLongText && shouldUseDevChatHistory(latestUserText)) {
      try {
        setRunningStatus("searching");
        const [history, settings] = await Promise.all([
          getHistory(),
          getSettings({ reload: true }),
        ]);
        resolvedSettings = settings;
        const searchIndex = await getCachedHistorySearchIndex(history);
        const [embeddedIndex, queryEmbedding] = await Promise.all([
          ensureHistorySearchEmbeddings(searchIndex, settings, { maxChunks: 32 }),
          embedHistoryQuery(latestUserText, settings),
        ]);
        historyContext = buildDevChatHistoryContext(
          latestUserText,
          history,
          lang,
          embeddedIndex,
          queryEmbedding,
        );
      } catch {
        historyContext = {};
      }
    }

    if (historyContext.directAnswer) {
      return {
        id: crypto.randomUUID(),
        role: "assistant",
        text: historyContext.directAnswer,
        durationMs: Date.now() - startedAt,
        sources: historyContext.sources,
      };
    }

    setRunningStatus("thinking");
    const nextSettings = resolvedSettings ?? await getSettings({ reload: true });
    const promptText = isLongText
      ? [
          DEV_CHAT_LONG_TEXT_PROMPT,
          embedded.instruction
            ? `Инструкция пользователя к большому тексту:\n${embedded.instruction}`
            : null,
          ]
          .filter(Boolean)
          .join("\n\n")
      : [
          DEV_CHAT_SYSTEM_PROMPT,
          historyContext.contextText
            ? "Если в пользовательском вопросе речь об истории транскрибаций, используй переданный контекст истории. Не выдумывай записи, которых нет в контексте. Когда опираешься на запись, указывай её номер в квадратных скобках, например [1]."
            : null,
        ]
          .filter(Boolean)
          .join("\n\n");
    const result = await processLongTextWithPrompt({
      text: isLongText
        ? embedded.sourceText
        : [
            historyContext.contextText,
            `Диалог:\n${chatPayload(contextMessages)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
      prompt: {
        prompt: promptText,
        temperature: 0.3,
      },
      settings: nextSettings,
      noModelError: t("summary.noModel"),
    });

    return {
      id: crypto.randomUUID(),
      role: "assistant",
      text: result.trim() || t("devChat.emptyResponse"),
      durationMs: Date.now() - startedAt,
      sources: historyContext.sources,
    };
  };

  const copyAssistantMessage = async (message: ChatMessage): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1500);
    } catch (caughtError) {
      setError(formatErrorMessage(caughtError));
    }
  };

  const translateChatMessage = async (message: ChatMessage): Promise<void> => {
    if (running || translatingMessageId || !message.text.trim()) return;

    setTranslatingMessageId(message.id);
    setError(null);
    const startedAt = Date.now();

    try {
      const settings = await getSettings({ reload: true });
      const translated = await translateSelectedText({
        text: message.text,
        settings,
      });
      const translatedText = translated.trim();
      if (!translatedText) {
        throw new Error(t("widget.selectionTranslation.emptyResult"));
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, text: translatedText, durationMs: Date.now() - startedAt }
            : item,
        ),
      );
      setExpandedMessageIds((current) => {
        if (!current.has(message.id)) return current;
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    } catch (caughtError) {
      setError(formatErrorMessage(caughtError));
    } finally {
      setTranslatingMessageId((current) =>
        current === message.id ? null : current,
      );
    }
  };

  const regenerateAssistantMessage = async (messageId: string): Promise<void> => {
    if (running) return;

    const assistantIndex = messages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0 || messages[assistantIndex]?.role !== "assistant") return;

    let previousUserIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        previousUserIndex = index;
        break;
      }
    }
    if (previousUserIndex < 0) return;

    const contextMessages = messages.slice(0, previousUserIndex + 1);
    const latestUserText = contextMessages[contextMessages.length - 1]?.text;
    if (!latestUserText) return;

    setRunning(true);
    setRunningStatus("searching");
    setRegeneratingMessageId(messageId);
    setError(null);
    const startedAt = Date.now();

    try {
      const assistantMessage = await generateAssistantMessage(
        contextMessages,
        latestUserText,
        startedAt,
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...assistantMessage, id: messageId } : message,
        ),
      );
    } catch (caughtError) {
      setError(formatErrorMessage(caughtError));
    } finally {
      setRegeneratingMessageId(null);
      setRunningStatus("thinking");
      setRunning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadStoredMessages()
      .then((storedMessages) => {
        if (cancelled) return;
        setMessages(storedMessages);
        setVisibleMessageCount(DEV_CHAT_INITIAL_VISIBLE_MESSAGES);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        setError(formatErrorMessage(caughtError));
      })
      .finally(() => {
        if (!cancelled) {
          setMessagesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!messagesLoaded) return;

    const timeout = window.setTimeout(() => {
      void saveStoredMessages(messages).catch((caughtError) => {
        setError(formatErrorMessage(caughtError));
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [messages, messagesLoaded]);

  useEffect(() => {
    if (showScrollToBottom) {
      updateScrollToBottomVisibility(scrollContainerRef.current);
      return;
    }
    scrollToLatest("auto");
  }, [messages.length, running]);

  useEffect(() => {
    if (!isActive || running) return;

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive, running]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, 156);
    textarea.style.height = `${Math.max(nextHeight, 34)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 156 ? "auto" : "hidden";
  }, [input]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    if (canSend) {
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleMessagesScroll = (event: UIEvent<HTMLDivElement>): void => {
    updateScrollToBottomVisibility(event.currentTarget);
  };

  const sendText = async (text: string): Promise<void> => {
    if (!text || running) return;

    setRunning(true);
    setRunningStatus("searching");
    setError(null);
    setInput("");
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    const startedAt = Date.now();

    try {
      const assistantMessage = await generateAssistantMessage(nextMessages, text, startedAt);
      setMessages((current) => [...current, assistantMessage]);
    } catch (caughtError) {
      setError(formatErrorMessage(caughtError));
    } finally {
      setRunningStatus("thinking");
      setRunning(false);
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await sendText(input.trim());
  };

  const clear = (): void => {
    setMessages([]);
    setError(null);
    setShowScrollToBottom(false);
    setVisibleMessageCount(DEV_CHAT_INITIAL_VISIBLE_MESSAGES);
    setExpandedMessageIds(new Set());
    void clearStoredMessages().catch((caughtError) => {
      setError(formatErrorMessage(caughtError));
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexShrink: 0,
          paddingBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
              color: "var(--text-hi)",
            }}
          >
            {t("devChat.title")}
          </h2>
        </div>
        <button
          type="button"
          className="btn"
          onClick={clear}
          disabled={!messagesLoaded || running || messages.length === 0}
          style={{
            minHeight: 34,
            padding: "0 12px",
            borderRadius: 10,
            opacity: !messagesLoaded || running || messages.length === 0 ? 0.55 : 1,
            flexShrink: 0,
            fontSize: 12,
          }}
        >
          {t("devChat.clear")}
        </button>
      </div>

      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          position: "relative",
        }}
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleMessagesScroll}
          style={{
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: "8px 0 18px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 760,
              minHeight: "100%",
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              padding: "8px 0 18px",
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  margin: "auto",
                  display: "grid",
                  justifyItems: "center",
                  gap: 0,
                  color: "var(--text-low)",
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: 6,
                    maxWidth: 520,
                  }}
                >
                  {quickSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      disabled={running || !messagesLoaded}
                      onClick={() => void sendText(suggestion.prompt)}
                      title={suggestion.prompt}
                      style={{
                        minHeight: 30,
                        padding: "0 10px",
                        borderRadius: 9,
                        border: "1px solid var(--border-subtle)",
                        background: "var(--surface-hi)",
                        color: "var(--text-mid)",
                        fontSize: 12,
                        cursor: running || !messagesLoaded ? "default" : "pointer",
                        opacity: running || !messagesLoaded ? 0.55 : 1,
                      }}
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {hiddenMessageCount > 0 && (
                  <button
                    type="button"
                    onClick={revealEarlierMessages}
                    style={{
                      alignSelf: "center",
                      minHeight: 32,
                      padding: "0 12px",
                      borderRadius: 16,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-hi)",
                      color: "var(--text-mid)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {t("devChat.loadEarlier", {
                      count: String(Math.min(hiddenMessageCount, DEV_CHAT_VISIBLE_INCREMENT)),
                    })}
                  </button>
                )}
                {visibleMessages.map((message) => {
                  const isLongMessage = message.text.length > DEV_CHAT_COLLAPSED_TEXT_CHARS;
                  const isExpanded = expandedMessageIds.has(message.id);
                  const messageText =
                    isLongMessage && !isExpanded
                      ? `${message.text.slice(0, DEV_CHAT_COLLAPSED_TEXT_CHARS).trimEnd()}…`
                      : message.text;

                  return (
                    <div
                      key={message.id}
                      style={{
                        alignSelf: message.role === "user" ? "flex-end" : "stretch",
                        width: message.role === "user" ? "fit-content" : "100%",
                        maxWidth: message.role === "user" ? "78%" : "100%",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          padding: message.role === "user" ? "10px 13px" : "0",
                          borderRadius:
                            message.role === "user" ? "18px 18px 4px 18px" : 0,
                          border:
                            message.role === "user" ? "1px solid var(--border-subtle)" : "none",
                          background:
                            message.role === "user" ? "var(--control-muted)" : "transparent",
                          color: "var(--text-hi)",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          lineHeight: 1.62,
                          fontSize: 14,
                        }}
                      >
                        {messageText}
                      </div>
                      {message.role === "assistant" && message.sources?.length ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 6,
                            color: "var(--text-low)",
                            fontSize: 11,
                            lineHeight: 1.35,
                          }}
                        >
                          <span>{t("devChat.usedSources")}</span>
                          {message.sources.map((source) => {
                            const title = `${source.meta}\n${source.preview}`;
                            const sourceStyle = {
                              display: "inline-flex",
                              alignItems: "center",
                              minHeight: 22,
                              maxWidth: "100%",
                              padding: "0 7px",
                              borderRadius: 7,
                              border: "1px solid var(--border-subtle)",
                              background: "var(--surface-hi)",
                              color: "var(--text-mid)",
                              font: "inherit",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            } as const;

                            return onOpenHistoryEntry ? (
                              <button
                                key={`${message.id}-${source.entryId}-${source.index}`}
                                type="button"
                                aria-label={t("devChat.openSource", { title: source.title })}
                                title={title}
                                onClick={() => onOpenHistoryEntry(source.entryId)}
                                style={{
                                  ...sourceStyle,
                                  cursor: "pointer",
                                }}
                              >
                                {source.title}
                              </button>
                            ) : (
                              <span
                                key={`${message.id}-${source.entryId}-${source.index}`}
                                title={title}
                                style={sourceStyle}
                              >
                                {source.title}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {isLongMessage && (
                        <button
                          type="button"
                          onClick={() => toggleMessageExpanded(message.id)}
                          style={{
                            justifySelf: message.role === "user" ? "end" : "start",
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--text-low)",
                            fontSize: 11,
                            lineHeight: 1.35,
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded ? t("devChat.collapseMessage") : t("devChat.showFullMessage")}
                        </button>
                      )}
                      {message.role === "assistant" && (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            justifySelf: "start",
                            minHeight: 24,
                          }}
                        >
                          {message.durationMs != null && (
                            <span
                              style={{
                                fontSize: 12,
                                lineHeight: "14px",
                                color: "var(--text-low)",
                                padding: 0,
                              }}
                            >
                              {formatDurationMs(message.durationMs, lang)}
                            </span>
                          )}
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <button
                              type="button"
                              aria-label={
                                copiedMessageId === message.id
                                  ? t("devChat.copied")
                                  : t("devChat.copyResponse")
                              }
                              title={
                                copiedMessageId === message.id
                                  ? t("devChat.copied")
                                  : t("devChat.copyResponse")
                              }
                              onClick={() => void copyAssistantMessage(message)}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 7,
                                border: "1px solid transparent",
                                background: "transparent",
                                color: "var(--text-low)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              {copiedMessageId === message.id ? (
                                <IconCheck size={14} stroke={2.5} aria-hidden="true" />
                              ) : (
                                <IconCopy size={14} stroke={2} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label={
                                translatingMessageId === message.id
                                  ? t("devChat.translating")
                                  : t("devChat.translateMessage")
                              }
                              title={
                                translatingMessageId === message.id
                                  ? t("devChat.translating")
                                  : t("devChat.translateMessage")
                              }
                              disabled={running || Boolean(translatingMessageId)}
                              onClick={() => void translateChatMessage(message)}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 7,
                                border: "1px solid transparent",
                                background: "transparent",
                                color: "var(--text-low)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor:
                                  running || translatingMessageId
                                    ? "default"
                                    : "pointer",
                                opacity: running || translatingMessageId ? 0.5 : 1,
                              }}
                            >
                              {translatingMessageId === message.id ? (
                                <IconLoader2
                                  className="loading-soft-icon"
                                  size={14}
                                  stroke={2.1}
                                  aria-hidden="true"
                                />
                              ) : (
                                <IconLanguage size={14} stroke={2} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label={t("devChat.regenerateResponse")}
                              title={t("devChat.regenerateResponse")}
                              disabled={running}
                              onClick={() => void regenerateAssistantMessage(message.id)}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 7,
                                border: "1px solid transparent",
                                background: "transparent",
                                color: "var(--text-low)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: running ? "default" : "pointer",
                                opacity: running ? 0.5 : 1,
                              }}
                            >
                              {regeneratingMessageId === message.id ? (
                                <IconLoader2
                                  className="loading-soft-icon"
                                  size={14}
                                  stroke={2.1}
                                  aria-hidden="true"
                                />
                              ) : (
                                <IconRotate2 size={14} stroke={2} aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {running && !regeneratingMessageId && (
              <div
                style={{
                  alignSelf: "stretch",
                  maxWidth: "78%",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  color: "var(--text-mid)",
                  fontSize: 14,
                  lineHeight: 1.62,
                }}
              >
                <IconLoader2
                  className="loading-soft-icon"
                  size={14}
                  stroke={2.1}
                  aria-hidden="true"
                />
                {t(
                  runningStatus === "searching"
                    ? "devChat.searchingHistory"
                    : runningStatus === "translating"
                      ? "devChat.translating"
                      : "devChat.running",
                )}
              </div>
            )}
            <div ref={messagesEndRef} style={{ height: 1, flexShrink: 0 }} />
          </div>
        </div>
        {showScrollToBottom && messages.length > 0 && (
          <button
            type="button"
            aria-label={t("devChat.scrollToLatest")}
            title={t("devChat.scrollToLatest")}
            onClick={() => scrollToLatest("smooth")}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-hi)",
              color: "var(--text-hi)",
              boxShadow: "var(--shadow-soft)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "translateX(-50%)",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            <IconChevronDown size={18} stroke={2.3} aria-hidden="true" />
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            width: "100%",
            maxWidth: 760,
            margin: "0 auto 8px",
            padding: "9px 12px",
            border: "1px solid var(--danger-border)",
            borderRadius: 10,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 12,
            lineHeight: 1.45,
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={(event) => void send(event)}
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          padding: "10px 10px 10px 16px",
          borderRadius: 14,
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-hi)",
          boxShadow: "var(--shadow-soft)",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "1 1 0",
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
          }}
        >
          <textarea
            ref={textareaRef}
            id="dev-chat-input"
            name="message"
            rows={1}
            wrap="soft"
            aria-label={t("devChat.input")}
            placeholder={t("devChat.input")}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={running}
            style={{
              display: "block",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              minHeight: 34,
              maxHeight: 156,
              boxSizing: "border-box",
              padding: "6px 0",
              border: "none",
              outline: "none",
              resize: "none",
              overflowX: "hidden",
              background: "transparent",
              color: "var(--text-hi)",
              fontFamily: "var(--font-main)",
              fontSize: 14,
              lineHeight: "22px",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={!canSend}
          aria-label={running ? t("devChat.sending") : t("devChat.send")}
          title={running ? t("devChat.sending") : t("devChat.send")}
          style={{
            width: 34,
            height: 34,
            minWidth: 34,
            border: "none",
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "var(--accent-contrast)",
            opacity: canSend ? 1 : 0.45,
            cursor: canSend ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          <IconArrowUp size={17} stroke={2.4} />
        </button>
      </form>
    </div>
  );
}
