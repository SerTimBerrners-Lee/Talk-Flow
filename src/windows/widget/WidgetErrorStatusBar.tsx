import type { ReactElement } from "react";

import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconCopy,
} from "../../lib/icons";

interface WidgetErrorStatusBarProps {
  message: string;
  copied: boolean;
  expanded: boolean;
  onCopy: () => void;
  onToggleExpanded: () => void;
}

const ACTION_BUTTON_STYLE = {
  width: 22,
  height: 22,
  flex: "0 0 auto",
  border: "1px solid var(--danger-border)",
  borderRadius: 8,
  background: "var(--control-bg)",
  color: "var(--danger)",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
} as const;

export function WidgetErrorStatusBar({
  message,
  copied,
  expanded,
  onCopy,
  onToggleExpanded,
}: WidgetErrorStatusBarProps): ReactElement {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        flex: expanded ? "1 1 auto" : "0 0 auto",
        minHeight: expanded ? 0 : 30,
        maxHeight: "100%",
        marginTop: 6,
        padding: expanded ? "7px 5px 7px 9px" : "3px 4px 3px 9px",
        display: "grid",
        gridTemplateColumns: "14px minmax(0, 1fr) auto",
        alignItems: expanded ? "start" : "center",
        gap: 6,
        border: "1px solid var(--danger-border)",
        borderRadius: 10,
        background: "var(--danger-soft)",
        color: "var(--danger)",
        overflow: "hidden",
      }}
    >
      <IconAlertCircle
        size={13}
        stroke={2.2}
        aria-hidden="true"
        style={{ marginTop: expanded ? 4 : 0 }}
      />
      <div
        title={expanded ? undefined : message}
        style={
          expanded
            ? {
                minWidth: 0,
                maxHeight: "100%",
                padding: "2px 2px 2px 0",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: 10.5,
                lineHeight: 1.4,
                fontWeight: 600,
              }
            : {
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 10.5,
                lineHeight: 1.35,
                fontWeight: 650,
              }
        }
      >
        {message}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        <button
          type="button"
          aria-label="Скопировать сообщение об ошибке"
          title={copied ? "Сообщение скопировано" : "Скопировать сообщение"}
          onClick={onCopy}
          onPointerDown={(event) => event.stopPropagation()}
          style={ACTION_BUTTON_STYLE}
        >
          {copied ? (
            <IconCheck size={12} stroke={2.4} />
          ) : (
            <IconCopy size={12} stroke={2} />
          )}
        </button>
        <button
          type="button"
          aria-label={expanded ? "Свернуть сообщение" : "Раскрыть сообщение"}
          title={expanded ? "Свернуть сообщение" : "Показать сообщение полностью"}
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          onPointerDown={(event) => event.stopPropagation()}
          style={ACTION_BUTTON_STYLE}
        >
          <IconChevronDown
            size={12}
            stroke={2.2}
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.18s var(--ease-standard)",
            }}
          />
        </button>
      </div>
    </div>
  );
}
