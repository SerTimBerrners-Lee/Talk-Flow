import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Custom select styled like the dropdowns in Settings (a `.btn` trigger + a
 * popover list with a check on the active item) — used instead of a native
 * <select> so it matches the rest of the app.
 */
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
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

  const current = options.find((option) => option.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 38,
          padding: "0 10px",
          borderRadius: 8,
          fontSize: 13,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? value}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            maxHeight: 280,
            overflow: "auto",
            background: "var(--dropdown-bg)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "var(--shadow-panel)",
            zIndex: 100,
            padding: 6,
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  padding: "9px 12px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  background: active ? "var(--dropdown-active)" : "transparent",
                  color: active ? "var(--text-hi)" : "var(--text-mid)",
                  fontSize: 13,
                  fontFamily: "var(--font-main)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = active ? "var(--dropdown-active)" : "var(--dropdown-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--dropdown-active)" : "transparent")}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                {active && <Check size={14} strokeWidth={2.5} style={{ flexShrink: 0, color: "var(--text-hi)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
