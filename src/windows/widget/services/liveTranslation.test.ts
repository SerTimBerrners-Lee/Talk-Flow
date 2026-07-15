import { describe, expect, test } from "bun:test";
import type { AppSettings } from "../../../lib/store";
import { realtimeConfigurationFingerprint } from "../../../lib/realtimeModels";

import {
  applyLiveTranslationEvent,
  buildLiveTranslationHistoryEntry,
  createLiveTranslationOverlayState,
  liveTranslationVisibleSegments,
  resolveLiveTranslationConnection,
} from "./liveTranslation";

function connectionSettings(
  patch: Partial<AppSettings> = {},
): AppSettings {
  return {
    useOwnKey: true,
    deviceToken: "",
    whisperEndpoint: "https://api.openai.com",
    selectedTranslationAdapter: "openai",
    translationAdapters: {},
    ...patch,
  } as AppSettings;
}

describe("live translation mode routing", () => {
  test("routes Cloud through Talkis without requiring a saved API adapter", () => {
    const connection = resolveLiveTranslationConnection(
      connectionSettings({ useOwnKey: false, deviceToken: "device-jwt" }),
    );
    expect(connection).toEqual({
      provider: "talkis-cloud",
      apiKey: "device-jwt",
      model: "gpt-realtime",
      endpoint: "https://proxy.talkis.ru",
      adapterId: "talkis-cloud",
      supportsVoice: true,
    });
  });

  test("keeps verified API routing unchanged", () => {
    const apiKey = "sk-test";
    const model = "gpt-realtime";
    const endpoint = "";
    const fingerprint = realtimeConfigurationFingerprint({
      provider: "openai",
      apiKey,
      model,
      endpoint,
      defaultEndpoint: "https://api.openai.com",
    });
    const connection = resolveLiveTranslationConnection(
      connectionSettings({
        translationAdapters: {
          openai: {
            apiKey,
            model,
            endpoint,
            connectionStatus: "verified",
            streamingCapability: "supported",
            streamingCapabilityFingerprint: fingerprint,
          },
        },
      }),
    );
    expect(connection.provider).toBe("openai");
    expect(connection.apiKey).toBe(apiKey);
  });

  test("rejects only realtime translation in Local mode", () => {
    expect(() =>
      resolveLiveTranslationConnection(
        connectionSettings({ whisperEndpoint: "http://127.0.0.1:8000" }),
      ),
    ).toThrow("недоступен для локальных моделей");
  });
});

describe("live translation overlay", () => {
  test("assembles two channels and ignores stale sessions", () => {
    let state = createLiveTranslationOverlayState("current");
    const stale = applyLiveTranslationEvent(state, {
      sessionId: "old", channel: "mic", status: "partial", original: "old", translated: "", startedAtMs: 1,
    });
    expect(stale).toBe(state);
    state = applyLiveTranslationEvent(state, {
      sessionId: "current", channel: "mic", status: "partial", original: "hello", translated: "bonjour", startedAtMs: 1,
    });
    state = applyLiveTranslationEvent(state, {
      sessionId: "current", channel: "system", status: "partial", original: "yes", translated: "oui", startedAtMs: 2,
    });
    expect(liveTranslationVisibleSegments(state).map((segment) => segment.channel)).toEqual(["mic", "system"]);
  });

  test("keeps only eight final utterances", () => {
    let state = createLiveTranslationOverlayState("session");
    for (let index = 0; index < 10; index += 1) {
      state = applyLiveTranslationEvent(state, {
        sessionId: "session", channel: index % 2 ? "system" : "mic", status: "final",
        original: `source-${index}`, translated: `target-${index}`, startedAtMs: index,
      });
    }
    expect(state.finals).toHaveLength(8);
    expect(state.finals[0].original).toBe("source-2");
  });

  test("groups consecutive chunks from the same channel into one speaker turn", () => {
    let state = createLiveTranslationOverlayState("session");
    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "system", status: "final",
      original: "a long", translated: "длинная", startedAtMs: 1,
    });
    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "system", status: "final",
      original: "sentence continues", translated: "фраза продолжается", startedAtMs: 2,
    });

    expect(state.finals).toHaveLength(1);
    expect(state.finals[0].original).toBe("a long sentence continues");
    expect(state.finals[0].translated).toBe("длинная фраза продолжается");

    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "mic", status: "final",
      original: "reply", translated: "ответ", startedAtMs: 3,
    });
    expect(state.finals.map((segment) => segment.channel)).toEqual([
      "system",
      "mic",
    ]);
  });

  test("shows a partial continuation inside the current speaker turn", () => {
    let state = createLiveTranslationOverlayState("session");
    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "system", status: "final",
      original: "first", translated: "первая часть", startedAtMs: 1,
    });
    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "system", status: "partial",
      original: "second", translated: "продолжение", startedAtMs: 2,
    });

    const visible = liveTranslationVisibleSegments(state);
    expect(visible).toHaveLength(1);
    expect(visible[0].translated).toBe("первая часть продолжение");
    expect(visible[0].state).toBe("partial");
    expect(visible[0].stableTranslatedLength).toBe("первая часть".length);

    state = applyLiveTranslationEvent(state, {
      sessionId: "session", channel: "system", status: "final",
      original: "second", translated: "продолжение полностью", startedAtMs: 2,
    });
    expect(state.finals[0].translated).toBe(
      "первая часть продолжение полностью",
    );
    expect(state.finals[0].stableTranslatedLength).toBeUndefined();
  });

  test("persists current partials as final history segments", () => {
    let state = createLiveTranslationOverlayState("session");
    state = applyLiveTranslationEvent(state, {
      sessionId: "session",
      channel: "mic",
      status: "partial",
      original: "unfinished source",
      translated: "незавершённый перевод",
      startedAtMs: 10,
    });
    const entry = buildLiveTranslationHistoryEntry({
      state,
      adapterId: "openai",
      targetLanguage: "ru",
      startedAt: Date.now(),
    });
    expect(entry.liveTranslation?.segments).toHaveLength(1);
    expect(entry.liveTranslation?.segments[0].state).toBe("final");
    expect(entry.raw).toContain("unfinished source");
    expect(entry.cleaned).toContain("незавершённый перевод");
  });

  test("stores audio tracks only when the caller supplies saved WAV paths", () => {
    const state = createLiveTranslationOverlayState("session");
    const base = {
      state,
      adapterId: "gemini",
      targetLanguage: "en",
      startedAt: Date.now(),
    };
    expect(buildLiveTranslationHistoryEntry(base).callTracks).toBeUndefined();
    expect(
      buildLiveTranslationHistoryEntry({
        ...base,
        callTracks: [
          { kind: "mic", label: "Вы", path: "/tmp/mic.wav" },
          { kind: "system", label: "Системный звук", path: "/tmp/system.wav" },
        ],
      }).callTracks,
    ).toHaveLength(2);
  });
});
