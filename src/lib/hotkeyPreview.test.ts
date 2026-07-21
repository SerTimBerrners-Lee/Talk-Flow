import { describe, expect, test } from "bun:test";

import {
  canonicalHotkeyPreviewKey,
  hotkeyPreviewKeyFromKeyboardEvent,
  hotkeyPreviewKeys,
  hotkeyPreviewMatches,
} from "./hotkeyPreview";

describe("hotkey preview", () => {
  test("normalizes platform modifier aliases", () => {
    expect(canonicalHotkeyPreviewKey("Cmd")).toBe("Command");
    expect(canonicalHotkeyPreviewKey("Option")).toBe("Alt");
    expect(canonicalHotkeyPreviewKey("Ctrl")).toBe("Control");
  });

  test("maps physical modifier and main-key events", () => {
    expect(
      hotkeyPreviewKeyFromKeyboardEvent({ code: "ShiftLeft", key: "Shift" }),
    ).toBe("Shift");
    expect(
      hotkeyPreviewKeyFromKeyboardEvent({ code: "MetaLeft", key: "Meta" }),
    ).toBe("Command");
    expect(hotkeyPreviewKeyFromKeyboardEvent({ code: "Space", key: " " })).toBe(
      "Space",
    );
  });

  test("splits a formatted keycap label", () => {
    expect(hotkeyPreviewKeys("Command + Shift + Space")).toEqual([
      "Command",
      "Shift",
      "Space",
    ]);
  });

  test("matches the same chord regardless of aliases and order", () => {
    expect(
      hotkeyPreviewMatches("Command + Shift + Space", "Shift+Meta+Space"),
    ).toBe(true);
    expect(hotkeyPreviewMatches("Alt+Space", "Control+Space")).toBe(false);
  });
});
