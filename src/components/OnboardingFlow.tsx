import { useCallback, useEffect, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import {
  DEFAULT_HOTKEY,
  getSettings,
  saveSettings,
  setOnboardingStage,
  type OnboardingStage,
} from "../lib/store";
import { SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import { isPracticePhraseMatch } from "../lib/onboardingPractice";
import { logError, logInfo } from "../lib/logger";
import { useI18n } from "../lib/i18n";
import {
  OnboardingModelStep,
  type OnboardingModelStatus,
} from "./onboarding/OnboardingModelStep";
import { OnboardingPracticeStep } from "./onboarding/OnboardingPracticeStep";
import { OnboardingSuccessStep } from "./onboarding/OnboardingSuccessStep";
import type { VisibleOnboardingStage } from "./onboarding/OnboardingLayout";

const NEMOTRON_MODEL = {
  id: "nemotron-35-asr-streaming-06b",
  model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
  endpoint: "http://127.0.0.1:8000",
} as const;

const MODEL_DOWNLOAD_PROGRESS_EVENT = "local-stt-model-download-progress";

interface ModelDownloadProgressEvent {
  model: string;
  status: "starting" | "preparing" | "downloading" | "downloaded";
  downloaded_bytes: number;
  total_bytes?: number | null;
  percent?: number | null;
  message?: string | null;
}

interface InstallModelResult {
  success: boolean;
  message: string;
  whisper_endpoint?: string | null;
}

interface OnboardingFlowProps {
  initialStage: Exclude<OnboardingStage, "completed">;
  onComplete: () => void;
}

export function OnboardingFlow({
  initialStage,
  onComplete,
}: OnboardingFlowProps): ReactElement {
  const { lang, t } = useI18n();
  const [stage, setStage] =
    useState<VisibleOnboardingStage>(initialStage);
  const [modelStatus, setModelStatus] =
    useState<OnboardingModelStatus>("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelMessage, setModelMessage] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [practiceValue, setPracticeValue] = useState("");
  const [practiceSuccess, setPracticeSuccess] = useState(false);

  const modelInstalled = modelStatus === "installed";

  const goToStage = useCallback(
    async (nextStage: VisibleOnboardingStage): Promise<void> => {
      setStage(nextStage);
      await setOnboardingStage(nextStage);
    },
    [],
  );

  useEffect(() => {
    getSettings({ reload: true })
      .then((settings) => {
        setHotkey(settings.hotkey || DEFAULT_HOTKEY);
        if (
          settings.localModels?.[NEMOTRON_MODEL.id]?.status === "downloaded"
        ) {
          setModelStatus("installed");
          setModelProgress(100);
        }
      })
      .catch((error) => {
        void logError(
          "ONBOARDING",
          `Failed to load settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<ModelDownloadProgressEvent>(
      MODEL_DOWNLOAD_PROGRESS_EVENT,
      ({ payload }) => {
        if (payload.model !== NEMOTRON_MODEL.model) return;

        const progress =
          typeof payload.percent === "number"
            ? Math.max(0, Math.min(100, payload.percent))
            : 0;
        setModelStatus("installing");
        setModelProgress(payload.status === "downloaded" ? 100 : progress);
        setModelMessage(lang === "ru" ? payload.message || null : null);
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [lang]);

  useEffect(() => {
    if (!practiceSuccess) return;
    const timeout = window.setTimeout(() => {
      void goToStage("success");
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [goToStage, practiceSuccess]);

  const handleInstallModel = async (): Promise<void> => {
    if (modelStatus === "installing") return;

    setModelStatus("installing");
    setModelProgress(0);
    setModelMessage(t("onboarding.model.preparing"));
    void logInfo("ONBOARDING", `Installing ${NEMOTRON_MODEL.model}`);

    try {
      const settings = await getSettings({ reload: true });
      const result = await invoke<InstallModelResult>("install_stt_model", {
        req: {
          api_key: settings.apiKey || "",
          whisper_api_key: null,
          whisper_endpoint: NEMOTRON_MODEL.endpoint,
          local_models_dir: settings.localModelsDir || null,
          whisper_model: NEMOTRON_MODEL.model,
        },
      });

      if (!result.success) {
        throw new Error(result.message);
      }

      const now = new Date().toISOString();
      await saveSettings({
        useOwnKey: true,
        provider: "custom",
        whisperApiKey: "",
        whisperEndpoint:
          result.whisper_endpoint || NEMOTRON_MODEL.endpoint,
        whisperModel: NEMOTRON_MODEL.model,
        realtimeTranscriptionEnabled: true,
        localModels: {
          ...(settings.localModels || {}),
          [NEMOTRON_MODEL.id]: {
            status: "downloaded",
            downloadedAt: now,
            lastCheckedAt: now,
          },
        },
      });
      await emit(SETTINGS_UPDATED_EVENT);
      setModelStatus("installed");
      setModelProgress(100);
      setModelMessage(t("onboarding.model.installed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logError("ONBOARDING", `Model installation failed: ${message}`);
      setModelStatus("error");
      setModelMessage(message);
    }
  };

  const handleSkipModel = async (): Promise<void> => {
    if (modelStatus === "installing") {
      await invoke("cancel_local_model_download", {
        modelId: NEMOTRON_MODEL.model,
      }).catch(() => undefined);
    }
    await goToStage("practice");
  };

  const handlePracticeChange = (value: string): void => {
    setPracticeValue(value);
    if (
      !practiceSuccess &&
      isPracticePhraseMatch(value, t("onboarding.practice.phrase"))
    ) {
      setPracticeSuccess(true);
    }
  };

  const handleComplete = async (): Promise<void> => {
    await setOnboardingStage("completed");
    onComplete();
  };

  if (stage === "model") {
    return (
      <OnboardingModelStep
        status={modelStatus}
        progress={modelProgress}
        message={modelMessage}
        onInstall={() => void handleInstallModel()}
        onSkip={() => void handleSkipModel()}
        onContinue={() => void goToStage("practice")}
      />
    );
  }

  if (stage === "practice") {
    return (
      <OnboardingPracticeStep
        hotkey={hotkey}
        value={practiceValue}
        success={practiceSuccess}
        onChange={handlePracticeChange}
        onSkip={() => void goToStage("success")}
        onClear={() => setPracticeValue("")}
      />
    );
  }

  return (
    <OnboardingSuccessStep
      hotkey={hotkey}
      modelInstalled={modelInstalled}
      onComplete={() => void handleComplete()}
    />
  );
}
