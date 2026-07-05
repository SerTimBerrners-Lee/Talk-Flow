import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import { LANGUAGES } from "../../../config/languages";
import { buildFrontendHotkeyCandidate } from "../../../lib/frontendHotkeyCapture";
import {
  HOTKEY_CAPTURE_STATE_EVENT,
  NATIVE_HOTKEY_CAPTURE_EVENT,
  SETTINGS_UPDATED_EVENT,
  type NativeHotkeyCapturePayload,
} from "../../../lib/hotkeyEvents";
import { IconCheck, IconChevronDown, IconSearch } from "../../../lib/icons";
import {
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  formatHotkeyLabel,
  getSettings,
  isMacPlatform,
  normalizeHotkey,
  saveSettings,
  type AppSettings,
  type TranslationSettings,
} from "../../../lib/store";
import { useI18n } from "../../../lib/i18n";
import { logError } from "../../../lib/logger";

const SETTING_ROW_COLUMNS = "minmax(0, 1fr) 280px";
const SETTING_ROW_GAP = 16;
const CONTROL_HEIGHT = 38;
const CONTROL_RADIUS = 8;
const CONTROL_FONT_SIZE = 12;
const SETTINGS_CARD_STYLE = {
  display: "grid",
  gap: 10,
  background: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
} as const;
const DROPDOWN_CARD_STYLE = {
  ...SETTINGS_CARD_STYLE,
  overflow: "visible",
  isolation: "isolate",
} as const;
const TRANSLATION_GROUP_SECTION_STYLE = {
  display: "grid",
  gap: 10,
  padding: "12px 0",
  borderTop: "1px solid var(--border-subtle)",
} as const;
const TRANSLATION_GROUP_FIRST_SECTION_STYLE = {
  ...TRANSLATION_GROUP_SECTION_STYLE,
  paddingTop: 0,
  borderTop: "none",
} as const;
const TRANSLATION_GROUP_LAST_SECTION_STYLE = {
  ...TRANSLATION_GROUP_SECTION_STYLE,
  paddingBottom: 0,
} as const;

function stopSelectionHotkeyCaptureProcess(): void {
  void emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
  if (isMacPlatform()) {
    void invoke("stop_native_hotkey_capture").catch(() => null);
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopSelectionHotkeyCaptureProcess();
  });
}

function fallbackTargetLanguage(sourceLanguage: string): string {
  return sourceLanguage === "en" ? "ru" : "en";
}

function normalizeTargetLanguage(
  sourceLanguage: string,
  targetLanguage: string,
): string {
  if (
    targetLanguage &&
    targetLanguage !== "auto" &&
    (sourceLanguage === "auto" || targetLanguage !== sourceLanguage)
  ) {
    return targetLanguage;
  }

  return fallbackTargetLanguage(sourceLanguage);
}

function fallbackSelectionTargetLanguage(sourceLanguage: string): string {
  return sourceLanguage && sourceLanguage !== "auto" ? sourceLanguage : "en";
}

function normalizeSelectionTargetLanguage(
  sourceLanguage: string,
  targetLanguage: string,
): string {
  if (targetLanguage && targetLanguage !== "auto") {
    return targetLanguage;
  }

  return fallbackSelectionTargetLanguage(sourceLanguage);
}

export function TranslationTab(): ReactElement {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetOpen, setTargetOpen] = useState(false);
  const [selectionTargetSearch, setSelectionTargetSearch] = useState("");
  const [selectionTargetOpen, setSelectionTargetOpen] = useState(false);
  const [selectionHotkeyCaptureActive, setSelectionHotkeyCaptureActive] =
    useState(false);
  const [selectionHotkeyDraft, setSelectionHotkeyDraft] = useState<
    string | null
  >(null);
  const [selectionHotkeyFeedback, setSelectionHotkeyFeedback] = useState("");
  const [selectionHotkeyTone, setSelectionHotkeyTone] = useState<
    "idle" | "success" | "error"
  >("idle");
  const targetRef = useRef<HTMLDivElement>(null);
  const selectionTargetRef = useRef<HTMLDivElement>(null);
  const selectionHotkeyRef = useRef<HTMLDivElement>(null);
  const usesNativeHotkeyCapture = isMacPlatform();

  useEffect(() => {
    let mounted = true;
    stopSelectionHotkeyCaptureProcess();

    const loadSettings = async (): Promise<void> => {
      try {
        const next = await getSettings({ reload: true });
        if (mounted) setSettings(next);
      } catch (error) {
        void logError(
          "TRANSLATION",
          `Failed to load translation settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadSettings();
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void loadSettings();
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenNativeHotkeyCapture = listen<NativeHotkeyCapturePayload>(
      NATIVE_HOTKEY_CAPTURE_EVENT,
      async ({ payload }) => {
        if (!selectionHotkeyCaptureActive) {
          return;
        }

        if (payload.status === "stopped") {
          setSelectionHotkeyCaptureActive(false);
          setSelectionHotkeyDraft(null);
          return;
        }

        if (payload.status === "listening") {
          setSelectionHotkeyDraft(null);
          setSelectionHotkeyTone("idle");
          setSelectionHotkeyFeedback(
            payload.message || t("settingsGeneralExtra.hotkey.pressNew"),
          );
          return;
        }

        if (payload.status === "preview") {
          setSelectionHotkeyDraft(payload.hotkey || null);
          setSelectionHotkeyTone("idle");
          setSelectionHotkeyFeedback(
            payload.message || t("settingsGeneralExtra.hotkey.releaseToApply"),
          );
          return;
        }

        if (payload.status === "cancelled") {
          await stopSelectionHotkeyCapture(
            t("settingsGeneralExtra.hotkey.cancelledKept"),
          );
          return;
        }

        if (payload.status !== "completed") {
          return;
        }

        await stopNativeSelectionHotkeyCapture();
        await applySelectionHotkey(payload.hotkey?.trim() || null);
      },
    );

    return () => {
      void unlistenNativeHotkeyCapture.then((unlisten) => unlisten());
    };
  }, [selectionHotkeyCaptureActive]);

  useEffect(() => {
    if (!selectionHotkeyCaptureActive || usesNativeHotkeyCapture) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (
        event.key === "Escape" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        void stopSelectionHotkeyCapture(
          t("settingsGeneralExtra.hotkey.cancelledKept"),
        );
        return;
      }

      const candidate = buildFrontendHotkeyCandidate(event);
      if (!candidate) {
        setSelectionHotkeyDraft(null);
        setSelectionHotkeyTone("idle");
        setSelectionHotkeyFeedback(
          t("settingsGeneralExtra.hotkey.needMainKey"),
        );
        return;
      }

      const normalized = normalizeHotkey(candidate);
      setSelectionHotkeyDraft(candidate);

      if (!normalized.valid) {
        setSelectionHotkeyTone("error");
        setSelectionHotkeyFeedback(
          normalized.error || t("translation.selection.hotkeyInvalid"),
        );
        return;
      }

      void applySelectionHotkey(normalized.normalized || candidate);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.setTimeout(() => selectionHotkeyRef.current?.focus(), 0);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [selectionHotkeyCaptureActive, usesNativeHotkeyCapture]);

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (
        selectionHotkeyCaptureActive &&
        selectionHotkeyRef.current &&
        !selectionHotkeyRef.current.contains(event.target as Node)
      ) {
        void stopSelectionHotkeyCapture(
          t("settingsGeneralExtra.hotkey.cancelledKept"),
        );
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectionHotkeyCaptureActive]);

  useEffect(() => {
    return () => {
      setSelectionHotkeyCaptureActive(false);
      setSelectionHotkeyDraft(null);
      stopSelectionHotkeyCaptureProcess();
    };
  }, []);

  useEffect(() => {
    if (!selectionHotkeyCaptureActive) {
      return;
    }

    const cancelCapture = (): void => {
      void stopSelectionHotkeyCapture(
        t("settingsGeneralExtra.hotkey.cancelledKept"),
      );
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        cancelCapture();
      }
    };

    window.addEventListener("blur", cancelCapture);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", cancelCapture);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectionHotkeyCaptureActive]);

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (
        targetRef.current &&
        !targetRef.current.contains(event.target as Node)
      ) {
        setTargetOpen(false);
      }
      if (
        selectionTargetRef.current &&
        !selectionTargetRef.current.contains(event.target as Node)
      ) {
        setSelectionTargetOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sourceLanguage = settings?.language || "ru";
  const targetOptions = useMemo(
    () =>
      LANGUAGES.filter(
        (language) =>
          language.code !== "auto" &&
          (sourceLanguage === "auto" || language.code !== sourceLanguage),
      ),
    [sourceLanguage],
  );
  const filteredTargetOptions = useMemo(() => {
    const search = targetSearch.toLowerCase();
    return targetOptions.filter(
      (language) =>
        language.name.toLowerCase().includes(search) ||
        language.native.toLowerCase().includes(search) ||
        language.code.toLowerCase().includes(search),
    );
  }, [targetOptions, targetSearch]);
  const selectionTargetOptions = useMemo(
    () => LANGUAGES.filter((language) => language.code !== "auto"),
    [],
  );
  const filteredSelectionTargetOptions = useMemo(() => {
    const search = selectionTargetSearch.toLowerCase();
    return selectionTargetOptions.filter(
      (language) =>
        language.name.toLowerCase().includes(search) ||
        language.native.toLowerCase().includes(search) ||
        language.code.toLowerCase().includes(search),
    );
  }, [selectionTargetOptions, selectionTargetSearch]);
  const targetLanguage = settings
    ? normalizeTargetLanguage(
        sourceLanguage,
        settings.translation.targetLanguage,
      )
    : fallbackTargetLanguage(sourceLanguage);
  const currentTargetLanguage = targetOptions.find(
    (language) => language.code === targetLanguage,
  );
  const selectionTargetLanguage = settings
    ? normalizeSelectionTargetLanguage(
        sourceLanguage,
        settings.translation.selectionTargetLanguage,
      )
    : fallbackSelectionTargetLanguage(sourceLanguage);
  const currentSelectionTargetLanguage = selectionTargetOptions.find(
    (language) => language.code === selectionTargetLanguage,
  );

  const updateTranslation = async (
    patch: Partial<TranslationSettings>,
  ): Promise<void> => {
    if (!settings) return;

    const nextTranslation: TranslationSettings = {
      ...settings.translation,
      ...patch,
    };
    if (!nextTranslation.widgetEnabled) {
      nextTranslation.active = false;
    }
    nextTranslation.targetLanguage = normalizeTargetLanguage(
      settings.language,
      nextTranslation.targetLanguage,
    );
    nextTranslation.selectionTargetLanguage = normalizeSelectionTargetLanguage(
      settings.language,
      nextTranslation.selectionTargetLanguage,
    );

    const nextSettings: AppSettings = {
      ...settings,
      translation: nextTranslation,
    };
    setSettings(nextSettings);

    try {
      await saveSettings({ translation: nextTranslation });
      await emit(SETTINGS_UPDATED_EVENT);
    } catch (error) {
      void logError(
        "TRANSLATION",
        `Failed to save translation settings: ${error instanceof Error ? error.message : String(error)}`,
      );
      const restored = await getSettings({ reload: true });
      setSettings(restored);
    }
  };

  const applySelectionHotkey = async (
    candidate: string | null,
  ): Promise<void> => {
    await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
    setSelectionHotkeyCaptureActive(false);

    if (!candidate) {
      setSelectionHotkeyDraft(null);
      setSelectionHotkeyTone("error");
      setSelectionHotkeyFeedback(
        t("settingsGeneralExtra.hotkey.recognizeFailed"),
      );
      return;
    }

    const normalized = normalizeHotkey(candidate);
    if (!normalized.valid || !normalized.normalized) {
      setSelectionHotkeyTone("error");
      setSelectionHotkeyFeedback(
        normalized.error || t("translation.selection.hotkeyInvalid"),
      );
      return;
    }

    if (
      settings?.hotkey &&
      normalizeHotkey(settings.hotkey).normalized === normalized.normalized
    ) {
      setSelectionHotkeyTone("error");
      setSelectionHotkeyFeedback(t("widget.hotkey.conflict"));
      return;
    }

    setSelectionHotkeyDraft(null);
    setSelectionHotkeyTone("success");
    setSelectionHotkeyFeedback(t("translation.selection.hotkeySaved"));
    await updateTranslation({ selectionHotkey: normalized.normalized });
  };

  const stopNativeSelectionHotkeyCapture = async (): Promise<void> => {
    if (usesNativeHotkeyCapture) {
      await invoke("stop_native_hotkey_capture").catch(() => null);
    }
    await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
  };

  const stopSelectionHotkeyCapture = async (
    message?: string,
  ): Promise<void> => {
    setSelectionHotkeyCaptureActive(false);
    setSelectionHotkeyDraft(null);
    await stopNativeSelectionHotkeyCapture();

    if (message) {
      setSelectionHotkeyTone("idle");
      setSelectionHotkeyFeedback(message);
    }
  };

  const startSelectionHotkeyCapture = async (): Promise<void> => {
    if (selectionHotkeyCaptureActive) {
      return;
    }

    setSelectionHotkeyCaptureActive(true);
    setSelectionHotkeyDraft(null);
    setSelectionHotkeyTone("idle");
    setSelectionHotkeyFeedback(
      usesNativeHotkeyCapture
        ? t("settingsGeneralExtra.hotkey.startingCapture")
        : t("settingsGeneralExtra.hotkey.pressNewCombo"),
    );

    try {
      await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: true });
      if (usesNativeHotkeyCapture) {
        await invoke("start_native_hotkey_capture");
      } else {
        window.setTimeout(() => selectionHotkeyRef.current?.focus(), 0);
      }
    } catch (error) {
      setSelectionHotkeyCaptureActive(false);
      setSelectionHotkeyDraft(null);
      setSelectionHotkeyTone("error");
      setSelectionHotkeyFeedback(
        t("settingsGeneralExtra.hotkey.captureStartFailed"),
      );
      await stopNativeSelectionHotkeyCapture();
      void logError(
        "TRANSLATION",
        `Failed to start selection hotkey capture: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleSelectionHotkeyCaptureSurfaceKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    if (selectionHotkeyCaptureActive) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    void startSelectionHotkeyCapture();
  };

  const handleSelectionHotkeyCaptureSurfaceMouseDown = (
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    void startSelectionHotkeyCapture();
  };

  if (!settings) {
    return (
      <div
        className="card"
        style={{ ...SETTINGS_CARD_STYLE, padding: "18px 20px" }}
      >
        <div style={{ color: "var(--text-mid)", fontSize: 13 }}>
          {t("translation.loading")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        ...DROPDOWN_CARD_STYLE,
        gap: 0,
        position: "relative",
        zIndex: targetOpen || selectionTargetOpen ? 1000 : 1,
      }}
    >
      <div
        style={{
          ...TRANSLATION_GROUP_FIRST_SECTION_STYLE,
          position: "relative",
          zIndex: targetOpen ? 2 : 1,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-hi)",
            margin: 0,
          }}
        >
          {t("translation.dictation.title")}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: SETTING_ROW_COLUMNS,
            alignItems: "center",
            gap: SETTING_ROW_GAP,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-mid)",
                margin: 0,
              }}
            >
              {t("translation.target.title")}
            </div>
          </div>
          <div
            ref={targetRef}
            style={{ position: "relative", width: "100%", justifySelf: "end" }}
          >
            <button
              type="button"
              onClick={() => setTargetOpen((open) => !open)}
              className="btn"
              style={{
                width: "100%",
                justifyContent: "space-between",
                gap: 8,
                minHeight: CONTROL_HEIGHT,
                padding: "0 10px",
                borderRadius: CONTROL_RADIUS,
                fontSize: CONTROL_FONT_SIZE,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {currentTargetLanguage
                  ? `${currentTargetLanguage.native} (${currentTargetLanguage.name})`
                  : targetLanguage}
              </span>
              <IconChevronDown
                size={13}
                stroke={2}
                style={{
                  flexShrink: 0,
                  transform: targetOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </button>
            {targetOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: 320,
                  maxHeight: 320,
                  background: "var(--dropdown-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 24,
                  boxShadow: "var(--shadow-panel)",
                  zIndex: 1001,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: 12,
                    borderBottom: "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <IconSearch
                    size={13}
                    style={{ color: "var(--text-low)", flexShrink: 0 }}
                  />
                  <input
                    autoFocus
                    value={targetSearch}
                    onChange={(event) => setTargetSearch(event.target.value)}
                    placeholder={t(
                      "settings.recognitionLang.searchPlaceholder",
                    )}
                    style={{
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 12,
                      color: "var(--text-hi)",
                      flex: 1,
                    }}
                  />
                </div>
                <div style={{ overflow: "auto", flex: 1 }}>
                  {filteredTargetOptions.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 16px",
                        fontSize: 12,
                        color: "var(--text-low)",
                      }}
                    >
                      {t("common.notFound")}
                    </div>
                  ) : (
                    filteredTargetOptions.map((language) => (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => {
                          void updateTranslation({
                            targetLanguage: language.code,
                          });
                          setTargetOpen(false);
                          setTargetSearch("");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          cursor: "pointer",
                          padding: "10px 16px",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background:
                            targetLanguage === language.code
                              ? "var(--dropdown-active)"
                              : "transparent",
                          color:
                            targetLanguage === language.code
                              ? "var(--text-hi)"
                              : "var(--text-mid)",
                          fontSize: 12,
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.background =
                            "var(--dropdown-hover)";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.background =
                            targetLanguage === language.code
                              ? "var(--dropdown-active)"
                              : "transparent";
                        }}
                      >
                        <span
                          style={{
                            minWidth: 28,
                            fontSize: 10,
                            color: "var(--text-low)",
                            fontFamily: "monospace",
                          }}
                        >
                          {language.code}
                        </span>
                        <span style={{ flex: 1 }}>{language.native}</span>
                        <span
                          style={{ fontSize: 10, color: "var(--text-low)" }}
                        >
                          {language.name}
                        </span>
                        {targetLanguage === language.code && (
                          <IconCheck
                            size={12}
                            stroke={2.5}
                            style={{ color: "var(--text-hi)", flexShrink: 0 }}
                          />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: SETTING_ROW_COLUMNS,
            alignItems: "center",
            gap: SETTING_ROW_GAP,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-mid)",
                margin: 0,
              }}
            >
              {t("translation.widget.title")}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.translation.widgetEnabled}
            onClick={() => {
              void updateTranslation({
                widgetEnabled: !settings.translation.widgetEnabled,
              });
            }}
            className="btn"
            style={{
              width: "100%",
              minHeight: CONTROL_HEIGHT,
              padding: "0 10px",
              borderRadius: CONTROL_RADIUS,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 34px",
              alignItems: "center",
              gap: 10,
              transform: "none",
              justifySelf: "end",
            }}
          >
            <span
              style={{
                color: "var(--text-hi)",
                fontSize: CONTROL_FONT_SIZE,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {settings.translation.widgetEnabled
                ? t("translation.widget.on")
                : t("translation.widget.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: settings.translation.widgetEnabled
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: settings.translation.widgetEnabled
                  ? "flex-end"
                  : "flex-start",
                transition: "background 0.16s ease",
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#fff",
                  display: "block",
                }}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        style={{
          ...TRANSLATION_GROUP_LAST_SECTION_STYLE,
          position: "relative",
          zIndex: selectionTargetOpen ? 2 : 1,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: SETTING_ROW_COLUMNS,
            alignItems: "center",
            gap: SETTING_ROW_GAP,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-hi)",
                margin: 0,
              }}
            >
              {t("translation.selection.title")}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.translation.selectionEnabled}
            onClick={() => {
              void updateTranslation({
                selectionEnabled: !settings.translation.selectionEnabled,
              });
            }}
            className="btn"
            style={{
              width: "100%",
              minHeight: CONTROL_HEIGHT,
              padding: "0 10px",
              borderRadius: CONTROL_RADIUS,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 34px",
              alignItems: "center",
              gap: 10,
              transform: "none",
              justifySelf: "end",
            }}
          >
            <span
              style={{
                color: "var(--text-hi)",
                fontSize: CONTROL_FONT_SIZE,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {settings.translation.selectionEnabled
                ? t("translation.selection.on")
                : t("translation.selection.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: settings.translation.selectionEnabled
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: settings.translation.selectionEnabled
                  ? "flex-end"
                  : "flex-start",
                transition: "background 0.16s ease",
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#fff",
                  display: "block",
                }}
              />
            </span>
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: SETTING_ROW_COLUMNS,
            alignItems: "center",
            gap: SETTING_ROW_GAP,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-mid)",
                margin: 0,
              }}
            >
              {t("translation.target.title")}
            </div>
          </div>
          <div
            ref={selectionTargetRef}
            style={{ position: "relative", width: "100%", justifySelf: "end" }}
          >
            <button
              type="button"
              onClick={() => setSelectionTargetOpen((open) => !open)}
              className="btn"
              style={{
                width: "100%",
                justifyContent: "space-between",
                gap: 8,
                minHeight: CONTROL_HEIGHT,
                padding: "0 10px",
                borderRadius: CONTROL_RADIUS,
                fontSize: CONTROL_FONT_SIZE,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {currentSelectionTargetLanguage
                  ? `${currentSelectionTargetLanguage.native} (${currentSelectionTargetLanguage.name})`
                  : selectionTargetLanguage}
              </span>
              <IconChevronDown
                size={13}
                stroke={2}
                style={{
                  flexShrink: 0,
                  transform: selectionTargetOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </button>
            {selectionTargetOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: 320,
                  maxHeight: 320,
                  background: "var(--dropdown-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 24,
                  boxShadow: "var(--shadow-panel)",
                  zIndex: 1001,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: 12,
                    borderBottom: "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <IconSearch
                    size={13}
                    style={{ color: "var(--text-low)", flexShrink: 0 }}
                  />
                  <input
                    autoFocus
                    value={selectionTargetSearch}
                    onChange={(event) =>
                      setSelectionTargetSearch(event.target.value)
                    }
                    placeholder={t(
                      "settings.recognitionLang.searchPlaceholder",
                    )}
                    style={{
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 12,
                      color: "var(--text-hi)",
                      flex: 1,
                    }}
                  />
                </div>
                <div style={{ overflow: "auto", flex: 1 }}>
                  {filteredSelectionTargetOptions.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 16px",
                        fontSize: 12,
                        color: "var(--text-low)",
                      }}
                    >
                      {t("common.notFound")}
                    </div>
                  ) : (
                    filteredSelectionTargetOptions.map((language) => (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => {
                          void updateTranslation({
                            selectionTargetLanguage: language.code,
                          });
                          setSelectionTargetOpen(false);
                          setSelectionTargetSearch("");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          cursor: "pointer",
                          padding: "10px 16px",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background:
                            selectionTargetLanguage === language.code
                              ? "var(--dropdown-active)"
                              : "transparent",
                          color:
                            selectionTargetLanguage === language.code
                              ? "var(--text-hi)"
                              : "var(--text-mid)",
                          fontSize: 12,
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.background =
                            "var(--dropdown-hover)";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.background =
                            selectionTargetLanguage === language.code
                              ? "var(--dropdown-active)"
                              : "transparent";
                        }}
                      >
                        <span
                          style={{
                            minWidth: 28,
                            fontSize: 10,
                            color: "var(--text-low)",
                            fontFamily: "monospace",
                          }}
                        >
                          {language.code}
                        </span>
                        <span style={{ flex: 1 }}>{language.native}</span>
                        <span
                          style={{ fontSize: 10, color: "var(--text-low)" }}
                        >
                          {language.name}
                        </span>
                        {selectionTargetLanguage === language.code && (
                          <IconCheck
                            size={12}
                            stroke={2.5}
                            style={{ color: "var(--text-hi)", flexShrink: 0 }}
                          />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: SETTING_ROW_COLUMNS,
            alignItems: "center",
            gap: SETTING_ROW_GAP,
          }}
        >
          <label
            htmlFor="selection-translation-hotkey"
            style={{ fontSize: 13, color: "var(--text-mid)", fontWeight: 600 }}
          >
            {t("translation.selection.hotkeyLabel")}
          </label>
          <div
            id="selection-translation-hotkey"
            ref={selectionHotkeyRef}
            role="button"
            tabIndex={0}
            className="btn"
            onMouseDown={handleSelectionHotkeyCaptureSurfaceMouseDown}
            onKeyDown={handleSelectionHotkeyCaptureSurfaceKeyDown}
            onFocus={() => {
              if (selectionHotkeyCaptureActive) return;
              setSelectionHotkeyTone("idle");
              setSelectionHotkeyFeedback(t("translation.selection.hotkeyIdle"));
            }}
            style={{
              width: "100%",
              minHeight: CONTROL_HEIGHT,
              padding: "0 10px",
              borderRadius: CONTROL_RADIUS,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 10,
              justifySelf: "end",
              transform: "none",
              fontSize: CONTROL_FONT_SIZE,
              border: selectionHotkeyCaptureActive
                ? "1px solid rgba(15,118,110,0.28)"
                : undefined,
              boxShadow: selectionHotkeyCaptureActive
                ? "0 0 0 4px rgba(15,118,110,0.08)"
                : undefined,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                color: "var(--text-hi)",
                fontWeight: 700,
              }}
            >
              {selectionHotkeyDraft
                ? formatHotkeyLabel(selectionHotkeyDraft)
                : selectionHotkeyCaptureActive
                  ? t("settings.hotkey.press")
                  : formatHotkeyLabel(
                      settings.translation.selectionHotkey ||
                        DEFAULT_SELECTION_TRANSLATION_HOTKEY,
                    )}
            </span>
            <span
              style={{
                color: "var(--text-low)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {selectionHotkeyCaptureActive
                ? t("settings.hotkey.recording")
                : t("translation.selection.hotkeyChange")}
            </span>
          </div>
        </div>
        {selectionHotkeyFeedback && (
          <div
            aria-live="polite"
            style={{
              fontSize: 13,
              color:
                selectionHotkeyTone === "error"
                  ? "var(--danger)"
                  : selectionHotkeyTone === "success"
                    ? "var(--success)"
                    : "var(--text-low)",
              lineHeight: 1.6,
            }}
          >
            {selectionHotkeyFeedback}
          </div>
        )}
      </div>
    </div>
  );
}
