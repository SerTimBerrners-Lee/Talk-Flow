import type { ReactElement } from "react";

interface WidgetRecordButtonProps {
  label: string;
  left: number;
  visible: boolean;
  onActivate: () => void;
}

export function WidgetRecordButton({
  label,
  left,
  visible,
  onActivate,
}: WidgetRecordButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      style={{
        position: "absolute",
        left,
        top: "50%",
        width: 12,
        height: 12,
        border: "none",
        borderRadius: 999,
        padding: 0,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateY(-50%) scale(1)"
          : "translateY(-50%) scale(0.84)",
        transition: "opacity 0.14s ease, transform 0.14s ease",
        pointerEvents: visible ? "auto" : "none",
        cursor: "pointer",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "#ff4d4d",
          boxShadow: "none",
        }}
      />
    </button>
  );
}
