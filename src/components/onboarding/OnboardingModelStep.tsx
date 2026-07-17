import type { ReactElement, ReactNode } from "react";

import {
  IconBolt,
  IconCheck,
  IconCpu,
  IconDownload,
  IconLoader2,
  IconMicrophone,
} from "../../lib/icons";
import { useI18n } from "../../lib/i18n";
import {
  OnboardingShell,
  PRIMARY_BUTTON_STYLE,
  SECONDARY_BUTTON_STYLE,
} from "./OnboardingLayout";

export type OnboardingModelStatus =
  | "idle"
  | "installing"
  | "installed"
  | "error";

function ModelFeature({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 28,
        padding: "0 10px",
        borderRadius: 999,
        background: "var(--control-muted)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-mid)",
        fontSize: 11,
        fontWeight: 650,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

export function OnboardingModelStep({
  status,
  progress,
  message,
  onInstall,
  onSkip,
  onContinue,
}: {
  status: OnboardingModelStatus;
  progress: number;
  message: string | null;
  onInstall: () => void;
  onSkip: () => void;
  onContinue: () => void;
}): ReactElement {
  const { t } = useI18n();
  const installed = status === "installed";

  return (
    <OnboardingShell
      stage="model"
      eyebrow={t("onboarding.model.eyebrow")}
      title={t("onboarding.model.title")}
      subtitle={t("onboarding.model.subtitle")}
      footer={
        <>
          <button
            type="button"
            onClick={onSkip}
            style={SECONDARY_BUTTON_STYLE}
          >
            {status === "installing"
              ? t("onboarding.model.cancelAndSkip")
              : t("onboarding.skip")}
          </button>
          {installed ? (
            <button
              type="button"
              onClick={onContinue}
              style={PRIMARY_BUTTON_STYLE}
            >
              {t("onboarding.continue")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onInstall}
              disabled={status === "installing"}
              style={{
                ...PRIMARY_BUTTON_STYLE,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                cursor: status === "installing" ? "wait" : "pointer",
                opacity: status === "installing" ? 0.7 : 1,
              }}
            >
              {status === "installing" ? (
                <IconLoader2
                  size={16}
                  stroke={2}
                  aria-hidden="true"
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                <IconDownload size={16} stroke={2} aria-hidden="true" />
              )}
              {status === "error"
                ? t("onboarding.model.retry")
                : t("onboarding.model.install")}
            </button>
          )}
        </>
      }
    >
      <section
        aria-label="NVIDIA Nemotron 3.5 ASR Streaming 0.6B"
        style={{
          display: "grid",
          gap: 18,
          padding: 20,
          borderRadius: 14,
          background: "var(--control-muted)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: "rgba(118, 185, 0, 0.12)",
                color: "#4d7a00",
                flexShrink: 0,
              }}
            >
              <IconCpu size={23} stroke={1.8} aria-hidden="true" />
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 16,
                    lineHeight: 1.25,
                    color: "var(--text-hi)",
                  }}
                >
                  NVIDIA Nemotron 3.5
                </h2>
                <span
                  style={{
                    padding: "4px 7px",
                    borderRadius: 999,
                    background: "var(--text-hi)",
                    color: "var(--accent-contrast)",
                    fontSize: 9,
                    fontWeight: 750,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {t("onboarding.model.recommended")}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: "var(--text-mid)",
                }}
              >
                {t("onboarding.model.description")}
              </div>
            </div>
          </div>
          {installed && (
            <IconCheck
              size={22}
              stroke={2.5}
              color="var(--success)"
              aria-label={t("onboarding.model.installed")}
            />
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          <ModelFeature icon={<IconCpu size={13} aria-hidden="true" />}>
            {t("onboarding.model.local")}
          </ModelFeature>
          <ModelFeature icon={<IconBolt size={13} aria-hidden="true" />}>
            {t("onboarding.model.streaming")}
          </ModelFeature>
          <ModelFeature icon={<IconMicrophone size={13} aria-hidden="true" />}>
            {t("onboarding.model.languages")}
          </ModelFeature>
          <ModelFeature icon={<IconDownload size={13} aria-hidden="true" />}>
            {t("onboarding.model.size")}
          </ModelFeature>
        </div>

        {(status === "installing" ||
          status === "installed" ||
          status === "error") && (
          <div aria-live="polite" style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 11,
                color:
                  status === "error"
                    ? "var(--danger)"
                    : installed
                      ? "var(--success)"
                      : "var(--text-mid)",
              }}
            >
              <span>
                {status === "error"
                  ? t("onboarding.model.error")
                  : installed
                    ? t("onboarding.model.installed")
                    : message || t("onboarding.model.installing")}
              </span>
              {status !== "error" && <span>{progress}%</span>}
            </div>
            {status !== "error" && (
              <div
                style={{
                  height: 6,
                  overflow: "hidden",
                  borderRadius: 999,
                  background: "var(--border)",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "var(--text-hi)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            )}
            {status === "error" && message && (
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: "var(--text-low)",
                  overflowWrap: "anywhere",
                }}
              >
                {message}
              </div>
            )}
          </div>
        )}
      </section>
    </OnboardingShell>
  );
}
