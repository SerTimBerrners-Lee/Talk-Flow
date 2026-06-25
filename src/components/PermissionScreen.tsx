import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Mic, Keyboard, Check, AlertCircle, Volume2 } from "lucide-react";
import {
  PermissionStatus,
  checkAccessibilityPermission,
  checkMicrophonePermission,
  checkSystemAudioPermission,
  requestMicrophonePermission,
  requestSystemAudioPermission,
} from "../lib/permissions";
import { getSettings } from "../lib/store";
import { logError } from "../lib/logger";
import { useI18n } from "../lib/i18n";
import { scaleWidgetDimension } from "../lib/widgetScale";
import {
  CALL_STACK_WIDGET_HEIGHT,
  CALL_STACK_WIDGET_WIDTH,
} from "../windows/widget/widgetConstants";

interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  onAction: () => void;
  helpText?: string;
}

function PermissionRow({
  icon,
  title,
  description,
  status,
  onAction,
  helpText,
}: PermissionRowProps) {
  const { t } = useI18n();
  const isGranted = status === "granted";
  const isDenied = status === "denied";
  const isPrompting = status === "prompting";

  return (
    <div
      style={{
        padding: "16px 18px",
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        borderRadius: 10,
        background: "var(--control-muted)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isGranted ? "var(--accent)" : "var(--icon-soft-bg)",
          color: isGranted ? "var(--accent-contrast)" : "var(--text-mid)",
          flexShrink: 0,
        }}
      >
        {isGranted ? <Check size={16} strokeWidth={2.5} /> : icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)" }}
            >
              {title}
            </div>
            {!isGranted && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-low)",
                }}
              >
                {isPrompting
                  ? t("permission.badge.check")
                  : isDenied
                    ? t("permission.badge.actionNeeded")
                    : t("permission.badge.notGranted")}
              </span>
            )}
          </div>

          {!isGranted && (
            <button
              onClick={onAction}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                border: "none",
                background: isPrompting
                  ? "var(--control-muted)"
                  : "var(--accent)",
                color: isPrompting
                  ? "var(--text-hi)"
                  : "var(--accent-contrast)",
                fontFamily: "var(--font)",
                transition: "opacity 0.15s",
              }}
            >
              {isPrompting ? t("permission.action.check") : isDenied ? t("permission.action.retry") : t("permission.action.allow")}
            </button>
          )}
        </div>

        <div
          style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}
        >
          {description}
        </div>
        {helpText && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--text-low)",
              lineHeight: 1.55,
            }}
          >
            {helpText}
          </div>
        )}
      </div>
    </div>
  );
}

interface PermissionScreenProps {
  onComplete: () => void;
}

interface AppRuntimeInfo {
  platform: "macos" | "windows" | "linux" | "unknown";
  executablePath: string;
  bundlePath: string;
  launchedViaTranslocation: boolean;
  launchedFromMountedVolume: boolean;
  shouldMoveToApplications: boolean;
}

type DesktopPlatform = AppRuntimeInfo["platform"];

function detectDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();

  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  if (value.includes("linux") || value.includes("x11")) return "linux";

  return "unknown";
}

type TranslateFn = ReturnType<typeof useI18n>["t"];

function microphoneHelpText(platform: DesktopPlatform, t: TranslateFn): string {
  if (platform === "macos") {
    return t("permission.micHelp.macos");
  }

  if (platform === "windows") {
    return t("permission.micHelp.windows");
  }

  if (platform === "linux") {
    return t("permission.micHelp.linux");
  }

  return t("permission.micHelp.default");
}

export function PermissionScreen({ onComplete }: PermissionScreenProps) {
  const { t } = useI18n();
  const [micStatus, setMicStatus] = useState<PermissionStatus>("unknown");
  const [accStatus, setAccStatus] = useState<PermissionStatus>("unknown");
  const [systemAudioStatus, setSystemAudioStatus] =
    useState<PermissionStatus>("unknown");
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);

  const refreshAccessibilityStatus = useCallback(async () => {
    const nextStatus = await checkAccessibilityPermission();

    setAccStatus((current) => {
      if (nextStatus === "granted") {
        return "granted";
      }

      return current === "prompting" ? "prompting" : nextStatus;
    });

    return nextStatus;
  }, []);

  const refreshAllPermissions = useCallback(async () => {
    const [nextMicStatus, nextAccStatus, nextSystemAudioStatus] =
      await Promise.all([
        checkMicrophonePermission(),
        refreshAccessibilityStatus(),
        checkSystemAudioPermission(),
      ]);

    setMicStatus(nextMicStatus);
    setSystemAudioStatus((current) =>
      current === "granted" ? "granted" : nextSystemAudioStatus,
    );
    return { nextMicStatus, nextAccStatus, nextSystemAudioStatus };
  }, [refreshAccessibilityStatus]);

  useEffect(() => {
    void refreshAllPermissions();
  }, [refreshAllPermissions]);

  useEffect(() => {
    invoke<AppRuntimeInfo>("get_app_runtime_info")
      .then(setRuntimeInfo)
      .catch((error) => {
        void logError(
          "PERMISSIONS",
          `Failed to load runtime info: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, []);

  useEffect(() => {
    if (accStatus !== "prompting") {
      return;
    }

    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshAccessibilityStatus();
    };

    const intervalId = window.setInterval(() => {
      void refreshAccessibilityStatus();
    }, 1000);

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [accStatus, refreshAccessibilityStatus]);

  const handleMicRequest = async () => {
    setMicStatus("prompting");
    const granted = await requestMicrophonePermission();
    setMicStatus(granted ? "granted" : "denied");
  };

  const handleAccessibilityRequest = async () => {
    if (accStatus === "prompting") {
      await refreshAccessibilityStatus();
      return;
    }

    if (!requiresAccessibility) {
      setAccStatus("granted");
      return;
    }

    try {
      await invoke("reset_accessibility_permission");
    } catch (e) {
      void logError(
        "PERMISSIONS",
        `Failed to reset accessibility permission: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      await invoke("open_accessibility_settings");
      setAccStatus("prompting");
    } catch (e) {
      void logError(
        "PERMISSIONS",
        `Failed to open accessibility settings: ${e instanceof Error ? e.message : String(e)}`,
      );
      setAccStatus("denied");
    }
  };

  const handleSystemAudioRequest = async () => {
    if (!requiresSystemAudio) {
      setSystemAudioStatus("granted");
      return;
    }

    setSystemAudioStatus("prompting");
    const granted = await requestSystemAudioPermission();
    setSystemAudioStatus(granted ? "granted" : "denied");
  };

  const handleContinue = async () => {
    if (shouldShowInstallWarning) {
      await openPath("/Applications");
      return;
    }

    const { nextMicStatus, nextAccStatus } = await refreshAllPermissions();

    if (
      nextMicStatus !== "granted" ||
      (requiresAccessibility && nextAccStatus !== "granted") ||
      (requiresSystemAudio && systemAudioStatus !== "granted")
    ) {
      return;
    }

    const settings = await getSettings({ reload: true }).catch(() => null);
    const widgetScale = settings?.widgetScale ?? 1;
    await invoke("widget_resize", {
      width: scaleWidgetDimension(CALL_STACK_WIDGET_WIDTH, widgetScale),
      height: scaleWidgetDimension(CALL_STACK_WIDGET_HEIGHT, widgetScale),
      growthOffsetRatio: 0,
    });
    onComplete();
  };

  const platform = runtimeInfo?.platform ?? detectDesktopPlatform();
  const requiresAccessibility = platform === "macos";
  const requiresSystemAudio = platform === "macos";
  // In dev mode the binary lives in the build target dir (e.g. /Volumes/...),
  // which is not /Applications - but that's expected, so skip the warning.
  const shouldShowInstallWarning = import.meta.env.DEV
    ? false
    : Boolean(runtimeInfo?.shouldMoveToApplications);
  const pastePermissionTitle = requiresAccessibility
    ? t("permission.paste.titleAccessibility")
    : t("permission.paste.titlePaste");
  const pastePermissionDescription = requiresAccessibility
    ? t("permission.paste.descAccessibility")
    : platform === "linux"
      ? t("permission.paste.descLinux")
      : t("permission.paste.descDefault");
  const pastePermissionHelpText = shouldShowInstallWarning
    ? t("permission.paste.helpNotInApplications", { path: runtimeInfo?.bundlePath ?? "-" })
    : platform === "linux"
      ? t("permission.paste.helpLinux")
      : undefined;
  const canContinue =
    micStatus === "granted" &&
    (!requiresAccessibility || accStatus === "granted") &&
    (!requiresSystemAudio || systemAudioStatus === "granted");
  const canCompleteOnboarding = canContinue && !shouldShowInstallWarning;

  return (
    <div
      style={{
        position: "fixed",
        top: 48,
        right: 0,
        bottom: 0,
        left: 0,
        background: "var(--main-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 9999,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "min(100%, 680px)",
            padding: "28px 28px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            borderRadius: 10,
            background: "var(--surface-hi)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          {/* Header */}
          <div style={{ display: "grid", gap: 8 }}>
            <h1
              style={{
                fontSize: 28,
                lineHeight: 1,
                margin: 0,
                fontWeight: 800,
                fontFamily: "var(--font-brand)",
                letterSpacing: "-0.04em",
                color: "var(--text-hi)",
              }}
            >
              {t("permission.header.title")}
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: 520,
                fontSize: 13,
                color: "var(--text-mid)",
                lineHeight: 1.7,
              }}
            >
              {t("permission.header.subtitle")}
            </p>
          </div>

          {/* Permission rows */}
          <div style={{ display: "grid", gap: 10 }}>
            {shouldShowInstallWarning && (
              <div
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  borderRadius: 10,
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger-border)",
                }}
              >
                <AlertCircle
                  size={16}
                  style={{
                    color: "var(--danger)",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                />
                <div style={{ display: "grid", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--danger)",
                    }}
                  >
                    {t("permission.installWarning.title")}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-mid)",
                      lineHeight: 1.6,
                    }}
                  >
                    {t("permission.installWarning.desc")}
                  </div>
                </div>
              </div>
            )}

            <PermissionRow
              icon={<Mic size={16} strokeWidth={1.8} />}
              title={t("permission.mic.title")}
              description={t("permission.mic.desc")}
              status={micStatus}
              onAction={handleMicRequest}
            />

            {requiresSystemAudio && (
              <PermissionRow
                icon={<Volume2 size={16} strokeWidth={1.8} />}
                title={t("permission.systemAudio.title")}
                description={t("permission.systemAudio.desc")}
                status={systemAudioStatus}
                onAction={handleSystemAudioRequest}
                helpText={t("permission.systemAudio.help")}
              />
            )}

            <PermissionRow
              icon={<Keyboard size={16} strokeWidth={1.8} />}
              title={pastePermissionTitle}
              description={pastePermissionDescription}
              status={
                requiresAccessibility && shouldShowInstallWarning
                  ? "denied"
                  : requiresAccessibility
                    ? accStatus
                    : "granted"
              }
              onAction={() => {
                if (shouldShowInstallWarning) {
                  void openPath("/Applications");
                  return;
                }

                void handleAccessibilityRequest();
              }}
              helpText={pastePermissionHelpText}
            />
          </div>

          {/* Hint */}
          {(accStatus === "prompting" ||
            micStatus === "denied" ||
            systemAudioStatus === "denied") && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: "var(--control-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <AlertCircle
                size={14}
                style={{
                  color: "var(--text-low)",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              />
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-mid)",
                  lineHeight: 1.6,
                }}
              >
                {micStatus === "denied"
                  ? microphoneHelpText(platform, t)
                  : systemAudioStatus === "denied"
                    ? t("permission.hint.systemAudioDenied")
                    : shouldShowInstallWarning
                      ? t("permission.hint.reopenAfterMove")
                      : t("permission.hint.macosDelay")}
              </div>
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: canContinue ? "var(--success)" : "var(--text-low)",
                lineHeight: 1.55,
              }}
            >
              {shouldShowInstallWarning
                ? t("permission.footer.launchFromApplications")
                : canContinue
                  ? t("permission.footer.allGranted")
                  : requiresSystemAudio
                    ? t("permission.footer.grantToContinue")
                    : requiresAccessibility
                      ? t("permission.footer.grantBothToContinue")
                      : t("permission.footer.grantMicToContinue")}
            </div>
            <button
              onClick={handleContinue}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                border: "none",
                background: canCompleteOnboarding
                  ? "var(--accent)"
                  : "var(--control-muted)",
                color: canCompleteOnboarding
                  ? "var(--accent-contrast)"
                  : "var(--text-hi)",
                fontFamily: "var(--font)",
                transition: "opacity 0.15s",
                minWidth: 140,
              }}
            >
              {canCompleteOnboarding
                ? t("permission.button.continue")
                : shouldShowInstallWarning
                  ? "Applications"
                  : t("permission.button.check")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
