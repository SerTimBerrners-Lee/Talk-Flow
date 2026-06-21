// Web-based hotkey capture helpers (used on Windows/Linux, and as the shared
// candidate format everywhere). Kept dependency-free so it can be unit-tested.
//
// The main key is derived from `event.code` (the PHYSICAL key) rather than
// `event.key` (the produced character). This is critical on Windows where
// Ctrl+Alt behaves as AltGr and mangles `event.key` for letters/digits, and on
// any non-US keyboard layout. `event.code` is layout- and modifier-independent.

export type FrontendHotkeyCaptureEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const CODE_MAIN_KEYS: Record<string, string> = {
  Space: "Space",
  Escape: "Escape",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

function mainKeyFromCode(code: string | undefined): string | null {
  if (!code) {
    return null;
  }

  if (CODE_MAIN_KEYS[code]) {
    return CODE_MAIN_KEYS[code];
  }

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    return letter[1];
  }

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    return digit[1];
  }

  const numpadDigit = /^Numpad([0-9])$/.exec(code);
  if (numpadDigit) {
    return numpadDigit[1];
  }

  if (/^F(?:[1-9]|1[0-2])$/.test(code)) {
    return code;
  }

  return null;
}

function mainKeyFromKey(rawKey: string): string | null {
  if (rawKey === " ") return "Space";

  const key = rawKey.trim();
  const lower = key.toLowerCase();

  if (!key || lower === "control" || lower === "alt" || lower === "shift" || lower === "meta") {
    return null;
  }

  const named: Record<string, string> = {
    escape: "Escape",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
  };
  if (named[lower]) {
    return named[lower];
  }

  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();

  return null;
}

export function hotkeyMainKeyFromKeyboardEvent(
  event: FrontendHotkeyCaptureEvent,
): string | null {
  // Physical key first (layout/AltGr independent), produced character as fallback.
  return mainKeyFromCode(event.code) ?? mainKeyFromKey(event.key);
}

export function buildFrontendHotkeyCandidate(
  event: FrontendHotkeyCaptureEvent,
): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Command");

  const mainKey = hotkeyMainKeyFromKeyboardEvent(event);
  if (mainKey) parts.push(mainKey);

  return parts.length > 0 ? parts.join("+") : null;
}
