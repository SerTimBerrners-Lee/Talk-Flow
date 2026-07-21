import type { ReactElement } from "react";

import { canonicalHotkeyPreviewKey } from "../lib/hotkeyPreview";

export function HotkeyKeycaps({
  label,
  pressedKeys = new Set(),
  size = "default",
}: {
  label: string;
  pressedKeys?: ReadonlySet<string>;
  size?: "default" | "large";
}): ReactElement {
  const keys = label
    .split(/\s+\+\s+/)
    .map((key) => key.trim())
    .filter(Boolean);

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minWidth: 0,
      }}
    >
      {keys.map((key, index) => {
        const pressed = pressedKeys.has(canonicalHotkeyPreviewKey(key));
        return (
          <span
            key={`${key}-${index}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            {index > 0 && (
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: size === "large" ? 15 : 11,
                  fontWeight: 650,
                }}
              >
                +
              </span>
            )}
            <kbd
              className={`hotkey-keycap${size === "large" ? " is-large" : ""}${pressed ? " is-pressed" : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-main)",
                fontWeight: 750,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {key}
            </kbd>
          </span>
        );
      })}
    </span>
  );
}
