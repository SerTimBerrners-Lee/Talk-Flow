import {
  hotkeyMainKeyFromKeyboardEvent,
  type FrontendHotkeyCaptureEvent,
} from "./frontendHotkeyCapture";

export interface HotkeyCaptureKeyboardEvent extends FrontendHotkeyCaptureEvent {
  repeat: boolean;
}

export interface HotkeyCaptureMachineState {
  pressedCodes: string[];
  activeModifiers: string[];
  capturedModifiers: string[];
  mainCode: string | null;
  mainKey: string | null;
  mainReleased: boolean;
}

export type HotkeyCaptureMachineEffect =
  | { type: "none" }
  | { type: "preview"; hotkey: string | null }
  | { type: "completed"; hotkey: string }
  | { type: "rejected"; hotkey: string }
  | { type: "cancelled" };

export interface HotkeyCaptureMachineTransition {
  state: HotkeyCaptureMachineState;
  effect: HotkeyCaptureMachineEffect;
}

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Command"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

export function createHotkeyCaptureMachineState(): HotkeyCaptureMachineState {
  return {
    pressedCodes: [],
    activeModifiers: [],
    capturedModifiers: [],
    mainCode: null,
    mainKey: null,
    mainReleased: false,
  };
}

export function cancelHotkeyCapture(): HotkeyCaptureMachineTransition {
  return {
    state: createHotkeyCaptureMachineState(),
    effect: { type: "cancelled" },
  };
}

function modifierFromCode(code: string): Modifier | null {
  if (code.startsWith("Control")) return "Control";
  if (code.startsWith("Alt")) return "Alt";
  if (code.startsWith("Shift")) return "Shift";
  if (code.startsWith("Meta") || code.startsWith("OS")) return "Command";
  return null;
}

function modifiersFromEvent(event: FrontendHotkeyCaptureEvent): Modifier[] {
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Command");
  return modifiers;
}

function orderedModifiers(modifiers: readonly string[]): Modifier[] {
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
}

function mergeModifiers(
  current: readonly string[],
  added: readonly string[],
): Modifier[] {
  return orderedModifiers([...current, ...added]);
}

function candidateFromState(state: HotkeyCaptureMachineState): string | null {
  const modifiers = orderedModifiers(state.capturedModifiers);
  if (!state.mainKey) {
    return state.activeModifiers.length > 0
      ? orderedModifiers(state.activeModifiers).join("+")
      : null;
  }
  return [...modifiers, state.mainKey].join("+");
}

function resetAfterIncompleteChord(): HotkeyCaptureMachineState {
  return createHotkeyCaptureMachineState();
}

export function hotkeyCaptureKeyDown(
  state: HotkeyCaptureMachineState,
  event: HotkeyCaptureKeyboardEvent,
): HotkeyCaptureMachineTransition {
  if (event.repeat || state.pressedCodes.includes(event.code)) {
    return { state, effect: { type: "none" } };
  }

  if (
    event.key === "Escape" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    state.activeModifiers.length === 0
  ) {
    return cancelHotkeyCapture();
  }

  const pressedCodes = [...state.pressedCodes, event.code];
  const modifier = modifierFromCode(event.code);
  if (modifier) {
    const activeModifiers = mergeModifiers(state.activeModifiers, [modifier]);
    const capturedModifiers = state.mainKey
      ? mergeModifiers(state.capturedModifiers, [modifier])
      : state.capturedModifiers;
    const next = {
      ...state,
      pressedCodes,
      activeModifiers,
      capturedModifiers,
    };
    return {
      state: next,
      effect: { type: "preview", hotkey: candidateFromState(next) },
    };
  }

  const mainKey = hotkeyMainKeyFromKeyboardEvent(event);
  if (!mainKey || state.mainCode) {
    return { state: { ...state, pressedCodes }, effect: { type: "none" } };
  }

  const capturedModifiers = mergeModifiers(
    state.activeModifiers,
    modifiersFromEvent(event),
  );
  const next = {
    ...state,
    pressedCodes,
    capturedModifiers,
    mainCode: event.code,
    mainKey,
    mainReleased: false,
  };
  return {
    state: next,
    effect: { type: "preview", hotkey: candidateFromState(next) },
  };
}

export function hotkeyCaptureKeyUp(
  state: HotkeyCaptureMachineState,
  event: HotkeyCaptureKeyboardEvent,
): HotkeyCaptureMachineTransition {
  const pressedCodes = state.pressedCodes.filter((code) => code !== event.code);
  const releasedModifier = modifierFromCode(event.code);
  const activeModifiers = releasedModifier
    ? orderedModifiers(
        state.activeModifiers.filter(
          (modifier) => modifier !== releasedModifier,
        ),
      )
    : state.activeModifiers;
  const mainReleased = state.mainCode === event.code || state.mainReleased;
  const next = { ...state, pressedCodes, activeModifiers, mainReleased };

  if (!state.mainKey) {
    if (activeModifiers.length === 0) {
      return {
        state: resetAfterIncompleteChord(),
        effect: { type: "preview", hotkey: null },
      };
    }
    return {
      state: next,
      effect: { type: "preview", hotkey: candidateFromState(next) },
    };
  }

  if (!mainReleased || activeModifiers.length > 0) {
    return {
      state: next,
      effect: { type: "preview", hotkey: candidateFromState(next) },
    };
  }

  const candidate = candidateFromState(next) ?? state.mainKey;
  return {
    state: createHotkeyCaptureMachineState(),
    effect:
      state.capturedModifiers.length > 0
        ? { type: "completed", hotkey: candidate }
        : { type: "rejected", hotkey: candidate },
  };
}
