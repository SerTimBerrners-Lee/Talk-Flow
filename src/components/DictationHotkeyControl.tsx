import type { ReactElement } from "react";

import { useI18n } from "../lib/i18n";
import {
  DEFAULT_HOTKEY,
  formatHotkeyLabel,
  getSettings,
  type AppSettings,
} from "../lib/store";
import { useHotkeyCapture } from "../windows/settings/useHotkeyCapture";
import { HotkeyKeycaps } from "./HotkeyKeycaps";
import { useLiveHotkeyPreview } from "./useLiveHotkeyPreview";

export function DictationHotkeyControl({
  settings,
  onSettingsChange,
  appearance = "field",
  livePreview = false,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  appearance?: "field" | "keycaps";
  livePreview?: boolean;
}): ReactElement {
  const { t } = useI18n();
  const capture = useHotkeyCapture({
    target: "dictation",
    logTag: "HOTKEY",
    messages: {
      initial: t("settingsGeneralExtra.hotkey.initial"),
      applyFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
      saved: t("settingsGeneralExtra.hotkey.saved"),
      changeAgain: t("settingsGeneralExtra.hotkey.changeAgain"),
      pressNew: t("settingsGeneralExtra.hotkey.pressNew"),
      releaseToApply: t("settingsGeneralExtra.hotkey.releaseToApply"),
      cancelledKept: t("settingsGeneralExtra.hotkey.cancelledKept"),
      needMainKey: t("settingsGeneralExtra.hotkey.needMainKey"),
      invalid: t("settingsGeneralExtra.hotkey.invalid"),
      recognizeFailed: t("settingsGeneralExtra.hotkey.recognizeFailed"),
      checkingFree: t("settingsGeneralExtra.hotkey.checkingFree"),
      sendFailed: t("settingsGeneralExtra.hotkey.sendFailed"),
      startingCapture: t("settingsGeneralExtra.hotkey.startingCapture"),
      pressNewCombo: t("settingsGeneralExtra.hotkey.pressNewCombo"),
      captureStartFailed: t("settingsGeneralExtra.hotkey.captureStartFailed"),
    },
    onApplied: async () => {
      onSettingsChange(await getSettings({ reload: true }));
    },
  });
  const displayValue = capture.draft
    ? formatHotkeyLabel(capture.draft)
    : capture.active
      ? t("settings.hotkey.press")
      : formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY);
  const feedbackColor =
    capture.tone === "error"
      ? "var(--danger)"
      : capture.tone === "success"
        ? "var(--success)"
        : "var(--text-mid)";
  const pressedKeys = useLiveHotkeyPreview({
    enabled: livePreview,
    hotkeyLabel: displayValue,
  });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        ref={capture.surfaceRef}
        role="button"
        tabIndex={0}
        aria-disabled={capture.submitting}
        aria-label={`${t("settings.hotkey.title")}: ${displayValue}`}
        onMouseDown={capture.handleSurfaceMouseDown}
        onKeyDown={capture.handleSurfaceKeyDown}
        className="btn"
        style={{
          width: appearance === "keycaps" ? "fit-content" : "100%",
          minHeight: 38,
          padding: appearance === "keycaps" ? "4px" : "0 10px",
          borderRadius: 8,
          display: appearance === "field" ? "grid" : undefined,
          gridTemplateColumns:
            appearance === "field" ? "minmax(0, 1fr) auto" : undefined,
          alignItems: appearance === "field" ? "center" : undefined,
          justifyContent: appearance === "keycaps" ? "center" : undefined,
          gap: appearance === "keycaps" ? 8 : 10,
          background: appearance === "keycaps" ? "transparent" : undefined,
          border:
            appearance === "keycaps"
              ? capture.active
                ? "1px solid rgba(15,118,110,0.28)"
                : "1px solid transparent"
              : capture.active
                ? "1px solid rgba(15,118,110,0.28)"
                : undefined,
          boxShadow: capture.active
            ? "0 0 0 4px rgba(15,118,110,0.08)"
            : undefined,
          opacity: capture.submitting ? 0.8 : 1,
          cursor: capture.submitting ? "wait" : "pointer",
          justifySelf: appearance === "keycaps" ? "center" : undefined,
        }}
      >
        {appearance === "keycaps" ? (
          <HotkeyKeycaps
            label={displayValue}
            pressedKeys={pressedKeys}
            size="large"
          />
        ) : (
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text-hi)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {displayValue}
          </span>
        )}
        {appearance === "field" && (
          <span
            style={{
              color: "var(--text-low)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {capture.submitting
              ? t("settings.hotkey.checking")
              : capture.active
                ? t("settings.hotkey.recording")
                : t("settings.hotkey.change")}
          </span>
        )}
      </div>
      {(capture.active || capture.submitting || capture.tone !== "idle") && (
        <div
          role={capture.tone === "error" ? "alert" : "status"}
          style={{
            color: feedbackColor,
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {capture.feedback}
        </div>
      )}
    </div>
  );
}
