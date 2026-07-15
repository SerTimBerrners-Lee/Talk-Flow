import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { IconDots } from "../lib/icons";
import {
  resolveRowActionsMenuPosition,
  type MenuPosition,
} from "./rowActionsMenuPosition";

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
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback((): void => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    const anchorRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(
      resolveRowActionsMenuPosition({
        anchorRight: anchorRect.right,
        anchorTop: anchorRect.top,
        anchorBottom: anchorRect.bottom,
        menuWidth: menuRect.width,
        menuHeight: menuRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
  }, [items, open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target))
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
        <button
          ref={buttonRef}
          type="button"
          className="btn"
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          style={{
            width: 32,
            minWidth: 32,
            height: 32,
            minHeight: 32,
            padding: 0,
            borderRadius: 8,
            flexShrink: 0,
            justifyContent: "center",
          }}
        >
          <IconDots size={15} stroke={2} />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              minWidth: 168,
              background: "var(--dropdown-bg)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-panel)",
              zIndex: 1000,
              padding: 6,
              display: "flex",
              flexDirection: "column",
              visibility: position ? "visible" : "hidden",
            }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
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
                  if (!item.disabled)
                    event.currentTarget.style.background =
                      "var(--dropdown-hover)";
                }}
                onMouseLeave={(event) =>
                  (event.currentTarget.style.background = "transparent")
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
