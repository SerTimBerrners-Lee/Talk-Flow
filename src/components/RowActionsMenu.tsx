import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface RowActionItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip shown on a disabled item, explaining why it can't be used. */
  hint?: string;
}

/**
 * Compact "⋯" button that opens a small dropdown of row actions. Reused by the
 * history rows (MainTab) and the summary-history rows (SummaryModal). Closes on
 * outside click or after an item is chosen.
 */
export function RowActionsMenu({
  items,
  label,
}: {
  items: RowActionItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="btn"
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        style={{ width: 32, minWidth: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 8, flexShrink: 0, justifyContent: "center" }}
      >
        <MoreHorizontal size={15} strokeWidth={2} />
      </button>

      {open && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 168,
            background: "var(--dropdown-bg)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-panel)",
            zIndex: 50,
            padding: 6,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "transparent",
                cursor: item.disabled ? "not-allowed" : "pointer",
                padding: "9px 10px",
                borderRadius: 8,
                fontSize: 13,
                fontFamily: "var(--font-main)",
                color: item.danger ? "var(--danger)" : "var(--text-hi)",
                opacity: item.disabled ? 0.45 : 1,
              }}
              onMouseEnter={(event) => {
                if (!item.disabled) event.currentTarget.style.background = "var(--dropdown-hover)";
              }}
              onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
