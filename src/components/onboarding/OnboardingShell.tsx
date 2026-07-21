import type { ReactNode } from "react";

import { useI18n } from "../../lib/i18n";

const ONBOARDING_STEP_COUNT = 3;

export function OnboardingProgress({ currentStep }: { currentStep: number }) {
  const { t } = useI18n();
  const currentValue = Math.min(currentStep + 1, ONBOARDING_STEP_COUNT);

  return (
    <div
      role="progressbar"
      aria-label={t("onboarding.progressLabel")}
      aria-valuemin={1}
      aria-valuemax={ONBOARDING_STEP_COUNT}
      aria-valuenow={currentValue}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        left: 0,
        height: 3,
        overflow: "hidden",
        background: "var(--progress-track)",
        pointerEvents: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: `${(currentValue / ONBOARDING_STEP_COUNT) * 100}%`,
          height: "100%",
          background: "var(--accent)",
          transformOrigin: "left center",
          transition: "width 0.2s var(--ease-standard)",
        }}
      ></span>
    </div>
  );
}

export function OnboardingShell({
  currentStep,
  title,
  subtitle,
  showProgress = true,
  children,
  footer,
}: {
  currentStep: number;
  title?: string;
  subtitle?: string;
  showProgress?: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  const titleId = `onboarding-step-${currentStep}-title`;

  return (
    <div
      style={{
        position: "fixed",
        top: 48,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9999,
        padding: 24,
        background: "var(--main-bg)",
        overflowY: "auto",
      }}
    >
      <main
        aria-labelledby={title ? titleId : undefined}
        style={{
          width: "min(100%, 760px)",
          minHeight: "100%",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="card"
          style={{
            width: "100%",
            padding: "24px 26px",
            display: "grid",
            gap: 20,
            background: "var(--surface-hi)",
            borderRadius: 10,
            boxShadow: "var(--shadow-panel)",
            overflow: "hidden",
          }}
        >
          {(title || subtitle) && (
            <header style={{ display: "grid", gap: 8 }}>
              {title && (
                <h1
                  id={titleId}
                  style={{
                    margin: 0,
                    color: "var(--text-hi)",
                    fontFamily: "var(--font-accent)",
                    fontSize: 28,
                    fontWeight: 800,
                    lineHeight: 1.08,
                    letterSpacing: "-0.04em",
                  }}
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p
                  style={{
                    margin: 0,
                    maxWidth: 640,
                    color: "var(--text-mid)",
                    fontSize: 13,
                    lineHeight: 1.65,
                  }}
                >
                  {subtitle}
                </p>
              )}
            </header>
          )}
          {children}
          <footer>{footer}</footer>
          {showProgress && <OnboardingProgress currentStep={currentStep} />}
        </div>
      </main>
    </div>
  );
}
