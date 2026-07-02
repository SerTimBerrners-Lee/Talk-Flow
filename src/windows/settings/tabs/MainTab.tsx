import { useState, useEffect, useMemo, useRef } from "react";
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
  getHistory,
  getSettings,
  HistoryEntry,
  updateHistoryEntry,
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
import { logError } from "../../../lib/logger";
import { TranscriptionStatsPanel } from "../../../components/TranscriptionStatsPanel";
import { SummaryModal } from "../../../components/SummaryModal";
import { RowActionsMenu, type RowActionItem } from "../../../components/RowActionsMenu";
import { retryHistoryEntry } from "../../widget/services/transcriptionPipeline";
import { useI18n, type TFunc, type UiLanguage, type MsgKey } from "../../../lib/i18n";

interface MainTabProps {
  initialHistory?: HistoryEntry[];
}

interface HistoryGroup {
  id: string;
  label: string;
  items: HistoryEntry[];
}

type HistorySource = "voice" | "file" | "call";
type HistoryFilter = "all" | HistorySource;

const HISTORY_TEXT_PREVIEW_LIMIT = 250;
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

function getHistorySource(entry: HistoryEntry): HistorySource {
  if (entry.source === "file" || entry.source === "call") {
    return entry.source;
  }

  return "voice";
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
  speakers,
  segments,
  expanded,
  editing,
  onSpeakerRename,
  onToggle,
}: {
  text: string;
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
  expanded: boolean;
  editing: boolean;
  onSpeakerRename: (speakerId: string, label: string) => void;
  onToggle: () => void;
}): ReactElement {
  const { t } = useI18n();
  const speakerSegments = segments?.length ? segments : null;
  const textTooLong = text.length > HISTORY_TEXT_PREVIEW_LIMIT;
  const shouldCollapse = textTooLong || Boolean(speakerSegments);
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
export function MainTab({ initialHistory = [] }: MainTabProps) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [copied, setCopied] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrySucceededId, setRetrySucceededId] = useState<string | null>(null);
  const [hotkeyLabel, setHotkeyLabel] = useState(
    formatHotkeyLabel(DEFAULT_HOTKEY),
  );
  const [isClearArmed, setIsClearArmed] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
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
  const heroPointerStartX = useRef<number | null>(null);

  useEffect(() => {
    const syncHotkeyLabel = async (reload = false) => {
      const settings = await getSettings({ reload });
      setHotkeyLabel(formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY));
      setSummaryAvailable(isSummaryAvailable(settings));
    };

    const loadHistory = async (): Promise<void> => {
      try {
        setHistory(await getHistory());
      } catch (error) {
        void logError("HISTORY", `Failed to load history: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void loadHistory();
    void syncHotkeyLabel();

    const unlistenHistory = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, () => {
      void loadHistory();
    });

    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void syncHotkeyLabel(true);
      void loadHistory();
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

  const deleteEntry = async (id: string) => {
    await deleteHistoryEntry(id);
    setHistory((h) => h.filter((x) => x.id !== id));
    setEditingSpeakerEntryId((current) => (current === id ? null : current));
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

  const editEntry = (entry: HistoryEntry): void => {
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

    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

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
      current.map((item) => (item.id === entry.id ? nextEntry : item)),
    );
    await updateHistoryEntry(nextEntry);
    await emit(HISTORY_UPDATED_EVENT, nextEntry);
  };

  const retryEntry = async (entry: HistoryEntry) => {
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

    // Broadcast a stop request: the widget cancels fresh recordings, this window
    // cancels in-window retries. Whichever process owns the job aborts it.
    await emit<ProcessingCancelRequestPayload>(PROCESSING_CANCEL_REQUEST_EVENT, {
      entryId: id,
    });
  };

  const filteredHistory = useMemo<HistoryEntry[]>(() => {
    if (historyFilter === "all") {
      return history;
    }

    return history.filter((item) => getHistorySource(item) === historyFilter);
  }, [history, historyFilter]);

  const groupedHistory = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];

    for (const item of filteredHistory) {
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
  }, [filteredHistory, t, lang]);

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
              {groupedHistory.map((group) => (
                <div key={group.id} style={{ display: "grid", gap: 8 }}>
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

                        return (
                          <tr
                            key={item.id}
                            onDoubleClick={() =>
                              navigator.clipboard.writeText(item.cleaned)
                            }
                            style={{
                              borderBottom:
                                index < group.items.length - 1
                                  ? "1px solid var(--table-row-border)"
                                  : "none",
                              cursor: "default",
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
                                    {item.processingTime < 1000
                                      ? t("mainTab.durationMs", { value: item.processingTime })
                                      : t("mainTab.durationS", { value: (item.processingTime / 1000).toFixed(1) })}
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
                                      text={item.cleaned}
                                      speakers={item.speakers}
                                      segments={item.segments}
                                      expanded={expandedIds.has(item.id)}
                                      editing={
                                        editingSpeakerEntryId === item.id
                                      }
                                      onSpeakerRename={(speakerId, label) => {
                                        void renameSpeaker(
                                          item,
                                          speakerId,
                                          label,
                                        );
                                      }}
                                      onToggle={() => toggleExpanded(item.id)}
                                    />
                                  )}
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
                                      Boolean(item.audioBase64)) ||
                                      (source === "call" &&
                                        Boolean(item.callTracks?.length)) ||
                                      (source === "file" &&
                                        Boolean(item.filePath))) ? (
                                    <button
                                      onClick={() => retryEntry(item)}
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
                                          onSelect: () => editEntry(item),
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
                                          onSelect: () =>
                                            copyText(item.id, item.cleaned),
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
                                          onSelect: () => setSummaryEntry(item),
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
            </div>
          )}
        </div>
      </section>

      {summaryEntry && (
        <SummaryModal
          entry={summaryEntry}
          onClose={() => setSummaryEntry(null)}
          onEntryChange={(updated) => {
            setSummaryEntry(updated);
            void emit(HISTORY_UPDATED_EVENT, updated);
          }}
        />
      )}
    </div>
  );
}
