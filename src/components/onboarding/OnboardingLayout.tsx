import type { ReactElement, ReactNode } from "react";

import { isMacPlatform } from "../../lib/store";
import { useI18n, type MsgKey } from "../../lib/i18n";
import { formatHotkeyLabel } from "../../lib/store";

export type VisibleOnboardingStage = "model" | "practice" | "success";

export const PRIMARY_BUTTON_STYLE = {
  minHeight: 42,
  padding: "0 20px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  fontFamily: "var(--font)",
  fontSize: 12,
  fontWeight: 750,
  cursor: "pointer",
} as const;

export const SECONDARY_BUTTON_STYLE = {
  minHeight: 42,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--control-muted)",
  color: "var(--text-mid)",
  fontFamily: "var(--font)",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
} as const;

function OnboardingProgress({
  stage,
}: {
  stage: VisibleOnboardingStage;
}): ReactElement {
  const { t } = useI18n();
  const currentIndex =
    stage === "model" ? 0 : stage === "practice" ? 1 : 2;
  const steps: MsgKey[] = [
    "onboarding.progress.model",
    "onboarding.progress.practice",
    "onboarding.progress.ready",
  ];

  return (
    <div
      aria-label={t("onboarding.progress.label")}
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      {steps.map((label, index) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <div
            aria-current={index === currentIndex ? "step" : undefined}
            title={t(label)}
            style={{
              width: index === currentIndex ? 26 : 8,
              height: 8,
              borderRadius: 999,
              background:
                index <= currentIndex
                  ? "var(--text-hi)"
                  : "var(--border-strong)",
              transition: "width 0.2s ease, background 0.2s ease",
            }}
          />
          {index < steps.length - 1 && (
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: 18,
                height: 1,
                background: "var(--border)",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function OnboardingShell({
  stage,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  stage: VisibleOnboardingStage;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        inset: isMacPlatform() ? "48px 0 0" : "0",
        zIndex: 9999,
        padding: 24,
        background: "var(--main-bg)",
        overflow: "auto",
      }}
    >
      <main
        style={{
          width: "min(100%, 760px)",
          minHeight: "100%",
          margin: "0 auto",
          display: "grid",
          alignContent: "center",
          padding: "18px 0",
        }}
      >
        <div
          key={stage}
          style={{
            display: "grid",
            gap: 22,
            padding: "30px",
            borderRadius: 16,
            background: "var(--surface-hi)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-panel)",
            animation: "slide-down 0.18s ease",
          }}
        >
          <header style={{ display: "grid", gap: 16 }}>
            <OnboardingProgress stage={stage} />
            <div style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 750,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-low)",
                }}
              >
                {eyebrow}
              </div>
              <h1
                style={{
                  margin: 0,
                  maxWidth: 600,
                  fontFamily: "var(--font-accent)",
                  fontSize: 32,
                  lineHeight: 1.05,
                  letterSpacing: "-0.04em",
                  color: "var(--text-hi)",
                }}
              >
                {title}
              </h1>
              <p
                style={{
                  margin: 0,
                  maxWidth: 620,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "var(--text-mid)",
                }}
              >
                {subtitle}
              </p>
            </div>
          </header>

          {children}

          <footer
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 42,
            }}
          >
            {footer}
          </footer>
        </div>
      </main>
    </div>
  );
}

export function HotkeyKeys({ hotkey }: { hotkey: string }): ReactElement {
  const keys = formatHotkeyLabel(hotkey)
    .split(" + ")
    .map((key) => key.trim())
    .filter(Boolean);

  return (
    <div
      aria-label={formatHotkeyLabel(hotkey)}
      style={{ display: "flex", alignItems: "center", gap: 6 }}
    >
      {keys.map((key, index) => (
        <div
          key={`${key}-${index}`}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          {index > 0 && (
            <span aria-hidden="true" style={{ color: "var(--text-low)" }}>
              +
            </span>
          )}
          <kbd
            style={{
              minWidth: 38,
              height: 34,
              padding: "0 10px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface-solid)",
              boxShadow: "0 2px 0 var(--border)",
              color: "var(--text-hi)",
              fontFamily: "var(--font)",
              fontSize: 11,
              fontWeight: 750,
            }}
          >
            {key}
          </kbd>
        </div>
      ))}
    </div>
  );
}
