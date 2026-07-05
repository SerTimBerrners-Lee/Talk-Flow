import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { IconCheck, IconClipboard, IconPencil, IconTrash } from "../lib/icons";

import { SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import {
  getSettings,
  listPromptsByKind,
  addSummaryToEntry,
  updateSummaryInEntry,
  deleteSummaryFromEntry,
  type AppSettings,
  type HistoryEntry,
  type SummaryEntry,
} from "../lib/store";
import {
  summarizeTranscript,
  resolveSummaryBackend,
  transcriptToText,
  type SummarizeProgress,
} from "../lib/summarize";
import { formatDurationMs, formatErrorMessage } from "../lib/utils";
import { useI18n } from "../lib/i18n";
import { SlideOverModal } from "./SlideOverModal";
import { RowActionsMenu, type RowActionItem } from "./RowActionsMenu";
import { Dropdown } from "./Dropdown";

const PREFERRED_DEFAULT_PROMPT = "summary-short";
const TEXT_PREVIEW_LIMIT = 250;

export function SummaryModal({
  entry,
  onClose,
  onEntryChange,
}: {
  entry: HistoryEntry;
  onClose: () => void;
  onEntryChange?: (entry: HistoryEntry) => void;
}) {
  const { lang, t } = useI18n();
  const text = useMemo(() => transcriptToText(entry).trim(), [entry]);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [promptId, setPromptId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SummarizeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SummaryEntry[]>(entry.summaries ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const summaryRunRef = useRef<{ id: number; cancelled: boolean } | null>(null);
  const nextRunIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getSettings({ reload: true })
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setPromptId((current) => {
          if (current) return current;
          const list = listPromptsByKind(next, "summary");
          const preferred = list.find((p) => p.id === PREFERRED_DEFAULT_PROMPT);
          return preferred?.id || next.defaultSummaryPromptId || list[0]?.id || "";
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-refresh when prompts/settings change elsewhere (e.g. a new summary prompt
  // is created in the «Стиль и промпты» tab) so the dropdown updates immediately.
  useEffect(() => {
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      getSettings({ reload: true })
        .then(setSettings)
        .catch(() => {});
    });
    return () => {
      void unlistenPromise.then((dispose) => dispose());
    };
  }, []);

  const prompts = settings ? listPromptsByKind(settings, "summary") : [];
  const selected = prompts.find((p) => p.id === promptId) ?? prompts[0];
  const backend = settings ? resolveSummaryBackend(settings) : null;
  const canRun = Boolean(settings && selected && text && backend && !running);

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const progressLabel = (): string => {
    if (!progress) return t("summary.progress.preparing");
    if (progress.phase === "map") {
      return t("summary.progress.map", { current: progress.current, total: progress.total });
    }
    if (progress.phase === "reduce") return t("summary.progress.reduce");
    return t("summary.progress.preparing");
  };

  const progressPercent = (): number => {
    if (!progress) return 8;
    if (progress.phase === "map" && progress.total > 0) {
      return Math.max(8, Math.min(90, Math.round((progress.current / progress.total) * 90)));
    }
    if (progress.phase === "reduce") return 95;
    return 8;
  };

  const generate = async (): Promise<void> => {
    if (!settings || !selected || !text) {
      if (!text) setError(t("summary.empty.noText"));
      return;
    }
    const runState = { id: nextRunIdRef.current + 1, cancelled: false };
    nextRunIdRef.current = runState.id;
    summaryRunRef.current = runState;
    setRunning(true);
    setError(null);
    setProgress(null);
    const startedAt = Date.now();
    try {
      const result = await summarizeTranscript({
        text,
        prompt: selected,
        settings,
        onProgress: setProgress,
        shouldCancel: () => summaryRunRef.current !== runState || runState.cancelled,
      });
      if (summaryRunRef.current !== runState || runState.cancelled) return;
      const summary: SummaryEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        promptId: selected.id,
        promptName: selected.name,
        text: result.trim(),
      };
      const updated = await addSummaryToEntry(entry.id, summary);
      setSummaries(updated?.summaries ?? [summary, ...summaries]);
      if (updated) onEntryChange?.(updated);
      setExpandedId(summary.id);
    } catch (e) {
      if (summaryRunRef.current === runState && !runState.cancelled) {
        setError(formatErrorMessage(e));
      }
    } finally {
      if (summaryRunRef.current === runState) {
        summaryRunRef.current = null;
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const stopSummary = (): void => {
    if (summaryRunRef.current) {
      summaryRunRef.current.cancelled = true;
    }
    setRunning(false);
    setProgress(null);
  };

  useEffect(() => {
    return () => {
      if (summaryRunRef.current) {
        summaryRunRef.current.cancelled = true;
      }
    };
  }, []);

  const copy = async (item: SummaryEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const startEdit = (item: SummaryEntry): void => {
    setEditingId(item.id);
    setEditText(item.text);
    setExpandedId(item.id);
  };

  const saveEdit = async (item: SummaryEntry): Promise<void> => {
    const updated = await updateSummaryInEntry(entry.id, item.id, editText);
    setSummaries(updated?.summaries ?? summaries.map((s) => (s.id === item.id ? { ...s, text: editText } : s)));
    if (updated) onEntryChange?.(updated);
    setEditingId(null);
  };

  const remove = async (item: SummaryEntry): Promise<void> => {
    const updated = await deleteSummaryFromEntry(entry.id, item.id);
    setSummaries(updated?.summaries ?? summaries.filter((s) => s.id !== item.id));
    if (updated) onEntryChange?.(updated);
  };

  const promptOptions = prompts.map((p) => ({ value: p.id, label: p.name }));

  return (
    <SlideOverModal onClose={onClose} title={t("summary.title")} width="100vw" topOffset="var(--summary-modal-top-offset, 0px)">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Generate controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--text-mid)" }}>{t("summary.type")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dropdown value={selected?.id ?? ""} options={promptOptions} onChange={setPromptId} disabled={running || prompts.length === 0} />
            </div>
            <button
              type="button"
              className="btn"
              onClick={running ? stopSummary : () => void generate()}
              disabled={!running && !canRun}
              style={{ minHeight: 38, padding: "0 18px", borderRadius: 8, justifyContent: "center", background: running ? "var(--surface-hi)" : "var(--accent)", color: running ? "var(--text-hi)" : "var(--accent-contrast)", opacity: running || canRun ? 1 : 0.6, flexShrink: 0, whiteSpace: "nowrap", fontWeight: 600 }}
            >
              {running ? t("summary.stop") : summaries.length ? t("summary.regenerate") : t("summary.generate")}
            </button>
          </div>

          {!backend && (
            <div style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.5 }}>{t("summary.noModel")}</div>
          )}

          {running && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-mid)" }}>{progressLabel()}</div>
              <div style={{ width: "100%", height: 8, borderRadius: 999, background: "var(--progress-track)", overflow: "hidden" }}>
                <div style={{ width: `${progressPercent()}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 0.3s ease" }} />
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>{error}</div>
          )}
        </div>

        {/* Summary history — same table as the main history list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)" }}>{t("summary.history.title")}</div>
          {summaries.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.6 }}>{t("summary.history.empty")}</div>
          ) : (
            <table className="b-table" style={{ background: "transparent" }}>
              <thead>
                <tr>
                  <th style={{ width: 124 }}>{t("mainTab.colTime")}</th>
                  <th style={{ paddingLeft: 8 }}>{t("mainTab.colText")}</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((item, index) => {
                  const expanded = expandedId === item.id;
                  const isEditing = editingId === item.id;
                  const tooLong = item.text.length > TEXT_PREVIEW_LIMIT;
                  const visible = tooLong && !expanded ? `${item.text.slice(0, TEXT_PREVIEW_LIMIT).trimEnd()}...` : item.text;
                  return (
                    <tr
                      key={item.id}
                      style={{ borderBottom: index < summaries.length - 1 ? "1px solid var(--table-row-border)" : "none", cursor: "default" }}
                    >
                      <td style={{ verticalAlign: "top", color: "var(--text-low)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ whiteSpace: "nowrap" }}>{formatTime(item.createdAt)}</span>
                          <span style={{ fontSize: 10, opacity: 0.55, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{formatDurationMs(item.durationMs, lang)}</span>
                          <span style={{ fontSize: 10, opacity: 0.55, letterSpacing: "0.02em", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.35 }}>{item.promptName}</span>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "top", paddingLeft: 8 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
                          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
                            {isEditing ? (
                              <>
                                <textarea
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  className="input"
                                  style={{ width: "100%", minHeight: 320, padding: 12, fontSize: 13, lineHeight: 1.6, resize: "vertical", fontFamily: "var(--font-main)" }}
                                />
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                  <button type="button" className="btn" onClick={() => setEditingId(null)} style={{ minHeight: 32, padding: "0 12px" }}>{t("summary.cancel")}</button>
                                  <button type="button" className="btn" onClick={() => void saveEdit(item)} style={{ minHeight: 32, padding: "0 14px", background: "var(--accent)", color: "var(--accent-contrast)" }}>{t("summary.save")}</button>
                                </div>
                              </>
                            ) : (
                              <div style={{ display: "grid", gap: 2, color: "var(--text-mid)", lineHeight: 1.7, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                                <span style={{ whiteSpace: "pre-wrap" }}>{visible}</span>
                                {tooLong && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(expanded ? null : item.id)}
                                    style={{ marginLeft: 0, padding: 0, border: "none", background: "transparent", color: "var(--text-hi)", fontSize: 13, fontWeight: 600, cursor: "pointer", justifySelf: "start" }}
                                  >
                                    {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <RowActionsMenu
                            label={t("summary.actions")}
                            items={[
                              { key: "copy", label: copiedId === item.id ? t("summary.copied") : t("summary.copy"), icon: copiedId === item.id ? <IconCheck size={14} stroke={2.5} /> : <IconClipboard size={14} stroke={2} />, onSelect: () => void copy(item) },
                              { key: "edit", label: t("summary.edit"), icon: <IconPencil size={14} stroke={2} />, onSelect: () => startEdit(item) },
                              { key: "delete", label: t("summary.delete"), icon: <IconTrash size={14} stroke={2} />, danger: true, onSelect: () => void remove(item) },
                            ] as RowActionItem[]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SlideOverModal>
  );
}
