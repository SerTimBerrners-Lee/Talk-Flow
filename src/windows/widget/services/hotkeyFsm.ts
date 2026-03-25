import type { WidgetState } from "../widgetConstants";

export type HotkeyShortcutState = "Pressed" | "Released";

export type HotkeyFsmCommand =
  | "start_recording"
  | "stop_recording"
  | "schedule_stop_after_release"
  | "clear_release_stop_timer";

export interface HotkeyFsmState {
  widgetState: WidgetState;
  hotkeyHeld: boolean;
  lockedRecording: boolean;
  suppressNextRelease: boolean;
  pendingStopAfterStart: boolean;
  releaseStopTimerActive: boolean;
}

export interface HotkeyFsmResult {
  nextState: HotkeyFsmState;
  commands: HotkeyFsmCommand[];
}

export function evaluateHotkeyFsm(
  state: HotkeyFsmState,
  shortcutState: HotkeyShortcutState,
): HotkeyFsmResult {
  const nextState: HotkeyFsmState = { ...state };
  const commands: HotkeyFsmCommand[] = [];

  if (shortcutState === "Pressed") {
    if (state.lockedRecording && state.widgetState === "recording") {
      nextState.hotkeyHeld = true;
      nextState.suppressNextRelease = true;
      commands.push("stop_recording");
      return { nextState, commands };
    }

    if (state.widgetState === "recording" && state.releaseStopTimerActive) {
      nextState.hotkeyHeld = true;
      nextState.lockedRecording = true;
      nextState.pendingStopAfterStart = false;
      nextState.releaseStopTimerActive = false;
      commands.push("clear_release_stop_timer");
      return { nextState, commands };
    }

    if (state.hotkeyHeld || state.widgetState !== "idle") {
      return { nextState, commands };
    }

    nextState.hotkeyHeld = true;
    nextState.lockedRecording = false;
    commands.push("start_recording");
    return { nextState, commands };
  }

  nextState.hotkeyHeld = false;

  if (state.suppressNextRelease) {
    nextState.suppressNextRelease = false;
    return { nextState, commands };
  }

  if (state.widgetState === "recording") {
    if (state.lockedRecording) {
      return { nextState, commands };
    }

    commands.push("schedule_stop_after_release");
    nextState.releaseStopTimerActive = true;
    return { nextState, commands };
  }

  nextState.pendingStopAfterStart = false;
  return { nextState, commands };
}
