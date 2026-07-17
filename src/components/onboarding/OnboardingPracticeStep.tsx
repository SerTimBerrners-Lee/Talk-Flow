import { useEffect, useRef, type ReactElement } from "react";

import { IconCheck, IconKeyboard, IconMicrophone } from "../../lib/icons";
import { useI18n } from "../../lib/i18n";
import {
  HotkeyKeys,
  OnboardingShell,
  SECONDARY_BUTTON_STYLE,
} from "./OnboardingLayout";

export function OnboardingPracticeStep({
  hotkey,
  value,
  success,
  onChange,
  onSkip,
  onClear,
}: {
  hotkey: string;
  value: string;
  success: boolean;
  onChange: (value: string) => void;
  onSkip: () => void;
  onClear: () => void;
}): ReactElement {
  const { lang, t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasMismatch = value.trim().length > 8 && !success;

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleClear = (): void => {
    onClear();
    inputRef.current?.focus();
  };

  return (
    <OnboardingShell
      stage="practice"
      eyebrow={t("onboarding.practice.eyebrow")}
      title={t("onboarding.practice.title")}
      subtitle={t("onboarding.practice.subtitle")}
      footer={
        <>
          <button
            type="button"
            onClick={onSkip}
            style={SECONDARY_BUTTON_STYLE}
          >
            {t("onboarding.skip")}
          </button>
          {hasMismatch ? (
            <button
              type="button"
              onClick={handleClear}
              style={SECONDARY_BUTTON_STYLE}
            >
              {t("onboarding.practice.clear")}
            </button>
          ) : (
            <span
              aria-live="polite"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                color: success ? "var(--success)" : "var(--text-low)",
                fontSize: 11,
                fontWeight: 650,
              }}
            >
              {success && (
                <IconCheck size={15} stroke={2.5} aria-hidden="true" />
              )}
              {success
                ? t("onboarding.practice.success")
                : t("onboarding.practice.listening")}
            </span>
          )}
        </>
      }
    >
      <section style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            display: "grid",
            gap: 9,
            padding: "20px 22px",
            borderRadius: 14,
            background: "var(--control-muted)",
            border: "1px solid var(--border-subtle)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 750,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-low)",
            }}
          >
            {t("onboarding.practice.say")}
          </div>
          <div
            lang={lang}
            style={{
              fontFamily: "var(--font-accent)",
              fontSize: 21,
              fontWeight: 750,
              lineHeight: 1.35,
              letterSpacing: "-0.025em",
              color: "var(--text-hi)",
            }}
          >
            «{t("onboarding.practice.phrase")}»
          </div>
        </div>

        <ol
          role="list"
          style={{
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1.25fr 1fr",
            gap: 8,
            listStyle: "none",
          }}
        >
          {[
            {
              number: "1",
              label: t("onboarding.practice.hold"),
              detail: <HotkeyKeys hotkey={hotkey} />,
            },
            {
              number: "2",
              label: t("onboarding.practice.speak"),
              detail: (
                <IconMicrophone size={20} stroke={1.8} aria-hidden="true" />
              ),
            },
            {
              number: "3",
              label: t("onboarding.practice.release"),
              detail: (
                <IconKeyboard size={20} stroke={1.8} aria-hidden="true" />
              ),
            },
          ].map((item) => (
            <li
              key={item.number}
              style={{
                minHeight: 82,
                padding: 12,
                display: "grid",
                alignContent: "center",
                justifyItems: "center",
                gap: 8,
                borderRadius: 12,
                background: "var(--surface-solid)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-hi)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 750,
                  color: "var(--text-low)",
                }}
              >
                {item.number}. {item.label}
              </div>
              {item.detail}
            </li>
          ))}
        </ol>

        <div style={{ display: "grid", gap: 7 }}>
          <label
            htmlFor="onboarding-practice-input"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-mid)",
            }}
          >
            {t("onboarding.practice.inputLabel")}
          </label>
          <textarea
            ref={inputRef}
            id="onboarding-practice-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("onboarding.practice.placeholder")}
            rows={3}
            aria-describedby={
              hasMismatch ? "onboarding-practice-feedback" : undefined
            }
            style={{
              width: "100%",
              minHeight: 86,
              resize: "none",
              padding: "14px 16px",
              borderRadius: 12,
              border: success
                ? "1px solid var(--success)"
                : "1px solid var(--border-strong)",
              background: "var(--surface-hi)",
              color: "var(--text-hi)",
              fontFamily: "var(--font)",
              fontSize: 14,
              lineHeight: 1.55,
              boxSizing: "border-box",
            }}
          />
          {hasMismatch && (
            <div
              id="onboarding-practice-feedback"
              aria-live="polite"
              style={{
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--text-mid)",
              }}
            >
              {t("onboarding.practice.mismatch")}
            </div>
          )}
        </div>
      </section>
    </OnboardingShell>
  );
}
