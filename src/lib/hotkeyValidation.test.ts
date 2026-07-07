import { describe, test, expect } from "bun:test";
import {
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  validateHotkey,
  normalizeHotkey,
  formatHotkeyLabel,
  normalizeSavedSettings,
  isReservedMacSystemHotkey,
  isUnsafeMacGlobalHotkey,
  needsHotkeySettingsMigration,
} from "./store";

describe("validateHotkey", () => {
  test("accepts modifier + letter", () => {
    expect(validateHotkey("Ctrl+A").valid).toBe(true);
    expect(validateHotkey("Command+Shift+Space").valid).toBe(true);
    expect(validateHotkey("Alt+Z").valid).toBe(true);
  });

  test("accepts F-key without modifier", () => {
    expect(validateHotkey("F1").valid).toBe(true);
    expect(validateHotkey("F12").valid).toBe(true);
  });

  test("rejects letter without modifier", () => {
    const result = validateHotkey("A");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("F-клавиш");
  });

  test("rejects modifier-only", () => {
    const result = validateHotkey("Ctrl");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("основную клавишу");
  });

  test("rejects multiple main keys", () => {
    const result = validateHotkey("Ctrl+A+B");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("одна основная");
  });

  test("rejects duplicate modifiers", () => {
    const result = validateHotkey("Ctrl+Control+A");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("дважды");
  });

  test("recognizes macOS Undo/Redo hotkeys as reserved", () => {
    expect(isReservedMacSystemHotkey("Command+Z", true)).toBe(true);
    expect(isReservedMacSystemHotkey("Command+Shift+Z", true)).toBe(true);
    expect(isReservedMacSystemHotkey("Shift+Command+Z", true)).toBe(true);
    expect(isReservedMacSystemHotkey("Alt+T", true)).toBe(false);
    expect(isReservedMacSystemHotkey("Shift+Command+Z", false)).toBe(false);
  });

  test("recognizes macOS Command+Shift+letter hotkeys as unsafe", () => {
    expect(isUnsafeMacGlobalHotkey("Shift+Command+A", true)).toBe(true);
    expect(isUnsafeMacGlobalHotkey("Command+Shift+Space", true)).toBe(false);
    expect(isUnsafeMacGlobalHotkey("Alt+T", true)).toBe(false);
    expect(isUnsafeMacGlobalHotkey("Shift+Command+A", false)).toBe(false);
  });

  test("rejects macOS Undo/Redo hotkeys on macOS", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });

    try {
      const result = validateHotkey("Shift+Command+Z");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Undo/Redo");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  test("rejects macOS Command+Shift+letter hotkeys on macOS", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });

    try {
      const result = validateHotkey("Shift+Command+A");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Command + Shift + буква");
      expect(validateHotkey("Shift+Command+Space").valid).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  test("rejects unknown keys", () => {
    const result = validateHotkey("Ctrl+???");
    expect(result.valid).toBe(false);
  });

  test("rejects empty string parts", () => {
    const result = validateHotkey("");
    expect(result.valid).toBe(false);
  });
});

describe("normalizeHotkey", () => {
  test("normalizes modifier aliases", () => {
    const result = normalizeHotkey("cmd+option+a");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Alt+Command+A");
  });

  test("normalizes option to Alt", () => {
    const result = normalizeHotkey("option+space");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Alt+Space");
  });

  test("orders modifiers consistently", () => {
    const result = normalizeHotkey("Command+Alt+X");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Alt+Command+X");
  });

  test("normalizes meta to Command", () => {
    const result = normalizeHotkey("meta+K");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Command+K");
  });

  test("uppercases single letter keys", () => {
    const result = normalizeHotkey("Ctrl+b");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Control+B");
  });

  test("preserves F-key format", () => {
    const result = normalizeHotkey("f5");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("F5");
  });

  test("returns error for invalid input", () => {
    const result = normalizeHotkey("not-a-hotkey");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBeUndefined();
  });

  test("handles Space key alias", () => {
    const result = normalizeHotkey("cmd+shift+space");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("Shift+Command+Space");
  });
});

describe("formatHotkeyLabel", () => {
  test("formats for display", () => {
    const label = formatHotkeyLabel("Command+Shift+Space");
    // On non-mac (test env), Command stays as Cmd
    expect(label).toContain("Space");
    expect(label).toContain(" + ");
  });

  test("handles single key", () => {
    const label = formatHotkeyLabel("F5");
    expect(label).toBe("F5");
  });
});

describe("translation selection hotkey settings", () => {
  test("adds selected-text translation defaults for saved settings", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        widgetEnabled: true,
        active: true,
        targetLanguage: "en",
      },
    });

    expect(normalized.translation?.selectionEnabled).toBe(true);
    expect(normalized.translation?.selectionTargetLanguage).toBe("en");
    expect(normalized.translation?.selectionHotkey).toBe(
      normalizeHotkey(DEFAULT_SELECTION_TRANSLATION_HOTKEY).normalized,
    );
    expect(normalized.translation?.selectionTargetMigrationVersion).toBe(1);
    expect(normalized.translation?.selectionEnableMigrationVersion).toBe(1);
  });

  test("auto-enables legacy disabled selected-text translation once", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: false,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      },
    });

    expect(normalized.translation?.selectionEnabled).toBe(true);
    expect(normalized.translation?.selectionEnableMigrationVersion).toBe(1);
  });

  test("keeps selected-text translation disabled after the migration marker", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: false,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
        selectionEnableMigrationVersion: 1,
      },
    });

    expect(normalized.translation?.selectionEnabled).toBe(false);
    expect(normalized.translation?.selectionEnableMigrationVersion).toBe(1);
  });

  test("defaults selected-text translation target to recognition language when it is set", () => {
    const normalized = normalizeSavedSettings({
      language: "ru",
      translation: {
        widgetEnabled: true,
        active: true,
        targetLanguage: "en",
      },
    });

    expect(normalized.translation?.selectionTargetLanguage).toBe("ru");
  });

  test("migrates the old selected-text translation target default to recognition language", () => {
    const normalized = normalizeSavedSettings({
      language: "ru",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionTargetLanguage: "en",
        selectionEnabled: true,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      },
    });

    expect(normalized.translation?.selectionTargetLanguage).toBe("ru");
    expect(normalized.translation?.selectionTargetMigrationVersion).toBe(1);
  });

  test("keeps selected-text translation target after the migration marker", () => {
    const normalized = normalizeSavedSettings({
      language: "ru",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionTargetLanguage: "en",
        selectionTargetMigrationVersion: 1,
        selectionEnabled: true,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      },
    });

    expect(normalized.translation?.selectionTargetLanguage).toBe("en");
    expect(normalized.translation?.selectionTargetMigrationVersion).toBe(1);
  });

  test("migrates the legacy selected-text translation hotkey", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: true,
        selectionHotkey: "cmd+alt+y",
      },
    });

    expect(normalized.translation?.selectionEnabled).toBe(true);
    expect(normalized.translation?.selectionHotkey).toBe(
      DEFAULT_SELECTION_TRANSLATION_HOTKEY,
    );
  });

  test("persists migration for legacy selected-text translation hotkeys", () => {
    for (const selectionHotkey of ["cmd+alt+y", "Control+Command+T"]) {
      const saved = {
        translation: {
          widgetEnabled: false,
          active: false,
          targetLanguage: "en",
          selectionEnabled: true,
          selectionHotkey,
        },
      };
      const normalized = normalizeSavedSettings(saved);

      expect(normalized.translation?.selectionHotkey).toBe(
        DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      );
      expect(
        needsHotkeySettingsMigration(saved, {
          translation: normalized.translation,
        }),
      ).toBe(true);
    }
  });

  test("repairs saved selected-text hotkey when it conflicts with voice hotkey", () => {
    const normalized = normalizeSavedSettings({
      hotkey: "Ctrl+Alt+Y",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: true,
        selectionHotkey: "Ctrl+Alt+Y",
      },
    });

    expect(normalized.translation?.selectionHotkey).not.toBe(normalized.hotkey);
    expect(normalized.translation?.selectionHotkey).toBeTruthy();
  });

  test("persists migration when saved selected-text hotkey conflicts with voice hotkey", () => {
    const saved = {
      hotkey: "Ctrl+Alt+Y",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: true,
        selectionHotkey: "Ctrl+Alt+Y",
      },
    };
    const normalized = normalizeSavedSettings(saved);

    expect(
      needsHotkeySettingsMigration(saved, {
        hotkey: normalized.hotkey,
        translation: normalized.translation,
      }),
    ).toBe(true);
  });

  test("persists the selected-text translation enable migration marker", () => {
    const saved = {
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionEnabled: false,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      },
    };
    const normalized = normalizeSavedSettings(saved);

    expect(normalized.translation?.selectionEnabled).toBe(true);
    expect(needsHotkeySettingsMigration(saved, normalized)).toBe(true);
  });

  test("persists the selected-text translation target migration marker", () => {
    const saved = {
      language: "ru",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "en",
        selectionTargetLanguage: "en",
        selectionTargetMigrationVersion: 0,
        selectionEnabled: true,
        selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
        selectionEnableMigrationVersion: 1,
      },
    };
    const normalized = normalizeSavedSettings(saved);

    expect(normalized.translation?.selectionTargetLanguage).toBe("ru");
    expect(needsHotkeySettingsMigration(saved, normalized)).toBe(true);
  });

  test("drops saved unsafe macOS voice hotkey so defaults can recover it", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });

    try {
      const normalized = normalizeSavedSettings({
        hotkey: "Shift+Command+A",
      });
      expect(normalized.hotkey).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  test("persists migration for saved unsafe macOS voice hotkey", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });

    try {
      expect(
        needsHotkeySettingsMigration(
          {
            hotkey: "Shift+Command+A",
            translation: {
              selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
            },
          },
          {
            hotkey: "Command+Shift+Space",
            translation: {
              widgetEnabled: false,
              active: false,
              targetLanguage: "en",
              selectionEnabled: false,
              selectionTargetLanguage: "en",
              selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
            },
          },
        ),
      ).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  test("defaults selected-text translation target to English when recognition is auto", () => {
    const normalized = normalizeSavedSettings({
      language: "auto",
      translation: {
        widgetEnabled: false,
        active: false,
        targetLanguage: "ru",
      },
    });

    expect(normalized.translation?.selectionTargetLanguage).toBe("en");
  });
});
