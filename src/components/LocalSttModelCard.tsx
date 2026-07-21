import type { ReactElement, ReactNode } from "react";

import {
  IconBroadcast,
  IconCheck,
  IconDownload,
  IconGauge,
  IconGlobe,
  IconTargetArrow,
} from "../lib/icons";
import { ModelCardDisclosureButton } from "./ModelCardDisclosureButton";

export interface LocalSttModelCardStats {
  storageLabel: string;
  storageTitle: string;
  languageLabel: string;
  languageTitle: string;
  speedLabel: string;
  speedTitle: string;
  accuracyLabel: string;
  accuracyTitle: string;
  streamingLabel?: string;
}

export interface LocalSttModelCardProgress {
  message: string;
  percent?: number;
  valueLabel?: string;
  downloadedLabel?: string;
  totalLabel?: string;
  totalTemplate?: string;
}

export interface LocalSttModelCardNotice {
  message: string;
  tone: "neutral" | "error";
}

export function LocalSttModelCard({
  name,
  description,
  recommendedLabel,
  statusLabel,
  statusColor,
  expanded,
  onToggle,
  disclosureLabel,
  stats,
  notice,
  progress,
  connectionLabel,
  connectionColor,
  showConnectionCheck,
  actions,
}: {
  name: string;
  description: string;
  recommendedLabel?: string;
  statusLabel: string;
  statusColor: string;
  expanded: boolean;
  onToggle: () => void;
  disclosureLabel: string;
  stats: LocalSttModelCardStats;
  notice?: LocalSttModelCardNotice;
  progress?: LocalSttModelCardProgress;
  connectionLabel?: string;
  connectionColor?: string;
  showConnectionCheck?: boolean;
  actions: ReactNode;
}): ReactElement {
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          position: "relative",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          textAlign: "left",
          fontFamily: "var(--font-main)",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 3,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-hi)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {name}
              </div>
              {recommendedLabel && (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: "var(--text-hi)",
                    padding: "3px 7px",
                    borderRadius: 999,
                    background: "var(--control-muted)",
                    flexShrink: 0,
                  }}
                >
                  {recommendedLabel}
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: statusColor,
                padding: "5px 9px",
                borderRadius: 999,
                background: "var(--control-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {statusLabel}
            </div>
          </div>
          <div style={{ paddingRight: 34 }}>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--text-mid)",
              }}
            >
              {description}
            </div>
            <ModelStats stats={stats} />
          </div>
          <ModelCardDisclosureButton
            expanded={expanded}
            onToggle={onToggle}
            label={disclosureLabel}
          />
        </div>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {notice && (
            <div
              role={notice.tone === "error" ? "alert" : undefined}
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                padding: "8px 10px",
                borderRadius: 8,
                background:
                  notice.tone === "error"
                    ? "var(--danger-soft)"
                    : "var(--control-muted)",
                color:
                  notice.tone === "error"
                    ? "var(--error-bright)"
                    : "var(--text-mid)",
                border: `1px solid ${
                  notice.tone === "error"
                    ? "var(--danger-border)"
                    : "var(--border-subtle)"
                }`,
              }}
            >
              {notice.message}
            </div>
          )}

          {progress && <ModelProgress progress={progress} />}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {connectionLabel && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: connectionColor || "var(--text-mid)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {showConnectionCheck && <IconCheck size={15} stroke={2.5} />}
                {connectionLabel}
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                marginLeft: "auto",
              }}
            >
              {actions}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelStats({
  stats,
}: {
  stats: LocalSttModelCardStats;
}): ReactElement {
  const items = [
    {
      key: "storage",
      title: stats.storageTitle,
      value: stats.storageLabel,
      Icon: IconDownload,
    },
    {
      key: "language",
      title: stats.languageTitle,
      value: stats.languageLabel,
      Icon: IconGlobe,
    },
    {
      key: "speed",
      title: stats.speedTitle,
      value: stats.speedLabel,
      Icon: IconGauge,
    },
    {
      key: "accuracy",
      title: stats.accuracyTitle,
      value: stats.accuracyLabel,
      Icon: IconTargetArrow,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 9,
        flexWrap: "nowrap",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {items.map(({ key, title, value, Icon }) => (
        <div
          key={key}
          title={title}
          aria-label={title}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
          }}
        >
          <Icon size={14} stroke={1.9} color="var(--text-hi)" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 650,
              color: "var(--text-hi)",
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </span>
        </div>
      ))}
      {stats.streamingLabel && (
        <div
          title={stats.streamingLabel}
          aria-label={stats.streamingLabel}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
          }}
        >
          <IconBroadcast size={14} stroke={1.9} color="var(--text-hi)" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 650,
              color: "var(--text-hi)",
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {stats.streamingLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function ModelProgress({
  progress,
}: {
  progress: LocalSttModelCardProgress;
}): ReactElement {
  return (
    <div
      role="status"
      style={{ display: "flex", flexDirection: "column", gap: 7 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 12,
          color: "var(--text-mid)",
          fontWeight: 650,
        }}
      >
        <span>{progress.message}</span>
        <span style={{ color: "var(--text-hi)" }}>
          {progress.percent !== undefined
            ? `${progress.percent}%`
            : progress.valueLabel || progress.downloadedLabel}
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          width: "100%",
          height: 8,
          borderRadius: 999,
          background: "var(--progress-track)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress.percent ?? 2}%`,
            minWidth: progress.percent === undefined ? 18 : 0,
            height: "100%",
            borderRadius: 999,
            background: "var(--accent)",
            transition: "width 0.2s ease",
          }}
        />
      </div>
      {(progress.downloadedLabel || progress.totalLabel) && (
        <div
          style={{ fontSize: 11, color: "var(--text-low)", lineHeight: 1.4 }}
        >
          {progress.downloadedLabel}
          {progress.totalLabel
            ? ` ${progress.totalTemplate || progress.totalLabel}`
            : ""}
        </div>
      )}
    </div>
  );
}
