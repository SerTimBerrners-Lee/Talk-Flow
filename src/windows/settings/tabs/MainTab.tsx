import {
  lazy,
  Suspense,
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type {
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  clearHistory,
  DEFAULT_HOTKEY,
  deleteHistoryEntry,
  formatHotkeyLabel,
  getHistoryEntry,
  getHistoryIndex,
  getSettings,
  toHistoryListEntry,
  updateHistoryEntry,
  type HistoryEntry,
  type HistoryListEntry,
  type Speaker,
  type SpeakerTranscriptSegment,
} from "../../../lib/store";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconHelpCircle,
  IconLoader2,
  IconListCheck,
  IconPencil,
  IconPlayerPlay,
  IconRotate2,
  IconSquare,
  IconTrash,
} from "../../../lib/icons";
import {
  HISTORY_CLEARED_EVENT,
  HISTORY_DELETED_EVENT,
  HISTORY_UPDATED_EVENT,
  PROCESSING_CANCEL_REQUEST_EVENT,
  SETTINGS_UPDATED_EVENT,
  WIDGET_RETRY_PROCESSING_EVENT,
  type ProcessingCancelRequestPayload,
  type WidgetRetryProcessingPayload,
} from "../../../lib/hotkeyEvents";
import { isSummaryAvailable } from "../../../lib/summarize";
import { retryCallCaptureHistoryEntry } from "../../../lib/callCapture";
import { retryFileHistoryEntry } from "../../../lib/fileTranscription";
import { cancelProcessing } from "../../../lib/processingControl";
import { formatDurationMs } from "../../../lib/utils";
import { logError, logInfo } from "../../../lib/logger";
import { TranscriptionStatsPanel } from "../../../components/TranscriptionStatsPanel";
import { RowActionsMenu, type RowActionItem } from "../../../components/RowActionsMenu";
import { HistoryAudioTrack } from "../../../components/HistoryAudioTrack";
import { retryHistoryEntry } from "../../widget/services/transcriptionPipeline";
import { useI18n, type TFunc, type UiLanguage, type MsgKey } from "../../../lib/i18n";

const LazySummaryModal = lazy(() =>
  import("../../../components/SummaryModal").then((module) => ({
    default: module.SummaryModal,
  })),
);

interface MainTabProps {
  initialHistory?: Array<HistoryListEntry | HistoryEntry>;
  focusedEntryId?: string | null;
  focusedEntryNonce?: number;
}

interface HistoryGroup {
  id: string;
  label: string;
  items: HistoryListEntry[];
}

type HistorySource = "voice" | "file" | "call";
type HistoryFilter = "all" | HistorySource;

const HISTORY_TEXT_PREVIEW_LIMIT = 250;
const HISTORY_INITIAL_RENDER_LIMIT = 80;
const HISTORY_RENDER_INCREMENT = 80;
const FULL_ENTRY_CACHE_LIMIT = 25;
const SUPPORT_EMAIL = "david.perov60@gmail.com";
const MAIN_HERO_FIRST_SLIDE_DELAY_MS = 30_000;
const MAIN_HERO_SLIDE_DELAY_MS = 30_000;
const HISTORY_FILTER_OPTIONS: { id: HistoryFilter; labelKey: MsgKey }[] = [
  { id: "all", labelKey: "mainTab.filter.all" },
  { id: "voice", labelKey: "mainTab.filter.voice" },
  { id: "file", labelKey: "mainTab.filter.file" },
  { id: "call", labelKey: "mainTab.filter.call" },
];
const MAIN_HERO_SLIDES = [
  {
    id: "record",
    titleKey: "mainTab.howToStart",
    actionKey: "mainTab.howItWorks",
  },
  {
    id: "support",
    titleKey: "mainTab.hero.supportTitle",
    actionKey: "mainTab.hero.supportAction",
  },
] as const satisfies readonly {
  id: "record" | "support";
  titleKey: MsgKey;
  actionKey: MsgKey;
}[];

function getHistorySource(entry: { source?: HistoryEntry["source"] }): HistorySource {
  if (entry.source === "file" || entry.source === "call") {
    return entry.source;
  }

  return "voice";
}

function isHistoryListEntry(
  entry: HistoryListEntry | HistoryEntry,
): entry is HistoryListEntry {
  return "textPreview" in entry;
}

function toInitialHistoryListEntry(
  entry: HistoryListEntry | HistoryEntry,
): HistoryListEntry {
  return isHistoryListEntry(entry) ? entry : toHistoryListEntry(entry);
}

function addFullEntryToCache(
  cache: Map<string, HistoryEntry>,
  entry: HistoryEntry,
): Map<string, HistoryEntry> {
  const next = new Map(cache);
  next.delete(entry.id);
  next.set(entry.id, entry);

  while (next.size > FULL_ENTRY_CACHE_LIMIT) {
    const oldestId = next.keys().next().value;
    if (!oldestId) break;
    next.delete(oldestId);
  }

  return next;
}

function sourceLabelKey(source: HistorySource): MsgKey {
  if (source === "file") return "mainTab.source.file";
  if (source === "call") return "mainTab.source.call";
  return "mainTab.source.voice";
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatSpeakerTranscript(segments: SpeakerTranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}] ${segment.speakerLabel}: ${segment.text.trim()}`,
    )
    .join("\n");
}

function SpeakerHistoryTranscript({
  segments,
}: {
  segments: SpeakerTranscriptSegment[];
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {segments.map((segment, index) => (
        <div
          key={`${segment.start}-${index}`}
          style={{
            display: "grid",
            gridTemplateColumns: "84px minmax(0, 1fr)",
            gap: 10,
            alignItems: "start",
            padding: index === 0 ? "0 0 10px" : "10px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--text-low)",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {formatTimestamp(segment.start)}
          </div>
          <div style={{ display: "grid", gap: 3 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "var(--text-hi)",
              }}
            >
              {segment.speakerLabel}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-mid)",
                lineHeight: 1.65,
                overflowWrap: "anywhere",
              }}
            >
              {segment.text}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpandableHistoryText({
  text,
  textLength,
  hasSpeakerTranscript,
  speakers,
  segments,
  expanded,
  editing,
  loading,
  onSpeakerRename,
  onToggle,
}: {
  text: string;
  textLength?: number;
  hasSpeakerTranscript?: boolean;
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
  expanded: boolean;
  editing: boolean;
  loading?: boolean;
  onSpeakerRename: (speakerId: string, label: string) => void;
  onToggle: () => void;
}): ReactElement {
  const { t } = useI18n();
  const speakerSegments = segments?.length ? segments : null;
  const textTooLong =
    (textLength ?? text.length) > HISTORY_TEXT_PREVIEW_LIMIT;
  const shouldCollapse =
    textTooLong || Boolean(speakerSegments) || Boolean(hasSpeakerTranscript);
  const visibleText =
    textTooLong && !expanded
      ? `${text.slice(0, HISTORY_TEXT_PREVIEW_LIMIT).trimEnd()}...`
      : text;

  return (
    <div
      style={{
        display: "grid",
        gap: expanded && speakerSegments ? 8 : 2,
        color: "var(--text-mid)",
        lineHeight: 1.7,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {expanded && speakerSegments ? (
        <>
          {editing && speakers?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {speakers.map((speaker) => (
                <input
                  key={speaker.id}
                  className="input"
                  value={speaker.label}
                  onChange={(event) =>
                    onSpeakerRename(speaker.id, event.target.value)
                  }
                  style={{
                    width: 140,
                    height: 34,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 650,
                  }}
                  aria-label={t("mainTab.speakerNameAria", { name: speaker.label })}
                />
              ))}
            </div>
          ) : null}
          <SpeakerHistoryTranscript segments={speakerSegments} />
        </>
      ) : (
        <span>{visibleText}</span>
      )}
      {loading && (
        <IconLoader2
          className="loading-soft-icon"
          size={13}
          stroke={2}
          title={t("mainTab.processing")}
        />
      )}
      {shouldCollapse && (
        <button
          type="button"
          onClick={onToggle}
          style={{
            marginLeft: 0,
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--text-hi)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "none",
            justifySelf: "start",
          }}
        >
          {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
        </button>
      )}
    </div>
  );
}

function formatDayLabel(timestamp: string, t: TFunc, lang: UiLanguage): string {
  const entryDate = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfEntryDay = new Date(
    entryDate.getFullYear(),
    entryDate.getMonth(),
    entryDate.getDate(),
  );
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfEntryDay.getTime()) / 86400000,
  );

  if (diffDays === 0) return t("mainTab.day.today");
  if (diffDays === 1) return t("mainTab.day.yesterday");

  return entryDate.toLocaleDateString(lang === "en" ? "en-US" : "ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}
export function MainTab({
  initialHistory = [],
  focusedEntryId = null,
  focusedEntryNonce = 0,
}: MainTabProps) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<HistoryListEntry[]>(() =>
    initialHistory.map(toInitialHistoryListEntry),
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrySucceededId, setRetrySucceededId] = useState<string | null>(null);
  const [hotkeyLabel, setHotkeyLabel] = useState(
    formatHotkeyLabel(DEFAULT_HOTKEY),
  );
  const [isClearArmed, setIsClearArmed] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [visibleHistoryLimit, setVisibleHistoryLimit] = useState(
    HISTORY_INITIAL_RENDER_LIMIT,
  );
  const [hintHelpOpen, setHintHelpOpen] = useState(false);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroHasAdvanced, setHeroHasAdvanced] = useState(false);
  const [heroPaused, setHeroPaused] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editingSpeakerEntryId, setEditingSpeakerEntryId] = useState<
    string | null
  >(null);
  const [summaryEntry, setSummaryEntry] = useState<HistoryEntry | null>(null);
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [fullEntryCache, setFullEntryCache] = useState<
    Map<string, HistoryEntry>
  >(() => new Map());
  const [loadingFullEntryIds, setLoadingFullEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const heroPointerStartX = useRef<number | null>(null);
  const focusedRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const expandedIdsRef = useRef(expandedIds);
  const summaryEntryRef = useRef(summaryEntry);
  const activeAudioIdRef = useRef(activeAudioId);

  const rememberFullEntry = useCallback((entry: HistoryEntry): void => {
    setFullEntryCache((current) => addFullEntryToCache(current, entry));
  }, []);

  const loadFullEntry = useCallback(
    async (id: string): Promise<HistoryEntry | null> => {
      const cached = fullEntryCache.get(id);
      if (cached) {
        rememberFullEntry(cached);
        return cached;
      }

      setLoadingFullEntryIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

      try {
        const entry = await getHistoryEntry(id);
        if (entry) {
          rememberFullEntry(entry);
        }
        return entry;
      } catch (error) {
        void logError(
          "HISTORY",
          `Failed to load history entry ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      } finally {
        setLoadingFullEntryIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [fullEntryCache, rememberFullEntry],
  );

  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  useEffect(() => {
    summaryEntryRef.current = summaryEntry;
  }, [summaryEntry]);

  useEffect(() => {
    activeAudioIdRef.current = activeAudioId;
  }, [activeAudioId]);

  useEffect(() => {
    if (fullEntryCache.size > 0) {
      void logInfo("HISTORY", `Full entry cache size=${fullEntryCache.size}`);
    }
  }, [fullEntryCache.size]);

  useEffect(() => {
    const syncHotkeyLabel = async (reload = false) => {
      const settings = await getSettings({ reload });
      setHotkeyLabel(formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY));
      setSummaryAvailable(isSummaryAvailable(settings));
    };

    const loadHistoryIndex = async (): Promise<void> => {
      try {
        setHistory(await getHistoryIndex());
      } catch (error) {
        void logError("HISTORY", `Failed to load history: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void loadHistoryIndex();
    void syncHotkeyLabel();

    const unlistenHistory = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, ({ payload }) => {
      if (!payload?.id) {
        void loadHistoryIndex();
        return;
      }

      const listEntry = toHistoryListEntry(payload);
      setHistory((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === listEntry.id);
        if (existingIndex === -1) {
          return [listEntry, ...current];
        }

        const next = [...current];
        next[existingIndex] = listEntry;
        return next;
      });

      const shouldKeepFullEntry =
        expandedIdsRef.current.has(payload.id) ||
        summaryEntryRef.current?.id === payload.id ||
        Boolean(activeAudioIdRef.current?.startsWith(`${payload.id}:`));
      if (shouldKeepFullEntry) {
        setFullEntryCache((current) => addFullEntryToCache(current, payload));
      }
      setSummaryEntry((current) => (current?.id === payload.id ? payload : current));
    });

    const unlistenDeleted = listen<{ id: string }>(HISTORY_DELETED_EVENT, ({ payload }) => {
      if (!payload?.id) {
        void loadHistoryIndex();
        return;
      }

      setHistory((current) => current.filter((entry) => entry.id !== payload.id));
      setFullEntryCache((current) => {
        if (!current.has(payload.id)) return current;
        const next = new Map(current);
        next.delete(payload.id);
        return next;
      });
      setActiveAudioId((current) =>
        current?.startsWith(`${payload.id}:`) ? null : current,
      );
      setEditingSpeakerEntryId((current) => (current === payload.id ? null : current));
      setSummaryEntry((current) => (current?.id === payload.id ? null : current));
    });

    const unlistenCleared = listen(HISTORY_CLEARED_EVENT, () => {
      setHistory([]);
      setFullEntryCache(new Map());
      setActiveAudioId(null);
      setEditingSpeakerEntryId(null);
      setSummaryEntry(null);
    });

    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void syncHotkeyLabel(true);
    });

    // Cancel a retry that is running in this (Settings) window.
    const unlistenCancel = listen<ProcessingCancelRequestPayload>(
      PROCESSING_CANCEL_REQUEST_EVENT,
      ({ payload }) => {
        if (payload?.entryId) {
          void cancelProcessing(payload.entryId);
        }
      },
    );

    return () => {
      unlistenHistory.then((unlisten) => unlisten());
      unlistenDeleted.then((unlisten) => unlisten());
      unlistenCleared.then((unlisten) => unlisten());
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCancel.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (heroPaused || MAIN_HERO_SLIDES.length <= 1) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setHeroSlideIndex((current) => (current + 1) % MAIN_HERO_SLIDES.length);
        setHeroHasAdvanced(true);
      },
      heroHasAdvanced
        ? MAIN_HERO_SLIDE_DELAY_MS
        : MAIN_HERO_FIRST_SLIDE_DELAY_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [heroHasAdvanced, heroPaused, heroSlideIndex]);

  useEffect(() => {
    if (!focusedEntryId) return;

    if (historyFilter !== "all") {
      setHistoryFilter("all");
      return;
    }

    const focusedIndex = history.findIndex((entry) => entry.id === focusedEntryId);
    if (focusedIndex >= visibleHistoryLimit) {
      setVisibleHistoryLimit(focusedIndex + 1);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusedRowRefs.current.get(focusedEntryId)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusedEntryId, focusedEntryNonce, history, historyFilter, visibleHistoryLimit]);

  useEffect(() => {
    setVisibleHistoryLimit(HISTORY_INITIAL_RENDER_LIMIT);
  }, [historyFilter]);

  const deleteEntry = async (id: string) => {
    await deleteHistoryEntry(id);
    setHistory((h) => h.filter((x) => x.id !== id));
    setFullEntryCache((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setActiveAudioId((current) =>
      current?.startsWith(`${id}:`) ? null : current,
    );
    setEditingSpeakerEntryId((current) => (current === id ? null : current));
    setSummaryEntry((current) => (current?.id === id ? null : current));
    await emit(HISTORY_DELETED_EVENT, { id });
  };

  const clearAllHistory = async () => {
    if (!isClearArmed) {
      setIsClearArmed(true);
      setTimeout(() => {
        setIsClearArmed((current) => (current ? false : current));
      }, 2500);
      return;
    }

    await clearHistory();
    setHistory([]);
    setFullEntryCache(new Map());
    setActiveAudioId(null);
    setSummaryEntry(null);
    setIsClearArmed(false);
    await emit(HISTORY_CLEARED_EVENT);
  };

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(
      () => setCopied((current) => (current === id ? null : current)),
      1500,
    );
  };

  const copyEntryText = async (id: string): Promise<void> => {
    const entry = await loadFullEntry(id);
    const text = entry?.cleaned.trim() ? entry.cleaned : "";
    if (!text) return;
    await copyText(id, text);
  };

  const contactSupport = async (): Promise<void> => {
    const subject = encodeURIComponent(
      t("settingsGeneralExtra.support.mailSubject"),
    );
    const body = encodeURIComponent(
      t("settingsGeneralExtra.support.mailBody"),
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      await openUrl(mailto);
    } catch (error) {
      void logError(
        "MAIN",
        `Failed to open support mail: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await navigator.clipboard.writeText(SUPPORT_EMAIL);
      } catch (clipboardError) {
        void logError(
          "MAIN",
          `Failed to copy support mail: ${clipboardError instanceof Error ? clipboardError.message : String(clipboardError)}`,
        );
      }
    }
  };

  const editEntry = async (id: string): Promise<void> => {
    const entry = await loadFullEntry(id);
    if (!entry) return;

    if (!entry.segments?.length || !entry.speakers?.length) {
      toggleExpanded(entry.id);
      return;
    }

    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(entry.id);
      return next;
    });
    setEditingSpeakerEntryId((current) =>
      current === entry.id ? null : entry.id,
    );
  };

  const toggleExpanded = (id: string): void => {
    const shouldCloseEditing = expandedIds.has(id);
    const shouldOpen = !shouldCloseEditing;

    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

    if (shouldOpen) {
      void loadFullEntry(id);
    }

    if (shouldCloseEditing) {
      setEditingSpeakerEntryId((current) => (current === id ? null : current));
    }
  };

  const renameSpeaker = async (
    entry: HistoryEntry,
    speakerId: string,
    label: string,
  ): Promise<void> => {
    if (!entry.segments?.length || !entry.speakers?.length) return;

    const currentSpeaker = entry.speakers.find(
      (speaker) => speaker.id === speakerId,
    );
    const nextLabel = label || currentSpeaker?.label || "";
    const nextSpeakers = entry.speakers.map((speaker) =>
      speaker.id === speakerId ? { ...speaker, label: nextLabel } : speaker,
    );
    const nextSegments = entry.segments.map((segment) =>
      segment.speakerId === speakerId
        ? { ...segment, speakerLabel: nextLabel }
        : segment,
    );
    const nextText = formatSpeakerTranscript(nextSegments);
    const nextEntry: HistoryEntry = {
      ...entry,
      raw: nextText,
      cleaned: nextText,
      speakers: nextSpeakers,
      segments: nextSegments,
      mode: "speakers",
    };

    setHistory((current) =>
      current.map((item) =>
        item.id === entry.id ? toHistoryListEntry(nextEntry) : item,
      ),
    );
    rememberFullEntry(nextEntry);
    setSummaryEntry((current) =>
      current?.id === nextEntry.id ? nextEntry : current,
    );
    await updateHistoryEntry(nextEntry);
    await emit(HISTORY_UPDATED_EVENT, nextEntry);
  };

  const retryEntry = async (id: string) => {
    const entry = await loadFullEntry(id);
    if (!entry) return;

    const source = getHistorySource(entry);
    setRetryingId(entry.id);
    if (source === "voice" || source === "call") {
      await emit<WidgetRetryProcessingPayload>(WIDGET_RETRY_PROCESSING_EVENT, {
        active: true,
        source,
        entryId: entry.id,
      });
    }

    try {
      const settings = await getSettings();
      if (source === "call") {
        await retryCallCaptureHistoryEntry(entry, settings);
      } else if (source === "file") {
        await retryFileHistoryEntry(entry, settings);
      } else {
        await retryHistoryEntry(entry, settings, { shouldPaste: false });
      }
      setRetrySucceededId(entry.id);
      setTimeout(() => {
        setRetrySucceededId((current) =>
          current === entry.id ? null : current,
        );
      }, 1800);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("mainTab.retryFailed");

      setHistory((current) =>
        current.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                status: "failed",
                errorMessage: message,
              }
            : item,
        ),
      );
      setFullEntryCache((current) => {
        const cached = current.get(entry.id);
        if (!cached) return current;
        return addFullEntryToCache(current, {
          ...cached,
          status: "failed",
          errorMessage: message,
        });
      });
    } finally {
      if (source === "voice" || source === "call") {
        await emit<WidgetRetryProcessingPayload>(WIDGET_RETRY_PROCESSING_EVENT, {
          active: false,
          source,
          entryId: entry.id,
        });
      }
      setRetryingId((current) => (current === entry.id ? null : current));
    }
  };

  const cancelEntry = async (id: string): Promise<void> => {
    // Flip the row instantly so the stop button changes on the first click — the
    // authoritative interrupted state is persisted by cancelProcessing.
    setHistory((current) =>
      current.map((item) =>
        item.id === id && item.status === "processing"
          ? {
              ...item,
              status: "interrupted",
              errorMessage: t("mainTab.processingStopped"),
            }
          : item,
      ),
    );
    setFullEntryCache((current) => {
      const cached = current.get(id);
      if (!cached || cached.status !== "processing") return current;
      return addFullEntryToCache(current, {
        ...cached,
        status: "interrupted",
        errorMessage: t("mainTab.processingStopped"),
      });
    });

    // Broadcast a stop request: the widget cancels fresh recordings, this window
    // cancels in-window retries. Whichever process owns the job aborts it.
    await emit<ProcessingCancelRequestPayload>(PROCESSING_CANCEL_REQUEST_EVENT, {
      entryId: id,
    });
  };

  const filteredHistory = useMemo<HistoryListEntry[]>(() => {
    if (historyFilter === "all") {
      return history;
    }

    return history.filter((item) => getHistorySource(item) === historyFilter);
  }, [history, historyFilter]);

  const visibleHistory = useMemo<HistoryListEntry[]>(
    () => filteredHistory.slice(0, visibleHistoryLimit),
    [filteredHistory, visibleHistoryLimit],
  );

  const groupedHistory = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];

    for (const item of visibleHistory) {
      const label = formatDayLabel(item.timestamp, t, lang);
      const existing = groups[groups.length - 1];

      if (!existing || existing.label !== label) {
        groups.push({
          id: `${new Date(item.timestamp).toISOString().slice(0, 10)}-${groups.length}`,
          label,
          items: [item],
        });
        continue;
      }

      existing.items.push(item);
    }

    return groups;
  }, [visibleHistory, t, lang]);

  const hiddenHistoryCount = filteredHistory.length - visibleHistory.length;

  const activeHeroSlide =
    MAIN_HERO_SLIDES[heroSlideIndex] ?? MAIN_HERO_SLIDES[0];
  const isSupportHeroSlide = activeHeroSlide.id === "support";

  const showAdjacentHeroSlide = (direction: 1 | -1): void => {
    setHeroSlideIndex(
      (current) =>
        (current + direction + MAIN_HERO_SLIDES.length) %
        MAIN_HERO_SLIDES.length,
    );
    setHeroHasAdvanced(true);
  };

  const handleHeroAction = (): void => {
    if (isSupportHeroSlide) {
      void contactSupport();
      return;
    }

    setHintHelpOpen((value) => !value);
  };

  const handleHeroPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    heroPointerStartX.current = event.clientX;
  };

  const handleHeroPointerUp = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const startX = heroPointerStartX.current;
    heroPointerStartX.current = null;

    if (startX === null) {
      return;
    }

    const deltaX = event.clientX - startX;
    if (Math.abs(deltaX) < 48) {
      return;
    }

    showAdjacentHeroSlide(deltaX < 0 ? 1 : -1);
  };

  const handleHeroBlur = (event: ReactFocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setHeroPaused(false);
    }
  };

  const heroHintFooter = (
    <div
      onMouseEnter={() => setHeroPaused(true)}
      onMouseLeave={() => setHeroPaused(false)}
      onFocus={() => setHeroPaused(true)}
      onBlur={handleHeroBlur}
      onPointerDown={handleHeroPointerDown}
      onPointerUp={handleHeroPointerUp}
      onPointerCancel={() => {
        heroPointerStartX.current = null;
      }}
      style={{ display: "grid", gap: 8, touchAction: "pan-y" }}
    >
      <div
        key={activeHeroSlide.id}
        className="main-hero-slide"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 220px",
            minWidth: 0,
          }}
        >
          <span
            className="subtle-row-text"
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t(activeHeroSlide.titleKey)}
          </span>
          {!isSupportHeroSlide && (
            <button
              type="button"
              onClick={handleHeroAction}
              aria-expanded={hintHelpOpen}
              aria-label={t(activeHeroSlide.actionKey)}
              title={t(activeHeroSlide.actionKey)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                flexShrink: 0,
                color: hintHelpOpen ? "var(--text-hi)" : "var(--text-low)",
              }}
            >
              <IconHelpCircle size={16} stroke={2} />
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexShrink: 0,
          }}
        >
          {isSupportHeroSlide && (
            <button
              type="button"
              className="subtle-row-text subtle-row-link"
              onClick={handleHeroAction}
              aria-label={t(activeHeroSlide.actionKey)}
              title={t(activeHeroSlide.actionKey)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t(activeHeroSlide.actionKey)}
            </button>
          )}

          {!isSupportHeroSlide && (
            <div
              className="subtle-row-text"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
              }}
            >
              <span>{t("mainTab.combination")}</span>
              <span>{hotkeyLabel}</span>
            </div>
          )}
        </div>
      </div>

      {!isSupportHeroSlide && hintHelpOpen && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-mid)",
            lineHeight: 1.65,
          }}
        >
          {t("mainTab.howToStartHint")}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TranscriptionStatsPanel footer={heroHintFooter} />

      <section style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--text-hi)",
                margin: "0 0 4px",
                letterSpacing: "-0.03em",
              }}
            >
              {t("mainTab.historyTitle")}
            </h2>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-mid)",
                lineHeight: 1.6,
              }}
            >
              {history.length > 0
                ? t("mainTab.historyDescFilled")
                : t("mainTab.historyDescEmpty", { hotkey: hotkeyLabel })}
            </div>
          </div>

          {history.length > 0 && (
            <button
              onClick={() => {
                void clearAllHistory();
              }}
              className={isClearArmed ? "btn btn-danger" : "btn"}
              style={{ minHeight: 34, padding: "0 12px" }}
              title={
                isClearArmed
                  ? t("mainTab.clearAllConfirmTitle")
                  : t("mainTab.clearAllTitle")
              }
            >
              <IconTrash size={12} stroke={2} />{" "}
              {isClearArmed ? t("mainTab.confirm") : t("mainTab.clear")}
            </button>
          )}
        </div>

        {history.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                background: "var(--control-track)",
                borderRadius: 10,
                padding: 3,
                gap: 2,
              }}
            >
              {HISTORY_FILTER_OPTIONS.map((option) => {
                const active = historyFilter === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setHistoryFilter(option.id)}
                    style={{
                      minWidth: 72,
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: "none",
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      background: active
                        ? "var(--dropdown-active)"
                        : "transparent",
                      color: active ? "var(--text-hi)" : "var(--text-mid)",
                      cursor: "pointer",
                    }}
                  >
                    {t(option.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gap: 20,
          }}
        >
          {history.length === 0 ? (
            <div
              style={{
                padding: "32px 20px",
                borderRadius: 12,
                border: "1px dashed var(--border-dashed)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <span className="headline-accent" style={{ fontSize: 24 }}>
                  ◎
                </span>
              </div>
              <div className="label" style={{ marginBottom: 10 }}>
                {t("mainTab.emptyTitle")}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "var(--text-mid)",
                  lineHeight: 1.7,
                }}
              >
                {t("mainTab.emptyHintBefore")} <b>{hotkeyLabel}</b>{" "}
                {t("mainTab.emptyHintAfter")}
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div
              style={{
                padding: "28px 20px",
                borderRadius: 12,
                border: "1px dashed var(--border-dashed)",
                textAlign: "center",
                color: "var(--text-mid)",
              }}
            >
              {t("mainTab.filterEmpty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {groupedHistory.map((group, groupIndex) => (
                <div
                  key={group.id}
                  style={{
                    display: "grid",
                    gap: 8,
                    ...(groupIndex > 0
                      ? {
                          contentVisibility: "auto",
                          containIntrinsicSize: "auto 220px",
                        }
                      : null),
                  }}
                >
                  <div className="label" style={{ paddingLeft: 4 }}>
                    {group.label}
                  </div>
                  <table
                    className="b-table"
                    style={{ background: "transparent" }}
                  >
                    <thead>
                      <tr>
                        <th style={{ width: 92 }}>{t("mainTab.colTime")}</th>
                        <th style={{ paddingLeft: 8 }}>{t("mainTab.colText")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, index) => {
                        const source = getHistorySource(item);
                        const fullEntry = fullEntryCache.get(item.id);
                        const isExpanded = expandedIds.has(item.id);
                        const isLoadingFullEntry =
                          loadingFullEntryIds.has(item.id);
                        const displayText =
                          isExpanded && fullEntry
                            ? fullEntry.cleaned
                            : item.textPreview;
                        const displayTextLength =
                          isExpanded && fullEntry
                            ? fullEntry.cleaned.length
                            : item.textLength;

                        return (
                          <tr
                            key={item.id}
                            ref={(element) => {
                              if (element) {
                                focusedRowRefs.current.set(item.id, element);
                              } else {
                                focusedRowRefs.current.delete(item.id);
                              }
                            }}
                            onDoubleClick={() => {
                              void copyEntryText(item.id);
                            }}
                            style={{
                              background:
                                focusedEntryId === item.id
                                  ? "rgba(0,0,0,0.04)"
                                  : "transparent",
                              borderBottom:
                                index < group.items.length - 1
                                  ? "1px solid var(--table-row-border)"
                                  : "none",
                              cursor: "default",
                              transition: "background 0.18s ease",
                            }}
                          >
                            <td
                              style={{
                                whiteSpace: "nowrap",
                                verticalAlign: "top",
                                color: "var(--text-low)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 3,
                                }}
                              >
                                <span>
                                  {new Date(item.timestamp).toLocaleTimeString(
                                    "ru-RU",
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                </span>
                                {item.processingTime != null && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      opacity: 0.55,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {formatDurationMs(item.processingTime, lang)}
                                  </span>
                                )}
                                {historyFilter === "all" && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      opacity: 0.55,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {t(sourceLabelKey(source))}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              style={{ verticalAlign: "top", paddingLeft: 8 }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                  minWidth: 0,
                                }}
                              >
                                <div
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: "grid",
                                    gap: 8,
                                  }}
                                >
                                  {item.status === "processing" ? (
                                    <div
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "6px 10px",
                                        borderRadius: 999,
                                        background: "var(--control-muted)",
                                        border: "1px solid var(--border)",
                                        color: "var(--text-mid)",
                                        fontSize: 12,
                                        lineHeight: 1.4,
                                        width: "fit-content",
                                      }}
                                    >
                                      <IconLoader2
                                        className="loading-soft-icon"
                                        size={13}
                                        stroke={2}
                                      />
                                      <span>{t("mainTab.processing")}</span>
                                    </div>
                                  ) : item.status === "failed" ||
                                    item.status === "interrupted" ? (
                                    <>
                                      <div
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 8,
                                          padding: "6px 10px",
                                          borderRadius: 999,
                                          background: "var(--danger-soft)",
                                          border:
                                            "1px solid var(--danger-border)",
                                          color: "var(--danger)",
                                          fontSize: 12,
                                          lineHeight: 1.4,
                                          width: "fit-content",
                                        }}
                                      >
                                        <IconAlertCircle
                                          size={13}
                                          stroke={2}
                                        />
                                        <span>
                                          {item.status === "interrupted"
                                            ? t("mainTab.statusInterrupted")
                                            : t("mainTab.statusFailed")}
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          color: "var(--text-mid)",
                                          lineHeight: 1.7,
                                          overflowWrap: "anywhere",
                                          wordBreak: "break-word",
                                        }}
                                      >
                                        {item.errorMessage ||
                                          t("mainTab.audioSavedLocally")}
                                      </div>
                                    </>
                                  ) : (
                                    <ExpandableHistoryText
                                      text={displayText}
                                      textLength={displayTextLength}
                                      hasSpeakerTranscript={item.mode === "speakers"}
                                      speakers={fullEntry?.speakers}
                                      segments={isExpanded ? fullEntry?.segments : undefined}
                                      expanded={isExpanded}
                                      editing={
                                        editingSpeakerEntryId === item.id
                                      }
                                      loading={isExpanded && isLoadingFullEntry && !fullEntry}
                                      onSpeakerRename={(speakerId, label) => {
                                        if (fullEntry) {
                                          void renameSpeaker(
                                            fullEntry,
                                            speakerId,
                                            label,
                                          );
                                        }
                                      }}
                                      onToggle={() => toggleExpanded(item.id)}
                                    />
                                  )}
                                  {item.hasAudio || item.hasCallTracks ? (
                                    <div
                                      style={{
                                        width: "100%",
                                        maxWidth: 520,
                                        margin: "0 auto",
                                        minWidth: 0,
                                      }}
                                    >
                                      {fullEntry ? (
                                        <HistoryAudioTrack
                                          entry={fullEntry}
                                          activeAudioId={activeAudioId}
                                          onActiveAudioChange={setActiveAudioId}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn"
                                          onClick={() => {
                                            void loadFullEntry(item.id);
                                          }}
                                          style={{
                                            width: 32,
                                            minWidth: 32,
                                            height: 32,
                                            minHeight: 32,
                                            padding: 0,
                                            borderRadius: 8,
                                            justifySelf: "center",
                                          }}
                                          title={t("mainTab.audioPlay")}
                                          aria-label={t("mainTab.audioPlay")}
                                          disabled={isLoadingFullEntry}
                                        >
                                          {isLoadingFullEntry ? (
                                            <IconLoader2
                                              className="loading-soft-icon"
                                              size={12}
                                              stroke={2}
                                            />
                                          ) : (
                                            <IconPlayerPlay size={12} stroke={2} />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: 6,
                                    width: 32,
                                    flexShrink: 0,
                                  }}
                                >
                                  {item.status === "processing" ? (
                                    <button
                                      onClick={() => cancelEntry(item.id)}
                                      className="btn btn-danger"
                                      style={{
                                        width: 32,
                                        minWidth: 32,
                                        height: 32,
                                        minHeight: 32,
                                        padding: 0,
                                        flexShrink: 0,
                                        borderRadius: 8,
                                      }}
                                      title={t("mainTab.stopProcessing")}
                                    >
                                      <IconSquare
                                        size={11}
                                        stroke={2}
                                        fill="currentColor"
                                      />
                                    </button>
                                  ) : (item.status === "failed" ||
                                      item.status === "interrupted") &&
                                    ((source === "voice" &&
                                      item.hasAudio) ||
                                      (source === "call" &&
                                        item.hasCallTracks) ||
                                      (source === "file" &&
                                        item.hasFilePath)) ? (
                                    <button
                                      onClick={() => {
                                        void retryEntry(item.id);
                                      }}
                                      className="btn"
                                      disabled={retryingId === item.id}
                                      style={{
                                        width: 32,
                                        minWidth: 32,
                                        height: 32,
                                        minHeight: 32,
                                        padding: 0,
                                        flexShrink: 0,
                                        borderRadius: 8,
                                      }}
                                      title={t("mainTab.retryProcess")}
                                    >
                                      {retryingId === item.id ? (
                                        <IconLoader2
                                          className="loading-soft-icon"
                                          size={12}
                                          stroke={2}
                                        />
                                      ) : (
                                        <IconRotate2 size={12} stroke={2} />
                                      )}
                                    </button>
                                  ) : (
                                    <RowActionsMenu
                                      label={t("rowMenu.actions")}
                                      items={[
                                        (source === "file" ||
                                          source === "call") && {
                                          key: "edit",
                                          label: t("rowMenu.edit"),
                                          icon: (
                                            <IconPencil size={14} stroke={2} />
                                          ),
                                          onSelect: () => {
                                            void editEntry(item.id);
                                          },
                                        },
                                        {
                                          key: "copy",
                                          label:
                                            copied === item.id ||
                                            retrySucceededId === item.id
                                              ? t("mainTab.success")
                                              : t("rowMenu.copy"),
                                          icon:
                                            copied === item.id ||
                                            retrySucceededId === item.id ? (
                                              <IconCheck
                                                size={14}
                                                stroke={2.5}
                                              />
                                            ) : (
                                              <IconCopy size={14} stroke={2} />
                                            ),
                                          onSelect: () => {
                                            void copyEntryText(item.id);
                                          },
                                        },
                                        {
                                          key: "summarize",
                                          label: t("rowMenu.summarize"),
                                          icon: (
                                            <IconListCheck
                                              size={14}
                                              stroke={2}
                                            />
                                          ),
                                          disabled: !summaryAvailable,
                                          hint: t("summary.unavailable.tooltip"),
                                          onSelect: () => {
                                            void loadFullEntry(item.id).then(
                                              (entry) => {
                                                if (entry) {
                                                  setSummaryEntry(entry);
                                                }
                                              },
                                            );
                                          },
                                        },
                                      ].filter(Boolean) as RowActionItem[]}
                                    />
                                  )}
                                  {item.status !== "processing" && (
                                    <button
                                      onClick={() => deleteEntry(item.id)}
                                      className="btn btn-danger"
                                      style={{
                                        width: 32,
                                        minWidth: 32,
                                        height: 32,
                                        minHeight: 32,
                                        padding: 0,
                                        flexShrink: 0,
                                        borderRadius: 8,
                                      }}
                                      title={t("mainTab.delete")}
                                    >
                                      <IconTrash size={12} stroke={2} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {hiddenHistoryCount > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setVisibleHistoryLimit((current) =>
                      Math.min(
                        current + HISTORY_RENDER_INCREMENT,
                        filteredHistory.length,
                      ),
                    )
                  }
                  style={{
                    justifySelf: "center",
                    marginTop: 2,
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {t("mainTab.showMoreHistory", {
                    count: Math.min(HISTORY_RENDER_INCREMENT, hiddenHistoryCount),
                  })}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {summaryEntry && (
        <Suspense fallback={null}>
          <LazySummaryModal
            entry={summaryEntry}
            onClose={() => setSummaryEntry(null)}
            onEntryChange={(updated) => {
              setSummaryEntry(updated);
              rememberFullEntry(updated);
              setHistory((current) =>
                current.map((item) =>
                  item.id === updated.id ? toHistoryListEntry(updated) : item,
                ),
              );
              void emit(HISTORY_UPDATED_EVENT, updated);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
