import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";

import { logError } from "../lib/logger";
import {
  getEmptyView,
  getTranscriptionStatsView,
  STATS_UPDATED_EVENT,
  type TranscriptionStatsView,
} from "../lib/stats";

function compact(scaled: number, suffix: string): string {
  // One decimal below 100 (12,5к), whole numbers above (123к); comma decimal.
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
  return `${text}${suffix}`;
}

/** Full number up to 10k, then abbreviated: 200000 → "200к", 1 200 000 → "1,2М". */
function formatStatValue(value: number): string {
  if (value < 10_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return compact(value / 1000, "к");
  }
  return compact(value / 1_000_000, "М");
}

interface StatItem {
  key: string;
  label: string;
  value: string;
}

function buildStats(view: TranscriptionStatsView): StatItem[] {
  return [
    {
      key: "month",
      label: "Слов за месяц",
      value: formatStatValue(view.monthWords),
    },
    {
      key: "all",
      label: "Слов всего",
      value: formatStatValue(view.allTimeWords),
    },
    {
      key: "speed",
      label: "Слов в минуту",
      value: view.hasSpeed ? formatStatValue(view.averageWpm) : "—",
    },
  ];
}

export function TranscriptionStatsPanel(): ReactElement {
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

  const stats = buildStats(view);

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
        padding: "14px 2px 18px",
      }}
    >
      {stats.map(({ key, label, value }) => (
        <div
          key={key}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            minWidth: 0,
            textAlign: "center",
          }}
        >
          <span className="headline-accent" style={{ fontSize: 28, color: "var(--text-hi)" }}>
            {value}
          </span>
          <span className="label">{label}</span>
        </div>
      ))}
    </section>
  );
}
