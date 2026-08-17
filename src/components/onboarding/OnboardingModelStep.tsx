import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import {
  ONBOARDING_STT_MODELS,
  type OnboardingSttModel,
} from "../../config/onboardingSttModels";
import { SETTINGS_UPDATED_EVENT } from "../../lib/hotkeyEvents";
import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconTrash,
  IconX,
} from "../../lib/icons";
import { useI18n } from "../../lib/i18n";
import { logError, logInfo } from "../../lib/logger";
import {
  buildOnboardingLocalSttPatch,
  formatOnboardingDownloadProgress,
  ONBOARDING_LOCAL_STT_ENDPOINT,
} from "../../lib/onboarding";
import { getSettings, saveSettings, type AppSettings } from "../../lib/store";
import { formatErrorMessage } from "../../lib/utils";
import { LocalSttModelCard } from "../LocalSttModelCard";
import { OnboardingShell } from "./OnboardingShell";

const DOWNLOAD_PROGRESS_EVENT = "local-stt-model-download-progress";

interface DownloadProgressEvent {
  model: string;
  status: "starting" | "preparing" | "downloading" | "downloaded" | "cancelled";
  downloaded_bytes: number;
  total_bytes?: number | null;
  percent?: number | null;
  message?: string | null;
}

interface ListModelsResult {
  models: string[];
  whisper_endpoint?: string | null;
}

interface InstallModelResult {
  success: boolean;
  message: string;
  whisper_endpoint?: string | null;
}

interface ModelActionState {
  modelId: string;
  status: "downloading" | "activating" | "deleting" | "error";
  message: string;
  progress?: number;
  progressBytes?: string;
}

function isLocalModelActive(
  settings: AppSettings | null,
  model: OnboardingSttModel,
): boolean {
  return Boolean(
    settings &&
    /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "") &&
    settings.whisperModel === model.model,
  );
}

export function OnboardingModelStep({
  onContinue,
  onSkip,
}: {
  onContinue: (settings: AppSettings) => void;
  onSkip: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [effectiveEndpoint, setEffectiveEndpoint] = useState<string | null>(
    null,
  );
  const [expandedId, setExpandedId] = useState(ONBOARDING_STT_MODELS[0].id);
  const [checking, setChecking] = useState(true);
  const [action, setAction] = useState<ModelActionState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OnboardingSttModel | null>(
    null,
  );

  const onboardingModel = ONBOARDING_STT_MODELS[0];
  const activeInstalledModel =
    installedModels.includes(onboardingModel.model) &&
    isLocalModelActive(settings, onboardingModel);
  const isBusy = checking || Boolean(action && action.status !== "error");

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      const current = await getSettings({ reload: true });
      if (!active) return;
      setSettings(current);

      try {
        const result = await invoke<ListModelsResult>("list_stt_models", {
          req: {
            api_key: current.apiKey || "",
            whisper_api_key: null,
            whisper_endpoint: ONBOARDING_LOCAL_STT_ENDPOINT,
            local_models_dir: current.localModelsDir || null,
          },
        });
        if (!active) return;
        setInstalledModels(result.models || []);
        setEffectiveEndpoint(result.whisper_endpoint || null);
      } catch (error) {
        if (!active) return;
        const message = formatErrorMessage(error);
        logError("ONBOARDING", `Failed to list local STT models: ${message}`);
        setAction({
          modelId: ONBOARDING_STT_MODELS[0].model,
          status: "error",
          message: t("onboarding.model.loadFailed"),
        });
      } finally {
        if (active) setChecking(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const unlistenPromise = listen<DownloadProgressEvent>(
      DOWNLOAD_PROGRESS_EVENT,
      ({ payload }) => {
        setAction((current) => {
          if (!current || current.modelId !== payload.model) return current;
          if (payload.status === "cancelled") return null;

          return {
            modelId: payload.model,
            status:
              payload.status === "downloaded" ? "activating" : "downloading",
            message:
              payload.message ||
              (payload.status === "downloaded"
                ? t("onboarding.model.activating")
                : payload.status === "preparing"
                  ? t("onboarding.model.preparing")
                  : t("onboarding.model.downloading")),
            progress:
              typeof payload.percent === "number"
                ? Math.max(0, Math.min(100, payload.percent))
                : undefined,
            progressBytes: formatOnboardingDownloadProgress(
              payload.downloaded_bytes,
              payload.total_bytes,
            ),
          };
        });
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [t]);

  const activateModel = async (
    model: OnboardingSttModel,
    endpoint?: string | null,
  ): Promise<AppSettings> => {
    if (!settings) throw new Error(t("onboarding.model.settingsUnavailable"));

    setAction({
      modelId: model.model,
      status: "activating",
      message: t("onboarding.model.activating"),
    });
    const patch = buildOnboardingLocalSttPatch({
      settings,
      model,
      endpoint: endpoint || effectiveEndpoint,
    });
    await saveSettings(patch);
    await emit(SETTINGS_UPDATED_EVENT);
    const nextSettings = await getSettings({ reload: true });
    setSettings(nextSettings);
    logInfo("ONBOARDING", `Activated local STT model: ${model.model}`);
    return nextSettings;
  };

  const installModel = async (model: OnboardingSttModel): Promise<void> => {
    if (!settings || isBusy) return;

    setExpandedId(model.id);
    setAction({
      modelId: model.model,
      status: "downloading",
      message: t("onboarding.model.preparing"),
      progress: 0,
    });

    try {
      logInfo("ONBOARDING", `Installing STT model: ${model.model}`);
      const result = await invoke<InstallModelResult>("install_stt_model", {
        req: {
          api_key: settings.apiKey || "",
          whisper_api_key: null,
          whisper_endpoint: ONBOARDING_LOCAL_STT_ENDPOINT,
          local_models_dir: settings.localModelsDir || null,
          whisper_model: model.model,
        },
      });
      if (!result.success) throw new Error(result.message);

      setInstalledModels((current) =>
        current.includes(model.model) ? current : [...current, model.model],
      );
      setEffectiveEndpoint(result.whisper_endpoint || effectiveEndpoint);
      await activateModel(model, result.whisper_endpoint);
      setAction(null);
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/отмен|cancel/i.test(message)) {
        setAction(null);
        return;
      }
      logError("ONBOARDING", `Failed to install STT model: ${message}`);
      setAction({ modelId: model.model, status: "error", message });
    }
  };

  const selectModel = async (model: OnboardingSttModel): Promise<void> => {
    if (!settings || isBusy) return;
    try {
      await activateModel(model);
      setAction(null);
    } catch (error) {
      const message = formatErrorMessage(error);
      logError("ONBOARDING", `Failed to select STT model: ${message}`);
      setAction({ modelId: model.model, status: "error", message });
    }
  };

  const cancelDownload = async (model: OnboardingSttModel): Promise<void> => {
    await invoke("cancel_local_model_download", { modelId: model.model }).catch(
      () => {},
    );
  };

  const deleteModel = async (model: OnboardingSttModel): Promise<void> => {
    if (!settings || isBusy) return;
    setPendingDelete(null);
    setAction({
      modelId: model.model,
      status: "deleting",
      message: t("onboarding.model.deleting"),
    });

    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "delete_stt_model",
        {
          req: {
            api_key: settings.apiKey || "",
            whisper_api_key: null,
            whisper_endpoint: ONBOARDING_LOCAL_STT_ENDPOINT,
            local_models_dir: settings.localModelsDir || null,
            whisper_model: model.model,
          },
        },
      );
      if (!result.success) throw new Error(result.message);

      const nextLocalModels = {
        ...settings.localModels,
        [model.id]: {
          status: "not_downloaded" as const,
          lastCheckedAt: new Date().toISOString(),
        },
      };
      await saveSettings({ localModels: nextLocalModels });
      const nextSettings = await getSettings({ reload: true });
      setSettings(nextSettings);
      setInstalledModels((current) =>
        current.filter((installed) => installed !== model.model),
      );
      setAction(null);
      logInfo("ONBOARDING", `Deleted local STT model: ${model.model}`);
    } catch (error) {
      const message = formatErrorMessage(error);
      logError("ONBOARDING", `Failed to delete STT model: ${message}`);
      setAction({ modelId: model.model, status: "error", message });
    }
  };

  const installed = installedModels.includes(onboardingModel.model);
  const selected = installed && isLocalModelActive(settings, onboardingModel);
  const modelAction = action?.modelId === onboardingModel.model ? action : null;
  const downloading = modelAction?.status === "downloading";
  const modelBusy = Boolean(modelAction && modelAction.status !== "error");
  const statusLabel = selected
    ? t("onboarding.model.selected")
    : installed
      ? t("onboarding.model.installed")
      : t("onboarding.model.notInstalled");

  return (
    <OnboardingShell
      currentStep={1}
      title={t("onboarding.model.title")}
      subtitle={t("onboarding.model.subtitle")}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onSkip}
            disabled={isBusy}
            style={{
              padding: "10px 4px",
              border: "none",
              background: "transparent",
              color: "var(--text-low)",
              cursor: isBusy ? "default" : "pointer",
              opacity: isBusy ? 0.55 : 1,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {t("onboarding.model.skip")}
          </button>
          <button
            type="button"
            onClick={() => settings && onContinue(settings)}
            disabled={!settings || !activeInstalledModel || isBusy}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-contrast)",
              cursor:
                settings && activeInstalledModel && !isBusy
                  ? "pointer"
                  : "default",
              opacity: settings && activeInstalledModel && !isBusy ? 1 : 0.45,
              fontWeight: 750,
            }}
          >
            {t("onboarding.model.continue")}
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {checking && (
          <div
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text-mid)",
              fontSize: 12,
            }}
          >
            <IconLoader2
              size={15}
              stroke={2}
              style={{ animation: "spin 1s linear infinite" }}
            />
            {t("onboarding.model.checking")}
          </div>
        )}

        <LocalSttModelCard
          name={onboardingModel.name}
          description={t(onboardingModel.descriptionKey)}
          recommendedLabel={t("onboarding.model.recommended")}
          statusLabel={statusLabel}
          statusColor={selected ? "var(--success)" : "var(--text-low)"}
          expanded={expandedId === onboardingModel.id}
          onToggle={() =>
            setExpandedId(
              expandedId === onboardingModel.id ? "" : onboardingModel.id,
            )
          }
          disclosureLabel={t(
            expandedId === onboardingModel.id
              ? "onboarding.model.collapse"
              : "onboarding.model.expand",
          )}
          stats={{
            storageLabel: onboardingModel.sizeLabel,
            storageTitle: t("models.stat.downloadSizeTitle", {
              value: onboardingModel.sizeLabel,
            }),
            languageLabel: t("models.languageValue.count", {
              value: onboardingModel.languageLabel,
            }),
            languageTitle: t("models.stat.languagesTitle", {
              value: t("models.languageValue.count", {
                value: onboardingModel.languageLabel,
              }),
            }),
            speedLabel: t("models.speedValue.veryFast"),
            speedTitle: t("models.stat.speedTitle", {
              value: t("models.speedValue.veryFast"),
            }),
            accuracyLabel: t("models.accuracyValue.high"),
            accuracyTitle: t("models.stat.accuracyTitle", {
              value: t("models.accuracyValue.high"),
            }),
            streamingLabel: t("models.stat.streaming"),
          }}
          notice={
            modelAction?.status === "error"
              ? { message: modelAction.message, tone: "error" }
              : undefined
          }
          progress={
            downloading
              ? {
                  message: modelAction.message,
                  percent: modelAction.progress,
                  valueLabel: modelAction.progressBytes,
                  downloadedLabel: modelAction.progressBytes,
                }
              : undefined
          }
          connectionLabel={
            installed
              ? selected
                ? t("onboarding.model.ready")
                : t("onboarding.model.downloadedReady")
              : t("onboarding.model.downloadHint")
          }
          connectionColor={selected ? "var(--success)" : "var(--text-mid)"}
          showConnectionCheck={installed}
          actions={
            <>
              {installed && !selected && !modelBusy && (
                <button
                  type="button"
                  onClick={() => void selectModel(onboardingModel)}
                  disabled={isBusy}
                  style={secondaryActionStyle(isBusy)}
                >
                  <IconCheck size={14} stroke={2.5} />
                  {t("onboarding.model.select")}
                </button>
              )}
              {!modelBusy && (
                <button
                  type="button"
                  onClick={() =>
                    installed
                      ? setPendingDelete(onboardingModel)
                      : void installModel(onboardingModel)
                  }
                  disabled={isBusy}
                  style={
                    installed
                      ? secondaryActionStyle(isBusy)
                      : primaryActionStyle(isBusy)
                  }
                >
                  {installed ? (
                    <IconTrash size={14} stroke={2.2} />
                  ) : (
                    <IconDownload size={14} stroke={2.2} />
                  )}
                  {installed
                    ? t("onboarding.model.delete")
                    : t("onboarding.model.download")}
                </button>
              )}
              {downloading && (
                <button
                  type="button"
                  onClick={() => void cancelDownload(onboardingModel)}
                  style={secondaryActionStyle(false)}
                >
                  <IconX size={14} stroke={2.2} />
                  {t("onboarding.model.cancel")}
                </button>
              )}
            </>
          }
        />
      </div>

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-delete-model-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            padding: 20,
            display: "grid",
            placeItems: "center",
            background: "var(--modal-scrim)",
          }}
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="card"
            style={{
              width: "min(420px, 100%)",
              padding: 18,
              background: "var(--bg)",
              boxShadow: "var(--shadow-modal)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="onboarding-delete-model-title"
              style={{
                margin: "0 0 8px",
                fontFamily: "var(--font-accent)",
                fontSize: 18,
                letterSpacing: "-0.03em",
              }}
            >
              {t("onboarding.model.deleteTitle")}
            </h2>
            <p
              style={{
                margin: "0 0 16px",
                color: "var(--text-mid)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {t("onboarding.model.deleteBody", { name: pendingDelete.name })}
            </p>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                style={secondaryActionStyle(false)}
              >
                {t("onboarding.model.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void deleteModel(pendingDelete)}
                style={primaryActionStyle(false)}
              >
                <IconTrash size={14} stroke={2.2} />
                {t("onboarding.model.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}

function secondaryActionStyle(disabled: boolean) {
  return {
    padding: "9px 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    border: "1px solid var(--border-dashed)",
    background: "var(--control-muted)",
    color: "var(--text-hi)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontSize: 12,
    fontWeight: 700,
  } as const;
}

function primaryActionStyle(disabled: boolean) {
  return {
    ...secondaryActionStyle(disabled),
    border: "1px solid var(--border-dashed)",
    background: "var(--accent)",
    color: "var(--accent-contrast)",
  } as const;
}
