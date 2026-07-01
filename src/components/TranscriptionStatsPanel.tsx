import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";

import { logError } from "../lib/logger";
import {
  getEmptyView,
  getTranscriptionStatsView,
  STATS_UPDATED_EVENT,
  type TranscriptionStatsView,
} from "../lib/stats";
import { useI18n } from "../lib/i18n";

type TranslateFn = ReturnType<typeof useI18n>["t"];

function compact(scaled: number, suffix: string): string {
  // One decimal below 100 (12,5к), whole numbers above (123к); comma decimal.
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
  return `${text}${suffix}`;
}

/** Full number up to 10k, then abbreviated: 200000 → "200к", 1 200 000 → "1,2М". */
function formatStatValue(value: number, t: TranslateFn): string {
  if (value < 10_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return compact(value / 1000, t("stats.suffix.thousand"));
  }
  return compact(value / 1_000_000, t("stats.suffix.million"));
}

interface StatItem {
  key: string;
  label: string;
  value: string;
}

interface TranscriptionStatsPanelProps {
  footer?: ReactNode;
}

function buildStats(view: TranscriptionStatsView, t: TranslateFn): StatItem[] {
  return [
    {
      key: "today",
      label: t("stats.wordsToday"),
      value: formatStatValue(view.todayWords, t),
    },
    {
      key: "month",
      label: t("stats.wordsThisMonth"),
      value: formatStatValue(view.monthWords, t),
    },
    {
      key: "speed",
      label: t("stats.wordsPerMinute"),
      value: view.hasSpeed ? formatStatValue(view.averageWpm, t) : "—",
    },
  ];
}

export function TranscriptionStatsPanel({
  footer,
}: TranscriptionStatsPanelProps): ReactElement {
  const { t } = useI18n();
  const [view, setView] = useState<TranscriptionStatsView>(() => getEmptyView());

  useEffect(() => {
    let active = true;

    const loadStats = async (): Promise<void> => {
      try {
        const next = await getTranscriptionStatsView();
        if (active) {
          setView(next);
        }
      } catch (error) {
        void logError(
          "STATS",
          `Failed to load stats view: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadStats();
    const unlisten = listen(STATS_UPDATED_EVENT, () => {
      void loadStats();
    });

    return () => {
      active = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  const stats = buildStats(view, t);

  return (
    <section
      className="stats-glass-card"
      style={{
        display: "grid",
        gap: 14,
        padding: "16px 18px 14px",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {stats.map(({ key, label, value }) => (
          <div
            key={key}
            className="stats-glass-metric"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              minWidth: 0,
              minHeight: 72,
              padding: "8px 10px",
              textAlign: "center",
            }}
          >
            <span
              className="headline-accent"
              style={{ fontSize: 28, color: "var(--text-hi)" }}
            >
              {value}
            </span>
            <span className="label">{label}</span>
          </div>
        ))}
      </div>

      {footer ? (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: 12,
          }}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}
