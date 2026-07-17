import type { ReactElement } from "react";

import { IconCheck, IconCpu, IconKeyboard, IconSparkles } from "../../lib/icons";
import { formatHotkeyLabel } from "../../lib/store";
import { useI18n } from "../../lib/i18n";
import {
  OnboardingShell,
  PRIMARY_BUTTON_STYLE,
} from "./OnboardingLayout";

export function OnboardingSuccessStep({
  hotkey,
  modelInstalled,
  onComplete,
}: {
  hotkey: string;
  modelInstalled: boolean;
  onComplete: () => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <OnboardingShell
      stage="success"
      eyebrow={t("onboarding.success.eyebrow")}
      title={t("onboarding.success.title")}
      subtitle={t("onboarding.success.subtitle")}
      footer={
        <>
          <div />
          <button
            type="button"
            onClick={onComplete}
            style={{
              ...PRIMARY_BUTTON_STYLE,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {t("onboarding.success.open")}
            <IconSparkles size={15} stroke={2} aria-hidden="true" />
          </button>
        </>
      }
    >
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <div
          style={{
            padding: "18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 12,
            background: "var(--control-muted)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              background: "var(--icon-soft-bg)",
              color: modelInstalled ? "var(--success)" : "var(--text-mid)",
            }}
          >
            {modelInstalled ? (
              <IconCheck size={17} stroke={2.5} aria-hidden="true" />
            ) : (
              <IconCpu size={17} stroke={1.8} aria-hidden="true" />
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-hi)",
            }}
          >
            {modelInstalled
              ? t("onboarding.success.modelReady")
              : t("onboarding.progress.model")}
          </div>
        </div>
        <div
          style={{
            padding: "18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 12,
            background: "var(--control-muted)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              background: "var(--icon-soft-bg)",
              color: "var(--text-hi)",
            }}
          >
            <IconKeyboard size={17} stroke={1.8} aria-hidden="true" />
          </div>
          <div style={{ display: "grid", gap: 3 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text-hi)",
              }}
            >
              {t("onboarding.success.hotkeyReady")}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-low)" }}>
              {formatHotkeyLabel(hotkey)}
            </div>
          </div>
        </div>
      </section>
    </OnboardingShell>
  );
}
