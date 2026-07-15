import { describe, expect, test } from "bun:test";

import {
  cancelHotkeyCapture,
  createHotkeyCaptureMachineState,
  hotkeyCaptureKeyDown,
  hotkeyCaptureKeyUp,
  type HotkeyCaptureKeyboardEvent,
  type HotkeyCaptureMachineState,
} from "./hotkeyCaptureMachine";

function event(
  code: string,
  key: string,
  overrides: Partial<HotkeyCaptureKeyboardEvent> = {},
): HotkeyCaptureKeyboardEvent {
  return {
    altKey: false,
    code,
    ctrlKey: false,
    key,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  };
}

function down(
  state: HotkeyCaptureMachineState,
  input: HotkeyCaptureKeyboardEvent,
): HotkeyCaptureMachineState {
  return hotkeyCaptureKeyDown(state, input).state;
}

describe("hotkey capture machine", () => {
  test("completes only after main key and every modifier are released", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("ControlLeft", "Control", { ctrlKey: true }));
    state = down(state, event("KeyK", "л", { ctrlKey: true }));

    const mainUp = hotkeyCaptureKeyUp(
      state,
      event("KeyK", "л", { ctrlKey: true }),
    );
    expect(mainUp.effect.type).toBe("preview");

    const modifierUp = hotkeyCaptureKeyUp(
      mainUp.state,
      event("ControlLeft", "Control"),
    );
    expect(modifierUp.effect).toEqual({
      type: "completed",
      hotkey: "Control+K",
    });
  });

  test("supports releasing modifiers before the main key", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("AltLeft", "Alt", { altKey: true }));
    state = down(state, event("ArrowLeft", "ArrowLeft", { altKey: true }));
    const modifierUp = hotkeyCaptureKeyUp(state, event("AltLeft", "Alt"));
    expect(modifierUp.effect.type).toBe("preview");
    expect(
      hotkeyCaptureKeyUp(modifierUp.state, event("ArrowLeft", "ArrowLeft"))
        .effect,
    ).toEqual({ type: "completed", hotkey: "Alt+Left" });
  });

  test("ignores autorepeat and duplicate keydown", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("ShiftLeft", "Shift", { shiftKey: true }));
    state = down(state, event("KeyA", "a", { shiftKey: true }));
    const repeated = hotkeyCaptureKeyDown(
      state,
      event("KeyA", "a", { repeat: true, shiftKey: true }),
    );
    expect(repeated.effect.type).toBe("none");
    expect(repeated.state).toBe(state);
  });

  test("cancels on bare Escape", () => {
    const result = hotkeyCaptureKeyDown(
      createHotkeyCaptureMachineState(),
      event("Escape", "Escape"),
    );
    expect(result.effect.type).toBe("cancelled");
  });

  test("cancels and clears a partial chord on focus loss", () => {
    const cancelled = cancelHotkeyCapture();
    expect(cancelled.effect.type).toBe("cancelled");
    expect(cancelled.state).toEqual(createHotkeyCaptureMachineState());
  });

  test("does not complete an incomplete modifier-only chord", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("MetaLeft", "Meta", { metaKey: true }));
    const result = hotkeyCaptureKeyUp(state, event("MetaLeft", "Meta"));
    expect(result.effect).toEqual({ type: "preview", hotkey: null });
  });

  test("rejects a main key without modifiers", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("F8", "F8"));
    expect(hotkeyCaptureKeyUp(state, event("F8", "F8")).effect).toEqual({
      type: "rejected",
      hotkey: "F8",
    });
  });

  test("captures Windows AltGr and a Russian layout by physical code", () => {
    let state = createHotkeyCaptureMachineState();
    state = down(state, event("KeyK", "л", { altKey: true, ctrlKey: true }));
    expect(hotkeyCaptureKeyUp(state, event("KeyK", "л")).effect).toEqual({
      type: "completed",
      hotkey: "Control+Alt+K",
    });
  });
});
