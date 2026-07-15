import { describe, expect, test } from "bun:test";

import {
  mergeAppSettingsPatch,
  normalizeSavedSettings,
  type AppSettings,
} from "./store";

describe("translation settings migration", () => {
  test("keeps dictation translation active without the legacy widget button", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        widgetEnabled: false,
        active: true,
        targetLanguage: "en",
      },
    });

    expect(normalized.translation?.active).toBe(true);
  });

  test("keeps a confirmed selection hotkey when another translation field is saved", () => {
    const current = {
      hotkey: "Shift+Command+Space",
      translation: {
        selectionHotkey: "Control+Shift+A",
        active: false,
      },
    } as AppSettings;

    const updated = mergeAppSettingsPatch(current, {
      translation: { active: true },
    });

    expect(updated.translation.active).toBe(true);
    expect(updated.translation.selectionHotkey).toBe("Control+Shift+A");
  });

  test("adds live defaults without changing existing dictation and selection values", () => {
    const normalized = normalizeSavedSettings({
      language: "ru",
      translation: {
        widgetEnabled: true,
        active: true,
        targetLanguage: "de",
        selectionTargetLanguage: "fr",
        selectionTargetMigrationVersion: 1,
        selectionEnabled: false,
        selectionHotkey: "Control+Alt+T",
        selectionLocalTranslatorProvider: "nllb-200-distilled-600m-ct2-int8",
        selectionEnableMigrationVersion: 1,
      },
    });

    expect(normalized.translation).toMatchObject({
      widgetEnabled: true,
      active: true,
      targetLanguage: "de",
      selectionTargetLanguage: "fr",
      selectionEnabled: false,
      selectionLocalTranslatorProvider: "nllb-200-distilled-600m-ct2-int8",
      liveWidgetEnabled: false,
      liveMicrophoneEnabled: false,
      liveTargetLanguage: "en",
      liveVoiceEnabled: false,
      liveVoice: "marin",
      liveVoiceVolume: 0.8,
      liveVoiceSpeed: 1.05,
      liveMuteOriginalEnabled: true,
    });
  });

  test("preserves saved live settings and translation adapters", () => {
    const normalized = normalizeSavedSettings({
      selectedTranslationAdapter: "gemini",
      translationAdapters: {
        gemini: {
          apiKey: "secret",
          model: "gemini-3.5-live-translate-preview",
          connectionStatus: "verified",
          streamingCapability: "supported",
          streamingCapabilityFingerprint: "rt-v1-12345678",
        },
      },
      translation: {
        liveWidgetEnabled: true,
        liveMicrophoneEnabled: true,
        liveTargetLanguage: "de",
        liveVoiceEnabled: true,
        liveVoice: "cedar",
        liveVoiceVolume: 0.65,
        liveVoiceSpeed: 1.15,
        liveMuteOriginalEnabled: false,
      },
    });
    expect(normalized.selectedTranslationAdapter).toBe("gemini");
    expect(normalized.translationAdapters?.gemini.streamingCapability).toBe("supported");
    expect(normalized.translation?.liveWidgetEnabled).toBe(true);
    expect(normalized.translation?.liveMicrophoneEnabled).toBe(true);
    expect(normalized.translation?.liveTargetLanguage).toBe("de");
    expect(normalized.translation?.liveVoiceEnabled).toBe(true);
    expect(normalized.translation?.liveVoice).toBe("cedar");
    expect(normalized.translation?.liveVoiceVolume).toBe(0.65);
    expect(normalized.translation?.liveVoiceSpeed).toBe(1.15);
    expect(normalized.translation?.liveMuteOriginalEnabled).toBe(false);
  });

  test("clamps invalid live voice playback values", () => {
    const normalized = normalizeSavedSettings({
      translation: {
        liveVoiceVolume: 4,
        liveVoiceSpeed: 0.1,
      },
    });

    expect(normalized.translation?.liveVoiceVolume).toBe(1);
    expect(normalized.translation?.liveVoiceSpeed).toBe(0.25);
  });
});
