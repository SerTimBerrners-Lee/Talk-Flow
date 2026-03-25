import { describe, expect, it } from "bun:test";

import { evaluateHotkeyFsm } from "./hotkeyFsm";

function baseState(overrides = {}) {
  return {
    widgetState: "idle",
    hotkeyHeld: false,
    lockedRecording: false,
    suppressNextRelease: false,
    pendingStopAfterStart: false,
    releaseStopTimerActive: false,
    ...overrides,
  };
}

describe("hotkey FSM smoke", () => {
  it("starts recording on first press from idle", () => {
    const decision = evaluateHotkeyFsm(baseState(), "Pressed");

    expect(decision.commands).toEqual(["start_recording"]);
    expect(decision.nextState.hotkeyHeld).toBe(true);
    expect(decision.nextState.lockedRecording).toBe(false);
  });

  it("schedules stop on release while recording and unlocked", () => {
    const decision = evaluateHotkeyFsm(
      baseState({ widgetState: "recording", hotkeyHeld: true }),
      "Released",
    );

    expect(decision.commands).toEqual(["schedule_stop_after_release"]);
    expect(decision.nextState.hotkeyHeld).toBe(false);
    expect(decision.nextState.releaseStopTimerActive).toBe(true);
  });

  it("locks recording on double press during grace window", () => {
    const decision = evaluateHotkeyFsm(
      baseState({
        widgetState: "recording",
        releaseStopTimerActive: true,
      }),
      "Pressed",
    );

    expect(decision.commands).toEqual(["clear_release_stop_timer"]);
    expect(decision.nextState.lockedRecording).toBe(true);
    expect(decision.nextState.pendingStopAfterStart).toBe(false);
  });

  it("stops recording on pressed when locked", () => {
    const decision = evaluateHotkeyFsm(
      baseState({
        widgetState: "recording",
        lockedRecording: true,
      }),
      "Pressed",
    );

    expect(decision.commands).toEqual(["stop_recording"]);
    expect(decision.nextState.suppressNextRelease).toBe(true);
    expect(decision.nextState.hotkeyHeld).toBe(true);
  });

  it("consumes suppressed release without side effects", () => {
    const decision = evaluateHotkeyFsm(
      baseState({
        widgetState: "recording",
        hotkeyHeld: true,
        suppressNextRelease: true,
      }),
      "Released",
    );

    expect(decision.commands).toEqual([]);
    expect(decision.nextState.suppressNextRelease).toBe(false);
    expect(decision.nextState.hotkeyHeld).toBe(false);
  });

  it("resets pending stop flag on release outside recording", () => {
    const decision = evaluateHotkeyFsm(
      baseState({
        widgetState: "idle",
        pendingStopAfterStart: true,
      }),
      "Released",
    );

    expect(decision.nextState.pendingStopAfterStart).toBe(false);
    expect(decision.commands).toEqual([]);
  });
});
