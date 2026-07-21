import { useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";

import { IconCheck, IconLoader2 } from "../../lib/icons";
import {
  HISTORY_DELETED_EVENT,
  HISTORY_UPDATED_EVENT,
} from "../../lib/hotkeyEvents";
import { useI18n } from "../../lib/i18n";
import { logError } from "../../lib/logger";
import { matchesOnboardingTestPhrase } from "../../lib/onboarding";
import type { AppSettings, HistoryEntry } from "../../lib/store";
import { DictationHotkeyControl } from "../DictationHotkeyControl";
import { OnboardingConfetti } from "./OnboardingConfetti";
import { OnboardingShell } from "./OnboardingShell";

export function OnboardingTestStep({
  settings,
  onBack,
  onComplete,
}: {
  settings: AppSettings;
  onBack: () => void;
  onComplete: () => void;
}): ReactElement {
  const { t } = useI18n();
  const mountedAtRef = useRef(Date.now());
  const activeEntryIdRef = useRef<string | null>(null);
  const [activeSettings, setActiveSettings] = useState(settings);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [phraseMatched, setPhraseMatched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = listen<HistoryEntry>(
      HISTORY_UPDATED_EVENT,
      ({ payload: entry }) => {
        if (
          disposed ||
          entry.source !== "voice" ||
          Date.parse(entry.timestamp) < mountedAtRef.current
        ) {
          return;
        }

        if (entry.status === "processing") {
          activeEntryIdRef.current = entry.id;
          setProcessing(true);
          setTranscript("");
          setPhraseMatched(false);
          setError("");
          return;
        }

        if (entry.id !== activeEntryIdRef.current) return;

        setProcessing(false);
        if (entry.status === "failed") {
          activeEntryIdRef.current = null;
          setPhraseMatched(false);
          setError(entry.errorMessage || t("onboarding.test.failed"));
          return;
        }

        if (entry.status === "interrupted") {
          activeEntryIdRef.current = null;
          setPhraseMatched(false);
          setError(entry.errorMessage || t("onboarding.test.failed"));
          return;
        }

        const recognized = entry.raw.trim() || entry.cleaned.trim();
        if (entry.status === "completed" && recognized) {
          activeEntryIdRef.current = null;
          setTranscript(recognized);
          setPhraseMatched(
            matchesOnboardingTestPhrase(
              recognized,
              t("onboarding.test.phrase"),
            ),
          );
          setError("");
          return;
        }

        if (entry.status === "completed") {
          activeEntryIdRef.current = null;
          setPhraseMatched(false);
          setError(t("onboarding.test.noSpeech"));
        }
      },
    );

    const unlistenDeletedPromise = listen<{ id: string }>(
      HISTORY_DELETED_EVENT,
      ({ payload }) => {
        if (disposed || payload.id !== activeEntryIdRef.current) return;
        activeEntryIdRef.current = null;
        setProcessing(false);
        setTranscript("");
        setPhraseMatched(false);
        setError(t("onboarding.test.noSpeech"));
      },
    );

    unlistenPromise.catch((cause) => {
      logError(
        "ONBOARDING",
        `Failed to listen for dictation test result: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    unlistenDeletedPromise.catch((cause) => {
      logError(
        "ONBOARDING",
        `Failed to listen for empty dictation test result: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      void unlistenDeletedPromise
        .then((unlisten) => unlisten())
        .catch(() => {});
    };
  }, [t]);

  const canFinish = Boolean(transcript) && phraseMatched;

  return (
    <OnboardingShell
      currentStep={2}
      title={t("onboarding.test.title")}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--control-muted)",
              color: "var(--text-hi)",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            ← {t("onboarding.back")}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!canFinish && (
              <button
                type="button"
                onClick={onComplete}
                style={{
                  padding: "10px 4px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-low)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {t("onboarding.test.skip")}
              </button>
            )}
            {canFinish && (
              <button
                type="button"
                onClick={onComplete}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                  cursor: "pointer",
                  fontWeight: 750,
                }}
              >
                {t("onboarding.test.finish")}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 20, textAlign: "center" }}>
        <DictationHotkeyControl
          settings={activeSettings}
          onSettingsChange={setActiveSettings}
          appearance="keycaps"
          livePreview
        />

        <p
          style={{
            width: "min(100%, 620px)",
            margin: "2px auto 0",
            color: "var(--text-hi)",
            fontFamily: "var(--font-accent)",
            fontSize: 22,
            fontWeight: 750,
            lineHeight: 1.42,
            letterSpacing: "-0.03em",
          }}
        >
          {t("onboarding.test.phrase")}
        </p>

        {processing && (
          <div
            role="status"
            aria-live="polite"
            style={{
              minHeight: 76,
              display: "grid",
              alignItems: "center",
              justifyItems: "center",
              gap: 9,
            }}
          >
            <IconLoader2
              className="onboarding-test-spinner"
              size={25}
              stroke={1.8}
            />
            <span
              style={{
                color: "var(--text-mid)",
                fontFamily: "var(--font-main)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {t("onboarding.test.processing")}
            </span>
          </div>
        )}

        {transcript && phraseMatched && (
          <div
            className="onboarding-success-reveal"
            role="status"
            aria-live="polite"
            style={{
              position: "relative",
              minHeight: 104,
              display: "grid",
              alignContent: "center",
              justifyItems: "center",
              gap: 9,
            }}
          >
            <OnboardingConfetti key={transcript} />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                color: "var(--success)",
                fontFamily: "var(--font-accent)",
                fontSize: 16,
                fontWeight: 800,
                lineHeight: 1.3,
                letterSpacing: "-0.025em",
              }}
            >
              <IconCheck size={18} stroke={2.5} />
              {t("onboarding.test.result")}
            </div>
            <p
              style={{
                width: "min(100%, 620px)",
                margin: 0,
                color: "var(--text-hi)",
                fontFamily: "var(--font-main)",
                fontSize: 16,
                fontWeight: 500,
                lineHeight: 1.55,
              }}
            >
              {transcript}
            </p>
          </div>
        )}

        {transcript && !phraseMatched && (
          <div
            role="status"
            aria-live="polite"
            style={{
              minHeight: 104,
              display: "grid",
              alignContent: "center",
              justifyItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                color: "var(--danger)",
                fontFamily: "var(--font-accent)",
                fontSize: 16,
                fontWeight: 800,
                lineHeight: 1.3,
                letterSpacing: "-0.025em",
              }}
            >
              {t("onboarding.test.mismatchTitle")}
            </div>
            <p
              style={{
                width: "min(100%, 620px)",
                margin: 0,
                color: "var(--text-hi)",
                fontFamily: "var(--font-main)",
                fontSize: 16,
                fontWeight: 500,
                lineHeight: 1.55,
              }}
            >
              {transcript}
            </p>
            <span
              style={{
                color: "var(--text-mid)",
                fontFamily: "var(--font-main)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {t("onboarding.test.mismatchHint")}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--danger-border)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
              fontSize: 12,
              lineHeight: 1.55,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </OnboardingShell>
  );
}
