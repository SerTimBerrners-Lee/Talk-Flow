export interface HotkeyPreviewKeyboardEvent {
  code: string;
  key: string;
}

export function canonicalHotkeyPreviewKey(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (["cmd", "command", "meta"].includes(lower)) return "Command";
  if (["ctrl", "control"].includes(lower)) return "Control";
  if (["alt", "option"].includes(lower)) return "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "space" || value === " ") return "Space";
  if (lower === "escape" || lower === "esc") return "Escape";
  if (lower.startsWith("arrow")) return trimmed.slice(5);

  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

export function hotkeyPreviewKeys(label: string): string[] {
  return label
    .split(/\s*\+\s*/)
    .map(canonicalHotkeyPreviewKey)
    .filter(Boolean);
}

export function hotkeyPreviewKeyFromKeyboardEvent(
  event: HotkeyPreviewKeyboardEvent,
): string | null {
  const code = event.code.trim();

  if (code.startsWith("Shift")) return "Shift";
  if (code.startsWith("Meta") || code.startsWith("OS")) return "Command";
  if (code.startsWith("Control")) return "Control";
  if (code.startsWith("Alt")) return "Alt";
  if (code === "Space") return "Space";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code.slice(5);
  if (code === "Enter" || code === "Escape") return code;

  const fallback = canonicalHotkeyPreviewKey(event.key);
  return fallback ? fallback : null;
}

export function hotkeyPreviewMatches(left: string, right: string): boolean {
  const leftKeys = [...hotkeyPreviewKeys(left)].sort();
  const rightKeys = [...hotkeyPreviewKeys(right)].sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
  );
}
