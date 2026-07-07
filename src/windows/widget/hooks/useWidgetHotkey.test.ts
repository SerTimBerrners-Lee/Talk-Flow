import { describe, expect, test } from "bun:test";

import {
  resolveHandyHotkeyIntent,
  resolveSelectionHotkeyAction,
} from "./useWidgetHotkey";

describe("resolveHandyHotkeyIntent", () => {
  test("voice hotkey wins when selection hotkey accidentally matches it", () => {
    expect(
      resolveHandyHotkeyIntent({
        eventHotkey: "Shift+Command+V",
        voiceHotkey: "Shift+Command+V",
        selectionHotkey: "Shift+Command+V",
        selectionEnabled: true,
      }),
    ).toBe("voice");
  });

  test("disabled selection hotkey falls back to voice", () => {
    expect(
      resolveHandyHotkeyIntent({
        eventHotkey: "Shift+Command+V",
        voiceHotkey: "Shift+Command+V",
        selectionHotkey: "Shift+Command+V",
        selectionEnabled: false,
      }),
    ).toBe("voice");
  });
});

describe("resolveSelectionHotkeyAction", () => {
  test("arms on press and triggers on release", () => {
    expect(resolveSelectionHotkeyAction("Pressed", false)).toBe("arm");
    expect(resolveSelectionHotkeyAction("Released", true)).toBe("trigger");
  });

  test("release without prior press is consumed", () => {
    expect(resolveSelectionHotkeyAction("Released", false)).toBe("consume");
  });
});
