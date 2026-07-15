import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { emit, listen } from "@tauri-apps/api/event";

import { LANGUAGES } from "../../../config/languages";
import { Dropdown } from "../../../components/Dropdown";
import { SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import {
  IconCheck,
  IconChevronDown,
  IconSearch,
} from "../../../lib/icons";
import {
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  formatHotkeyLabel,
  getSettings,
  isMacPlatform,
  saveSettings,
  type AppSettings,
  type TranslationSettings,
} from "../../../lib/store";
import { useI18n } from "../../../lib/i18n";
import { logError } from "../../../lib/logger";
import { useHotkeyCapture } from "../useHotkeyCapture";

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
const LIVE_VOICES = ["marin", "cedar", "coral", "verse"] as const;
const LIVE_VOICE_SPEEDS = [0.9, 1, 1.05, 1.1, 1.2] as const;

type TranslationView = "live" | "other";

interface LanguageOption {
  code: string;
  name: string;
  native: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface LanguageDropdownPortalProps {
  anchorRef: RefObject<HTMLDivElement | null>;
  options: LanguageOption[];
  selectedCode: string;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  placeholder: string;
  notFoundLabel: string;
  onSelect: (code: string) => void;
}

function LanguageDropdownPortal({
  anchorRef,
  options,
  selectedCode,
  search,
  setSearch,
  placeholder,
  notFoundLabel,
  onSelect,
}: LanguageDropdownPortalProps): ReactElement | null {
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const width = Math.min(320, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        window.innerWidth - width - viewportPadding,
      );
      const availableBelow =
        window.innerHeight - rect.bottom - viewportPadding - gap;
      const availableAbove = rect.top - viewportPadding - gap;
      const shouldFlip =
        availableBelow < 220 && availableAbove > availableBelow;

      let maxHeight = Math.min(
        320,
        Math.max(120, shouldFlip ? availableAbove : availableBelow),
      );
      let top = shouldFlip ? rect.top - gap - maxHeight : rect.bottom + gap;

      if (top < viewportPadding) {
        top = viewportPadding;
      }
      if (top + maxHeight > window.innerHeight - viewportPadding) {
        maxHeight = Math.max(120, window.innerHeight - viewportPadding - top);
      }

      setPosition({ top, left, width, maxHeight });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  if (!position || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        background: "var(--dropdown-bg)",
        border: "1px solid var(--border)",
        borderRadius: 24,
        boxShadow: "var(--shadow-panel)",
        zIndex: 10000,
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
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={placeholder}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 12,
            color: "var(--text-hi)",
            flex: 1,
            minWidth: 0,
          }}
        />
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {options.length === 0 ? (
          <div
            style={{
              padding: "14px 16px",
              fontSize: 12,
              color: "var(--text-low)",
            }}
          >
            {notFoundLabel}
          </div>
        ) : (
          options.map((language) => (
            <button
              key={language.code}
              type="button"
              onClick={() => onSelect(language.code)}
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
                  selectedCode === language.code
                    ? "var(--dropdown-active)"
                    : "transparent",
                color:
                  selectedCode === language.code
                    ? "var(--text-hi)"
                    : "var(--text-mid)",
                fontSize: 12,
                transition: "background 0.1s",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "var(--dropdown-hover)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background =
                  selectedCode === language.code
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
              <span style={{ fontSize: 10, color: "var(--text-low)" }}>
                {language.name}
              </span>
              {selectedCode === language.code && (
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
    </div>,
    document.body,
  );
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
  const [activeView, setActiveView] = useState<TranslationView>("live");
  const [liveVoiceVolumeDraft, setLiveVoiceVolumeDraft] = useState<
    number | null
  >(null);
  const liveVoiceVolumeDraftRef = useRef<number | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetOpen, setTargetOpen] = useState(false);
  const [selectionTargetSearch, setSelectionTargetSearch] = useState("");
  const [selectionTargetOpen, setSelectionTargetOpen] = useState(false);
  const [liveTargetSearch, setLiveTargetSearch] = useState("");
  const [liveTargetOpen, setLiveTargetOpen] = useState(false);
  const targetRef = useRef<HTMLDivElement>(null);
  const selectionTargetRef = useRef<HTMLDivElement>(null);
  const liveTargetRef = useRef<HTMLDivElement>(null);
  const selectionHotkeyCapture = useHotkeyCapture({
    target: "selection",
    logTag: "TRANSLATION",
    messages: {
      initial: "",
      applyFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
      saved: t("translation.selection.hotkeySaved"),
      changeAgain: t("settingsGeneralExtra.hotkey.changeAgain"),
      pressNew: t("settingsGeneralExtra.hotkey.pressNew"),
      releaseToApply: t("settingsGeneralExtra.hotkey.releaseToApply"),
      cancelledKept: t("settingsGeneralExtra.hotkey.cancelledKept"),
      needMainKey: t("settingsGeneralExtra.hotkey.needMainKey"),
      invalid: t("translation.selection.hotkeyInvalid"),
      recognizeFailed: t("settingsGeneralExtra.hotkey.recognizeFailed"),
      checkingFree: t("settingsGeneralExtra.hotkey.checkingFree"),
      sendFailed: t("settingsGeneralExtra.hotkey.sendFailed"),
      startingCapture: t("settingsGeneralExtra.hotkey.startingCapture"),
      pressNewCombo: t("settingsGeneralExtra.hotkey.pressNewCombo"),
      captureStartFailed: t("settingsGeneralExtra.hotkey.captureStartFailed"),
    },
    onApplied: async () => {
      const latest = await getSettings({ reload: true });
      setSettings(latest);
    },
  });
  const {
    surfaceRef: selectionHotkeyRef,
    active: selectionHotkeyCaptureActive,
    submitting: selectionHotkeySubmitting,
    draft: selectionHotkeyDraft,
    feedback: selectionHotkeyFeedback,
    tone: selectionHotkeyTone,
    handleSurfaceKeyDown: handleSelectionHotkeyCaptureSurfaceKeyDown,
    handleSurfaceMouseDown: handleSelectionHotkeyCaptureSurfaceMouseDown,
  } = selectionHotkeyCapture;

  useEffect(() => {
    let mounted = true;
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
      if (
        liveTargetRef.current &&
        !liveTargetRef.current.contains(event.target as Node)
      ) {
        setLiveTargetOpen(false);
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
  const filteredLiveTargetOptions = useMemo(() => {
    const search = liveTargetSearch.toLowerCase();
    return selectionTargetOptions.filter(
      (language) =>
        language.name.toLowerCase().includes(search) ||
        language.native.toLowerCase().includes(search) ||
        language.code.toLowerCase().includes(search),
    );
  }, [selectionTargetOptions, liveTargetSearch]);
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
  const liveTargetLanguage = settings?.translation.liveTargetLanguage || "en";
  const currentLiveTargetLanguage = selectionTargetOptions.find(
    (language) => language.code === liveTargetLanguage,
  );
  const localModelMode = Boolean(
    settings?.useOwnKey &&
      /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || ""),
  );
  const liveVoiceSupported = Boolean(
    isMacPlatform() &&
      settings &&
      (!settings.useOwnKey ||
        (!localModelMode && settings.selectedTranslationAdapter === "openai")),
  );
  const liveVoiceActive =
    liveVoiceSupported && Boolean(settings?.translation.liveVoiceEnabled);

  const updateTranslation = async (
    patch: Partial<TranslationSettings>,
  ): Promise<AppSettings | null> => {
    if (!settings) return null;

    const nextTranslation: TranslationSettings = {
      ...settings.translation,
      ...patch,
    };
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
      await saveSettings({ translation: patch });
      const latest = await getSettings({ reload: true });
      setSettings(latest);
      await emit(SETTINGS_UPDATED_EVENT);
      return latest;
    } catch (error) {
      void logError(
        "TRANSLATION",
        `Failed to save translation settings: ${error instanceof Error ? error.message : String(error)}`,
      );
      const restored = await getSettings({ reload: true });
      setSettings(restored);
      await emit(SETTINGS_UPDATED_EVENT).catch(() => null);
      return restored;
    }
  };

  const previewLiveVoiceVolume = (value: number): void => {
    liveVoiceVolumeDraftRef.current = value;
    setLiveVoiceVolumeDraft(value);
  };

  const commitLiveVoiceVolume = async (): Promise<void> => {
    const value = liveVoiceVolumeDraftRef.current;
    if (value === null) return;

    liveVoiceVolumeDraftRef.current = null;
    setLiveVoiceVolumeDraft(null);
    if (!settings || value === settings.translation.liveVoiceVolume) return;

    await updateTranslation({ liveVoiceVolume: value });
  };

  const toggleSelectionTranslation = async (): Promise<void> => {
    if (!settings || selectionHotkeySubmitting) return;

    if (settings.translation.selectionEnabled) {
      selectionHotkeyCapture.resetFeedback();
      await updateTranslation({ selectionEnabled: false });
      return;
    }

    await selectionHotkeyCapture.submit(
      settings.translation.selectionHotkey ||
        DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      );
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

  const displayedLiveVoiceVolume =
    liveVoiceVolumeDraft ?? settings.translation.liveVoiceVolume;

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: 3,
          borderRadius: 10,
          background: "var(--control-track)",
        }}
      >
        {([
          {
            id: "live",
            label: t("translation.view.live"),
          },
          {
            id: "other",
            label: t("translation.view.other"),
          },
        ] as const).map((view) => {
          const active = activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setActiveView(view.id);
                setTargetOpen(false);
                setSelectionTargetOpen(false);
                setLiveTargetOpen(false);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: CONTROL_HEIGHT,
                padding: "8px 12px",
                border: "none",
                borderRadius: 8,
                background: active ? "var(--dropdown-active)" : "transparent",
                color: active ? "var(--text-hi)" : "var(--text-mid)",
                fontFamily: "var(--font-main)",
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                lineHeight: 1.3,
                cursor: "pointer",
              }}
            >
              {view.label}
            </button>
          );
        })}
      </div>

      <div
        className="card"
        style={{
          ...DROPDOWN_CARD_STYLE,
          gap: 0,
          position: "relative",
          zIndex: targetOpen || selectionTargetOpen || liveTargetOpen ? 1000 : 1,
        }}
      >
      <div
        style={{
          ...TRANSLATION_GROUP_FIRST_SECTION_STYLE,
          display: activeView === "other" ? "grid" : "none",
          position: "relative",
          zIndex: targetOpen ? 2 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              <LanguageDropdownPortal
                anchorRef={targetRef}
                options={filteredTargetOptions}
                selectedCode={targetLanguage}
                search={targetSearch}
                setSearch={setTargetSearch}
                placeholder={t("settings.recognitionLang.searchPlaceholder")}
                notFoundLabel={t("common.notFound")}
                onSelect={(code) => {
                  void updateTranslation({ targetLanguage: code });
                  setTargetOpen(false);
                  setTargetSearch("");
                }}
              />
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
            aria-checked={settings.translation.active}
            onClick={() => {
              void updateTranslation({
                active: !settings.translation.active,
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
              {settings.translation.active
                ? t("translation.widget.on")
                : t("translation.widget.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: settings.translation.active
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: settings.translation.active
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
          ...TRANSLATION_GROUP_FIRST_SECTION_STYLE,
          display: activeView === "live" ? "grid" : "none",
          position: "relative",
          zIndex: liveTargetOpen ? 3 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)" }}>
            {t("translation.live.title")}
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
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
          >
            {t("translation.live.target")}
          </div>
          <div
            ref={liveTargetRef}
            style={{ position: "relative", width: "100%" }}
          >
            <button
              type="button"
              onClick={() => setLiveTargetOpen((open) => !open)}
              className="btn"
              style={{
                width: "100%",
                justifyContent: "space-between",
                minHeight: CONTROL_HEIGHT,
                padding: "0 10px",
                borderRadius: CONTROL_RADIUS,
                fontSize: CONTROL_FONT_SIZE,
              }}
            >
              <span>
                {currentLiveTargetLanguage
                  ? `${currentLiveTargetLanguage.native} (${currentLiveTargetLanguage.name})`
                  : liveTargetLanguage}
              </span>
              <IconChevronDown size={13} stroke={2} />
            </button>
            {liveTargetOpen && (
              <LanguageDropdownPortal
                anchorRef={liveTargetRef}
                options={filteredLiveTargetOptions}
                selectedCode={liveTargetLanguage}
                search={liveTargetSearch}
                setSearch={setLiveTargetSearch}
                placeholder={t("settings.recognitionLang.searchPlaceholder")}
                notFoundLabel={t("common.notFound")}
                onSelect={(code) => {
                  void updateTranslation({ liveTargetLanguage: code });
                  setLiveTargetOpen(false);
                  setLiveTargetSearch("");
                }}
              />
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
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
          >
            {t("translation.live.widget")}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.translation.liveWidgetEnabled}
            onClick={() => {
              void updateTranslation({
                liveWidgetEnabled: !settings.translation.liveWidgetEnabled,
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
            }}
          >
            <span style={{ fontSize: CONTROL_FONT_SIZE, fontWeight: 700 }}>
              {settings.translation.liveWidgetEnabled
                ? t("translation.widget.on")
                : t("translation.widget.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: settings.translation.liveWidgetEnabled
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: settings.translation.liveWidgetEnabled
                  ? "flex-end"
                  : "flex-start",
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#fff",
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
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
          >
            {t("translation.live.microphone")}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.translation.liveMicrophoneEnabled}
            onClick={() => {
              void updateTranslation({
                liveMicrophoneEnabled:
                  !settings.translation.liveMicrophoneEnabled,
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
            }}
          >
            <span style={{ fontSize: CONTROL_FONT_SIZE, fontWeight: 700 }}>
              {settings.translation.liveMicrophoneEnabled
                ? t("translation.widget.on")
                : t("translation.widget.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: settings.translation.liveMicrophoneEnabled
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: settings.translation.liveMicrophoneEnabled
                  ? "flex-end"
                  : "flex-start",
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
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
          >
            {t("translation.live.voice")}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={liveVoiceActive}
            aria-describedby="translation-live-voice-help"
            disabled={!liveVoiceSupported}
            onClick={() => {
              void updateTranslation({
                liveVoiceEnabled: !settings.translation.liveVoiceEnabled,
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
              opacity: liveVoiceSupported ? 1 : 0.55,
              cursor: liveVoiceSupported ? "pointer" : "not-allowed",
            }}
          >
            <span style={{ fontSize: CONTROL_FONT_SIZE, fontWeight: 700 }}>
              {liveVoiceActive
                ? t("translation.widget.on")
                : t("translation.widget.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: liveVoiceActive
                  ? "var(--text-hi)"
                  : "rgba(0,0,0,0.12)",
                padding: 2,
                display: "flex",
                justifyContent: liveVoiceActive
                  ? "flex-end"
                  : "flex-start",
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#fff",
                }}
              />
            </span>
          </button>
        </div>
        {liveVoiceActive && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: SETTING_ROW_COLUMNS,
                alignItems: "center",
                gap: SETTING_ROW_GAP,
              }}
            >
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
              >
                {t("translation.live.muteOriginal")}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.translation.liveMuteOriginalEnabled}
                aria-describedby="translation-live-mute-original-help"
                onClick={() => {
                  void updateTranslation({
                    liveMuteOriginalEnabled:
                      !settings.translation.liveMuteOriginalEnabled,
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
                }}
              >
                <span style={{ fontSize: CONTROL_FONT_SIZE, fontWeight: 700 }}>
                  {settings.translation.liveMuteOriginalEnabled
                    ? t("translation.widget.on")
                    : t("translation.widget.off")}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 34,
                    height: 20,
                    borderRadius: 999,
                    background: settings.translation.liveMuteOriginalEnabled
                      ? "var(--text-hi)"
                      : "rgba(0,0,0,0.12)",
                    padding: 2,
                    display: "flex",
                    justifyContent: settings.translation.liveMuteOriginalEnabled
                      ? "flex-end"
                      : "flex-start",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: "#fff",
                    }}
                  />
                </span>
              </button>
            </div>
            <div
              id="translation-live-mute-original-help"
              style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.5 }}
            >
              {t("translation.live.muteOriginalDesc")}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: SETTING_ROW_COLUMNS,
                alignItems: "center",
                gap: SETTING_ROW_GAP,
              }}
            >
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
              >
                {t("translation.live.voiceName")}
              </div>
              <div style={{ width: "100%" }}>
                <Dropdown
                  value={settings.translation.liveVoice}
                  options={LIVE_VOICES.map((voice) => ({
                    value: voice,
                    label: t(`translation.live.voice.${voice}`),
                  }))}
                  onChange={(voice) => {
                    void updateTranslation({ liveVoice: voice });
                  }}
                />
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
                htmlFor="translation-live-volume"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
              >
                {t("translation.live.volume")}
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 56px",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <input
                  id="translation-live-volume"
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={displayedLiveVoiceVolume}
                  onChange={(event) => {
                    previewLiveVoiceVolume(Number(event.currentTarget.value));
                  }}
                  onPointerUp={() => void commitLiveVoiceVolume()}
                  onPointerCancel={() => void commitLiveVoiceVolume()}
                  onKeyUp={() => void commitLiveVoiceVolume()}
                  onBlur={() => void commitLiveVoiceVolume()}
                  style={{
                    width: "100%",
                    accentColor: "var(--text-hi)",
                    cursor: "pointer",
                  }}
                />
                <div
                  style={{
                    height: CONTROL_HEIGHT,
                    borderRadius: CONTROL_RADIUS,
                    background: "var(--control-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-hi)",
                    fontSize: CONTROL_FONT_SIZE,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(displayedLiveVoiceVolume * 100)}%
                </div>
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
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)" }}
              >
                {t("translation.live.speed")}
              </div>
              <div style={{ width: "100%" }}>
                <Dropdown
                  value={String(settings.translation.liveVoiceSpeed)}
                  options={LIVE_VOICE_SPEEDS.map((speed) => ({
                    value: String(speed),
                    label: `${speed.toFixed(2).replace(/0$/, "")}×`,
                  }))}
                  onChange={(speed) => {
                    void updateTranslation({ liveVoiceSpeed: Number(speed) });
                  }}
                />
              </div>
            </div>
          </>
        )}
        <div
          id="translation-live-voice-help"
          style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.5 }}
        >
          {liveVoiceSupported
            ? t("translation.live.voiceDesc")
            : !isMacPlatform()
              ? t("translation.live.voiceMacOnly")
              : t("translation.live.voiceOpenAiOnly")}
        </div>
        <div
          style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.5 }}
        >
          {t("translation.live.desc")}
        </div>
      </div>

      <div
        style={{
          ...TRANSLATION_GROUP_LAST_SECTION_STYLE,
          display: activeView === "other" ? "grid" : "none",
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
              void toggleSelectionTranslation();
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
              opacity: selectionHotkeySubmitting ? 0.72 : 1,
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
              <LanguageDropdownPortal
                anchorRef={selectionTargetRef}
                options={filteredSelectionTargetOptions}
                selectedCode={selectionTargetLanguage}
                search={selectionTargetSearch}
                setSearch={setSelectionTargetSearch}
                placeholder={t("settings.recognitionLang.searchPlaceholder")}
                notFoundLabel={t("common.notFound")}
                onSelect={(code) => {
                  void updateTranslation({ selectionTargetLanguage: code });
                  setSelectionTargetOpen(false);
                  setSelectionTargetSearch("");
                }}
              />
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
              if (selectionHotkeyCaptureActive || selectionHotkeySubmitting)
                return;
              selectionHotkeyCapture.showIdleFeedback(
                t("translation.selection.hotkeyIdle"),
              );
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
              cursor: selectionHotkeySubmitting ? "default" : "pointer",
              opacity: selectionHotkeySubmitting ? 0.72 : 1,
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
                  : selectionHotkeySubmitting
                    ? t("settingsGeneralExtra.hotkey.checkingFree")
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
    </div>
  );
}
