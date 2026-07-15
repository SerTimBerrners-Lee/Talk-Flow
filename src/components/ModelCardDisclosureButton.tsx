import type { ReactElement } from "react";

import { IconChevronDown } from "../lib/icons";

export function ModelCardDisclosureButton({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={onToggle}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        zIndex: 1,
        width: 24,
        height: 24,
        margin: 0,
        padding: 0,
        borderRadius: 7,
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--text-low)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontFamily: "var(--font-main)",
      }}
    >
      <IconChevronDown
        size={15}
        stroke={2}
        aria-hidden="true"
        style={{
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 160ms ease",
        }}
      />
    </button>
  );
}
