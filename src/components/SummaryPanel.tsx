import { useEffect, useState } from "react";
import { Check, Clipboard, Loader2, Sparkles } from "lucide-react";

import {
  getSettings,
  listPromptsByKind,
  type AppSettings,
} from "../lib/store";
import {
  summarizeWithCloud,
  willUseMapReduce,
  type SummarizeProgress,
} from "../lib/summarize";
import { formatErrorMessage } from "../lib/utils";

/**
 * Post-transcription summary panel. Lets the user pick a prompt from the
 * library and run it over the transcript through Talkis Cloud (Phase 1).
 * Long transcripts are summarized with map-reduce inside `summarizeWithCloud`.
 */
export function SummaryPanel({ text }: { text: string }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [promptId, setPromptId] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SummarizeProgress | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings({ reload: true })
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setPromptId((current) => current || next.defaultSummaryPromptId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const prompts = settings ? listPromptsByKind(settings, "summary") : [];
  const selected =
    prompts.find((preset) => preset.id === promptId) ?? prompts[0];
  const hasCloud = Boolean(settings?.deviceToken?.trim());
  const canRun = Boolean(settings && selected && text.trim() && hasCloud);

  const run = async (): Promise<void> => {
    if (!settings || !selected) return;
    if (!text.trim()) {
      setError("Нет текста для summary");
      return;
    }

    setRunning(true);
    setError(null);
    setOutput("");
    setProgress(null);

    try {
      const result = await summarizeWithCloud({
        text,
        prompt: selected,
        settings,
        onProgress: setProgress,
      });
      setOutput(result.trim());
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  };

  const progressLabel = (): string => {
    if (!progress) return "Готовим summary…";
    if (progress.phase === "map") {
      return `Обрабатываем часть ${progress.current} из ${progress.total}…`;
    }
    if (progress.phase === "reduce") {
      return "Объединяем части…";
    }
    return "Готовим summary…";
  };

  return (
    <div
      className="card"
      style={{ padding: 14, display: "grid", gap: 12, marginTop: 12 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--text-hi)",
        }}
      >
        <Sparkles size={16} strokeWidth={1.9} />
        Summary
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <select
          value={selected?.id ?? ""}
          onChange={(e) => setPromptId(e.target.value)}
          disabled={running || prompts.length === 0}
          style={{
            flex: "1 1 200px",
            minWidth: 160,
            padding: "9px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--control-bg)",
            color: "var(--text-hi)",
            fontSize: 13,
            fontFamily: "var(--font-main)",
          }}
        >
          {prompts.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn"
          onClick={() => void run()}
          disabled={!canRun || running}
          style={{ minHeight: 36, padding: "0 16px" }}
        >
          {running ? (
            <Loader2
              size={14}
              strokeWidth={2.2}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Sparkles size={14} strokeWidth={2} />
          )}
          {running ? "Готовим…" : "Сделать summary"}
        </button>
      </div>

      {!hasCloud && (
        <div style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.5 }}>
          Для summary нужен вход в Talkis Cloud (вкладка «Модели»). Локальные и
          API-модели для summary добавим следующими шагами.
        </div>
      )}

      {willUseMapReduce(text) && (
        <div style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.5 }}>
          Длинная расшифровка — обработаем по частям и соберём общий результат.
        </div>
      )}

      {running && (
        <div style={{ fontSize: 12, color: "var(--text-mid)" }}>
          {progressLabel()}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {output && (
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div className="label">Результат summary</div>
            <button
              type="button"
              className="btn"
              onClick={() => void copy()}
              style={{ minHeight: 30, padding: "0 12px" }}
            >
              {copied ? (
                <Check size={13} strokeWidth={2.2} />
              ) : (
                <Clipboard size={13} strokeWidth={2} />
              )}
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-hi)",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 14,
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {output}
          </div>
        </div>
      )}
    </div>
  );
}
