import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  IconMicrophone,
  IconKeyboard,
  IconCheck,
  IconAlertCircle,
  IconVolume,
} from "../lib/icons";
import {
  PermissionStatus,
  checkAccessibilityPermission,
  checkMicrophonePermission,
  checkSystemAudioPermission,
  requestMicrophonePermission,
  requestSystemAudioPermission,
} from "../lib/permissions";
import { getSettings } from "../lib/store";
import { logError, logInfo } from "../lib/logger";
import { useI18n } from "../lib/i18n";
import { scaleWidgetDimension } from "../lib/widgetScale";
import {
  widgetStackHeight,
  widgetStackWidth,
} from "../windows/widget/widgetConstants";
import { OnboardingProgress } from "./onboarding/OnboardingShell";

interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  onAction: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  helpText?: string;
}

function PermissionRow({
  icon,
  title,
  description,
  status,
  onAction,
  actionLabel,
  actionDisabled = false,
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
        {isGranted ? <IconCheck size={16} stroke={2.5} /> : icon}
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
              disabled={actionDisabled}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: actionDisabled ? "wait" : "pointer",
                border: "none",
                background: isPrompting
                  ? "var(--control-muted)"
                  : "var(--accent)",
                color: isPrompting
                  ? "var(--text-hi)"
                  : "var(--accent-contrast)",
                fontFamily: "var(--font)",
                transition: "opacity 0.15s",
                opacity: actionDisabled ? 0.65 : 1,
              }}
            >
              {actionLabel ??
                (isPrompting
                  ? t("permission.action.check")
                  : isDenied
                    ? t("permission.action.retry")
                    : t("permission.action.allow"))}
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
  onboardingStep?: number;
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

export function PermissionScreen({
  onComplete,
  onboardingStep,
}: PermissionScreenProps) {
  const { t } = useI18n();
  const [micStatus, setMicStatus] = useState<PermissionStatus>("unknown");
  const [accStatus, setAccStatus] = useState<PermissionStatus>("unknown");
  const [systemAudioStatus, setSystemAudioStatus] =
    useState<PermissionStatus>("unknown");
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);
  const [accessibilityRestartSuggested, setAccessibilityRestartSuggested] =
    useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const refreshAccessibilityStatus = useCallback(async () => {
    const nextStatus = await checkAccessibilityPermission();

    if (nextStatus === "granted") {
      setAccessibilityRestartSuggested(false);
      setRestartError(null);
    }

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
      const nextStatus = await refreshAccessibilityStatus();
      if (nextStatus !== "granted" && requiresAccessibility) {
        setAccessibilityRestartSuggested(true);
      }
      return;
    }

    if (!requiresAccessibility) {
      setAccStatus("granted");
      return;
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

  const handleRestartAndCheck = async (): Promise<void> => {
    if (restarting) return;

    setRestarting(true);
    setRestartError(null);
    void logInfo(
      "PERMISSIONS",
      "Restarting Talkis to refresh Accessibility permission",
    );

    try {
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logError("PERMISSIONS", `Failed to restart Talkis: ${message}`);
      setRestartError(t("permission.hint.restartFailed"));
      setRestarting(false);
    }
  };

  const handleSystemAudioRequest = async () => {
    if (!requiresSystemAudio) {
      setSystemAudioStatus("granted");
      return;
    }

    setSystemAudioStatus("prompting");
    try {
      await requestSystemAudioPermission();
      setSystemAudioStatus("granted");
    } catch {
      setSystemAudioStatus("denied");
    }
  };

  const handleContinue = async () => {
    if (shouldShowInstallWarning) {
      await openPath("/Applications");
      return;
    }

    if (accessibilityRestartSuggested) {
      await handleRestartAndCheck();
      return;
    }

    const { nextMicStatus, nextAccStatus, nextSystemAudioStatus } =
      await refreshAllPermissions();

    if (
      nextMicStatus !== "granted" ||
      (requiresAccessibility && nextAccStatus !== "granted") ||
      (requiresSystemAudio && nextSystemAudioStatus !== "granted")
    ) {
      if (
        requiresAccessibility &&
        accStatus === "prompting" &&
        nextAccStatus !== "granted"
      ) {
        setAccessibilityRestartSuggested(true);
      }
      return;
    }

    const settings = await getSettings({ reload: true }).catch(() => null);
    const widgetScale = settings?.widgetScale ?? 1;
    await invoke("widget_resize", {
      width: scaleWidgetDimension(widgetStackWidth(false), widgetScale),
      height: scaleWidgetDimension(widgetStackHeight(false), widgetScale),
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
    ? t("permission.paste.helpNotInApplications", {
        path: runtimeInfo?.bundlePath ?? "-",
      })
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
        top: platform === "macos" ? 48 : 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: "var(--main-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 9999,
        padding: 24,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: "100%",
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
            position: "relative",
            overflow: "hidden",
          }}
        >
          {onboardingStep !== undefined && (
            <OnboardingProgress currentStep={onboardingStep} />
          )}
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
                <IconAlertCircle
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
              icon={<IconMicrophone size={16} stroke={1.8} />}
              title={t("permission.mic.title")}
              description={t("permission.mic.desc")}
              status={micStatus}
              onAction={handleMicRequest}
            />

            {requiresSystemAudio && (
              <PermissionRow
                icon={<IconVolume size={16} stroke={1.8} />}
                title={t("permission.systemAudio.title")}
                description={t("permission.systemAudio.desc")}
                status={systemAudioStatus}
                onAction={handleSystemAudioRequest}
                actionLabel={t("permission.action.check")}
                helpText={t("permission.systemAudio.help")}
              />
            )}

            <PermissionRow
              icon={<IconKeyboard size={16} stroke={1.8} />}
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

                if (accessibilityRestartSuggested) {
                  void handleRestartAndCheck();
                  return;
                }

                void handleAccessibilityRequest();
              }}
              actionLabel={
                accessibilityRestartSuggested
                  ? restarting
                    ? t("permission.button.restarting")
                    : t("permission.button.restartAndCheck")
                  : undefined
              }
              actionDisabled={restarting}
              helpText={pastePermissionHelpText}
            />
          </div>

          {/* Hint */}
          {(accStatus === "prompting" ||
            accessibilityRestartSuggested ||
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
              <IconAlertCircle
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
                {restartError ??
                  (micStatus === "denied"
                    ? microphoneHelpText(platform, t)
                    : systemAudioStatus === "denied"
                      ? t("permission.hint.systemAudioDenied")
                      : accessibilityRestartSuggested
                        ? t("permission.hint.restartAccessibility")
                        : shouldShowInstallWarning
                          ? t("permission.hint.reopenAfterMove")
                          : t("permission.hint.macosDelay"))}
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
              disabled={restarting}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: restarting ? "wait" : "pointer",
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
                opacity: restarting ? 0.65 : 1,
              }}
            >
              {accessibilityRestartSuggested
                ? restarting
                  ? t("permission.button.restarting")
                  : t("permission.button.restartAndCheck")
                : canCompleteOnboarding
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
