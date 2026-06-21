import { describe, expect, it } from "bun:test";

import {
  buildFrontendHotkeyCandidate,
  hotkeyMainKeyFromKeyboardEvent,
  type FrontendHotkeyCaptureEvent,
} from "./frontendHotkeyCapture";

function ev(overrides: Partial<FrontendHotkeyCaptureEvent>): FrontendHotkeyCaptureEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("hotkeyMainKeyFromKeyboardEvent", () => {
  it("maps physical letter/digit codes regardless of produced char", () => {
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "KeyK", key: "k" }))).toBe("K");
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "Digit5", key: "5" }))).toBe("5");
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "Space", key: " " }))).toBe("Space");
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "F8", key: "F8" }))).toBe("F8");
  });

  it("ignores modifier-only events", () => {
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "ControlLeft", key: "Control" }))).toBeNull();
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "AltRight", key: "Alt" }))).toBeNull();
  });

  it("falls back to event.key when code is unknown/missing", () => {
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "", key: "j" }))).toBe("J");
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "", key: "ArrowUp" }))).toBe("Up");
  });

  it("normalizes numpad and arrow codes", () => {
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "Numpad3" }))).toBe("3");
    expect(hotkeyMainKeyFromKeyboardEvent(ev({ code: "ArrowLeft" }))).toBe("Left");
  });
});

describe("buildFrontendHotkeyCandidate", () => {
  it("builds a normalized-order candidate with modifiers", () => {
    expect(
      buildFrontendHotkeyCandidate(ev({ ctrlKey: true, shiftKey: true, code: "KeyA", key: "a" })),
    ).toBe("Control+Shift+A");
  });

  it("Windows AltGr / non-US layout regression: foreign key char still resolves via code", () => {
    // On Windows Ctrl+Alt = AltGr, and on a Russian layout the physical KeyK
    // produces event.key "л". The physical code must still win.
    const candidate = buildFrontendHotkeyCandidate(
      ev({ ctrlKey: true, altKey: true, code: "KeyK", key: "л" }),
    );
    expect(candidate).toBe("Control+Alt+K");
  });

  it("returns the Command modifier for the meta key", () => {
    expect(
      buildFrontendHotkeyCandidate(ev({ metaKey: true, shiftKey: true, code: "Space", key: " " })),
    ).toBe("Shift+Command+Space");
  });

  it("returns just the modifier while only a modifier is held (rejected later by normalize)", () => {
    expect(buildFrontendHotkeyCandidate(ev({ ctrlKey: true, code: "ControlLeft", key: "Control" }))).toBe(
      "Control",
    );
  });

  it("returns null when nothing usable is pressed", () => {
    expect(buildFrontendHotkeyCandidate(ev({ code: "ControlLeft", key: "Control" }))).toBeNull();
  });
});
