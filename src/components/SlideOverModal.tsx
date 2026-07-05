import { useEffect, useState, type ReactNode } from "react";
import { IconX } from "../lib/icons";

import { useI18n } from "../lib/i18n";

/**
 * A panel that slides in from the right over a dimmed backdrop. Closes on the
 * close button, a click on the free area to the left (backdrop), or Escape.
 * Manages its own enter/exit animation, then calls `onClose` once the exit
 * transition finishes, so the parent can simply unmount it.
 */
export function SlideOverModal({
  onClose,
  title,
  width = 440,
  topOffset = 0,
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  width?: number | string;
  topOffset?: number | string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = () => {
    setEntered(false);
    window.setTimeout(onClose, 240);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onClick={requestClose}
      style={{
        position: "fixed",
        top: topOffset,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
        background: entered ? "rgba(0,0,0,0.32)" : "rgba(0,0,0,0)",
        transition: "background 0.24s ease",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width,
          maxWidth: "100vw",
          height: "100%",
          background: "var(--surface-solid)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow-panel)",
          transform: entered ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 750, color: "var(--text-hi)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          <button
            type="button"
            className="btn"
            onClick={requestClose}
            title={t("summary.close")}
            aria-label={t("summary.close")}
            style={{ width: 32, minWidth: 32, minHeight: 32, padding: 0, justifyContent: "center", flexShrink: 0 }}
          >
            <IconX size={14} stroke={2} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
