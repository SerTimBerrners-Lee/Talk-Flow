import { describe, expect, test } from "bun:test";

import type {
  HotkeyChangeRequestPayload,
  HotkeyTarget,
} from "../../../lib/hotkeyEvents";
import {
  mergeAppSettingsPatch,
  type AppSettings,
} from "../../../lib/store";
import {
  applyHotkeyTransaction,
  type HotkeyTransactionDependencies,
  type HotkeyTransactionStage,
} from "./hotkeyTransaction";

function settings(): AppSettings {
  return {
    hotkey: "Alt+Space",
    translation: {
      selectionEnabled: true,
      selectionHotkey: "Control+Shift+Y",
    },
  } as AppSettings;
}

function request(
  target: HotkeyTarget,
  hotkey: string,
  requestId = `${target}-1`,
): HotkeyChangeRequestPayload {
  return { requestId, target, hotkey };
}

function setup(
  options: {
  registerError?: Error;
  saveError?: Error;
  unregisterErrorFor?: string;
  staleAtStage?: HotkeyTransactionStage;
  } = {},
) {
  let stored = settings();
  const active: Record<HotkeyTarget, string | null> = {
    dictation: stored.hotkey,
    selection: stored.translation.selectionHotkey,
  };
  const registered: string[] = [];
  const unregistered: string[] = [];
  const stages: HotkeyTransactionStage[] = [];
  let current = true;

  const dependencies: HotkeyTransactionDependencies = {
    loadSettings: async () => stored,
    saveSettings: async (patch) => {
      if (options.saveError) throw options.saveError;
      stored = mergeAppSettingsPatch(stored, patch);
      if (options.staleAtStage === "save") current = false;
    },
    registerHotkey: async (hotkey) => {
      if (options.registerError) throw options.registerError;
      registered.push(hotkey);
      if (options.staleAtStage === "register") current = false;
    },
    unregisterHotkey: async (hotkey) => {
      unregistered.push(hotkey);
      if (hotkey === options.unregisterErrorFor) {
        throw new Error("unregister failed");
      }
    },
    getActiveHotkey: (target) => active[target],
    setActiveHotkey: (target, hotkey) => {
      active[target] = hotkey;
    },
    isCurrentRequest: () => current,
    log: (stage) => {
      stages.push(stage);
    },
    messages: {
      conflict: "conflict",
      registerFailed: (hotkey) => `register failed: ${hotkey}`,
      saveFailed: "save failed",
      stale: "stale",
    },
  };

  return {
    active,
    dependencies,
    getStored: () => stored,
    registered,
    stages,
    unregistered,
  };
}

describe("applyHotkeyTransaction", () => {
  test("commits dictation hotkey after registration and persistence", async () => {
    const fixture = setup();
    const result = await applyHotkeyTransaction(
      request("dictation", "Alt+K"),
      fixture.dependencies,
    );

    expect(result.success).toBe(true);
    expect(fixture.getStored().hotkey).toBe("Alt+K");
    expect(fixture.active.dictation).toBe("Alt+K");
    expect(fixture.registered).toEqual(["Alt+K"]);
    expect(fixture.unregistered).toEqual(["Alt+Space"]);
    expect(fixture.stages).toEqual([
      "validate",
      "register",
      "save",
      "unregister-old",
      "complete",
    ]);
  });

  test("commits and enables selection hotkey through the same path", async () => {
    const fixture = setup();
    fixture.getStored().translation.selectionEnabled = false;
    fixture.active.selection = null;
    const result = await applyHotkeyTransaction(
      request("selection", "Alt+Enter"),
      fixture.dependencies,
    );

    expect(result.success).toBe(true);
    expect(fixture.getStored().translation.selectionEnabled).toBe(true);
    expect(fixture.getStored().translation.selectionHotkey).toBe("Alt+Enter");
    expect(fixture.active.selection).toBe("Alt+Enter");
  });

  test("registers a configured selection hotkey when runtime registration is missing", async () => {
    const fixture = setup();
    fixture.getStored().translation.selectionEnabled = false;
    fixture.active.selection = null;

    const result = await applyHotkeyTransaction(
      request("selection", "Control+Shift+Y"),
      fixture.dependencies,
    );

    expect(result.success).toBe(true);
    expect(fixture.registered).toEqual(["Control+Shift+Y"]);
    expect(fixture.active.selection).toBe("Control+Shift+Y");
    expect(fixture.getStored().translation.selectionEnabled).toBe(true);
  });

  test("rejects a conflict without changing registration or settings", async () => {
    const fixture = setup();
    const result = await applyHotkeyTransaction(
      request("selection", "Alt+Space"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("conflict");
    expect(fixture.registered).toEqual([]);
    expect(fixture.unregistered).toEqual([]);
  });

  test("keeps the old hotkey after registration failure", async () => {
    const fixture = setup({ registerError: new Error("occupied") });
    const result = await applyHotkeyTransaction(
      request("dictation", "Alt+K"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(fixture.active.dictation).toBe("Alt+Space");
    expect(fixture.getStored().hotkey).toBe("Alt+Space");
  });

  test("unregisters the candidate and keeps the old hotkey after save failure", async () => {
    const fixture = setup({ saveError: new Error("disk full") });
    const result = await applyHotkeyTransaction(
      request("selection", "Shift+F8"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(fixture.active.selection).toBe("Control+Shift+Y");
    expect(fixture.unregistered).toEqual(["Shift+F8"]);
  });

  test("rolls back a candidate when requestId becomes stale", async () => {
    const fixture = setup({ staleAtStage: "register" });
    const result = await applyHotkeyTransaction(
      request("dictation", "Command+K", "old-request"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("stale");
    expect(fixture.unregistered).toEqual(["Command+K"]);
    expect(fixture.getStored().hotkey).toBe("Alt+Space");
  });

  test("rolls back persisted settings when request becomes stale during save", async () => {
    const fixture = setup({ staleAtStage: "save" });
    const result = await applyHotkeyTransaction(
      request("selection", "Control+Shift+U", "old-request"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(fixture.getStored().translation.selectionHotkey).toBe(
      "Control+Shift+Y",
    );
    expect(fixture.unregistered).toEqual(["Control+Shift+U"]);
  });

  test("rolls back when the old hotkey cannot be removed", async () => {
    const fixture = setup({ unregisterErrorFor: "Alt+Space" });
    const result = await applyHotkeyTransaction(
      request("dictation", "Alt+K"),
      fixture.dependencies,
    );

    expect(result.success).toBe(false);
    expect(fixture.getStored().hotkey).toBe("Alt+Space");
    expect(fixture.active.dictation).toBe("Alt+Space");
    expect(fixture.unregistered).toEqual(["Alt+Space", "Alt+K"]);
  });

  test("a restart loads the last successfully confirmed hotkey", async () => {
    const fixture = setup();
    await applyHotkeyTransaction(
      request("dictation", "Alt+K", "dictation-1"),
      fixture.dependencies,
    );
    await applyHotkeyTransaction(
      request("dictation", "Alt+Enter", "dictation-2"),
      fixture.dependencies,
    );

    expect((await fixture.dependencies.loadSettings()).hotkey).toBe("Alt+Enter");
    expect(fixture.active.dictation).toBe("Alt+Enter");
  });
});
