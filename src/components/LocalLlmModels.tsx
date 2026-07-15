import { useEffect, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  IconAlertCircle,
  IconCheck,
  IconDownload,
  IconGauge,
  IconGlobe,
  IconLoader2,
  IconTargetArrow,
  IconTrash,
  IconX,
  type Icon,
} from "../lib/icons";

import { AppSettings } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { ModelCardDisclosureButton } from "./ModelCardDisclosureButton";
import {
  isLocalLlmEndpoint,
  localLlmDeleteSettingsPatch,
  selectedLocalLlmModelId,
} from "../lib/localLlmSelection";

interface LocalLlmModel {
  id: string;
  label: string;
  description: string;
  file_name: string;
  size_label: string;
  min_ram_gb: number;
  speed: string;
  accuracy: string;
  language_label: string;
  recommended: boolean;
  downloaded: boolean;
}

interface DownloadProgress {
  model_id: string;
  status: string;
  percent: number | null;
}

const ACTION_BUTTON_BASE = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-dashed)",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "var(--font-main)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 8,
} as const;

/**
 * Local text (LLM) model slot for "Локально" mode — same card style as the local
 * STT models: download a bundled GGUF model and start the managed runtime, then
 * point summary at it.
 */
export function LocalLlmModels({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<LocalLlmModel[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const list = await invoke<LocalLlmModel[]>("list_local_llm_models");
      setModels(list);
    } catch {
      /* keep last known state */
    }
  };

  useEffect(() => {
    void refresh();
    // Restore any in-flight download started before this view was mounted, so the
    // progress survives switching tabs / minimizing the app.
    invoke<DownloadProgress[]>("get_llm_download_progress")
      .then((items) => {
        setProgress((prev) => {
          const next = { ...prev };
          for (const item of items) {
            next[item.model_id] = item;
          }
          return next;
        });
      })
      .catch(() => {});

    const unlisten = listen<DownloadProgress>(
      "local-llm-model-download-progress",
      (event) => {
        const payload = event.payload;
        setProgress((prev) => {
          const next = { ...prev };
          if (
            payload.status === "downloaded" ||
            payload.status === "cancelled" ||
            payload.status === "error"
          ) {
            delete next[payload.model_id];
          } else {
            next[payload.model_id] = payload;
          }
          return next;
        });
        if (payload.status === "downloaded" || payload.status === "cancelled") {
          void refresh();
        }
      },
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const download = async (model: LocalLlmModel): Promise<void> => {
    setError(null);
    // Optimistic start; the backend registry + events drive the bar from here,
    // so it survives this component unmounting (tab switch / minimize).
    setProgress((prev) => ({
      ...prev,
      [model.id]: { model_id: model.id, status: "starting", percent: null },
    }));
    try {
      await invoke("download_local_llm_model", { modelId: model.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("отменена")) {
        setError(message);
      }
    }
    await refresh();
  };

  const cancelDownload = async (model: LocalLlmModel): Promise<void> => {
    try {
      await invoke("cancel_local_model_download", { modelId: model.id });
    } catch {
      /* best-effort */
    }
  };

  const remove = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setDeleting(model.id);
    setError(null);
    try {
      await invoke("delete_local_llm_model", { modelId: model.id });
      const cleanupPatch = localLlmDeleteSettingsPatch(settings, model.id);
      if (cleanupPatch) {
        update(cleanupPatch);
      }
      setProgress((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  };

  const useForSummary = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setError(null);
    try {
      const baseUrl = await invoke<string>("start_local_llm", { modelId: model.id });
      // Mark this as the BUNDLED runtime so summary can auto-(re)start the sidecar
      // after an app restart (the process dies but the endpoint stays persisted).
      update({ llmEndpoint: baseUrl, llmModel: model.id, llmLocalModelId: model.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const usingLocalEndpoint = isLocalLlmEndpoint(settings.llmEndpoint);
  const selectedModelId = selectedLocalLlmModelId(settings);

  const translateSpeedValue = (value: string): string => {
    switch (value) {
      case "очень быстро": return t("models.speedValue.veryFast");
      case "быстро": return t("models.speedValue.fast");
      case "средне": return t("models.speedValue.medium");
      default: return value;
    }
  };

  const translateAccuracyValue = (value: string): string => {
    switch (value) {
      case "максимальная": return t("models.accuracyValue.maximum");
      case "высокая": return t("models.accuracyValue.high");
      case "средняя": return t("models.accuracyValue.medium");
      case "средняя+": return t("models.accuracyValue.mediumPlus");
      case "базовая": return t("models.accuracyValue.basic");
      case "низкая+": return t("models.accuracyValue.lowPlus");
      case "служебная": return t("models.accuracyValue.utility");
      default: return value;
    }
  };

  const translateLanguageValue = (value: string): string => {
    if (value === "English") return t("models.languageValue.english");
    if (/^\d+\+?$/.test(value)) return t("models.languageValue.count", { value });
    return value;
  };

  const renderLocalLlmStats = (model: LocalLlmModel): ReactElement => {
    const speedValueLabel = translateSpeedValue(model.speed);
    const accuracyValueLabel = translateAccuracyValue(model.accuracy);
    const languageValueLabel = translateLanguageValue(model.language_label);
    const stats: { key: string; title: string; Icon: Icon; value: string }[] = [
      { key: "speed", title: t("models.stat.speedTitle", { value: speedValueLabel }), Icon: IconGauge, value: speedValueLabel },
      { key: "accuracy", title: t("models.stat.accuracyTitle", { value: accuracyValueLabel }), Icon: IconTargetArrow, value: accuracyValueLabel },
    ];

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
        <div
          title={t("models.stat.downloadSizeTitle", { value: model.size_label })}
          aria-label={t("models.stat.downloadSizeTitle", { value: model.size_label })}
          style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
        >
          <IconDownload size={14} stroke={1.9} color="var(--text-hi)" />
          <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1, whiteSpace: "nowrap" }}>
            {model.size_label}
          </span>
        </div>

        <div
          title={t("models.stat.languagesTitle", { value: languageValueLabel })}
          aria-label={t("models.stat.languagesTitle", { value: languageValueLabel })}
          style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
        >
          <IconGlobe size={14} stroke={1.9} color="var(--text-hi)" />
          <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1, whiteSpace: "nowrap" }}>
            {languageValueLabel}
          </span>
        </div>

        {stats.map(({ key, title, Icon, value }) => (
          <div
            key={key}
            title={title}
            aria-label={title}
            style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
          >
            <Icon size={14} stroke={1.9} color="var(--text-hi)" />
            <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1, whiteSpace: "nowrap" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)", marginBottom: 4 }}>
          {t("localLlm.title")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
          {t("localLlm.desc")}
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--error-bright)",
            border: "1px solid var(--danger-border)",
          }}
        >
          {error}
        </div>
      )}

      {!usingLocalEndpoint && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 12,
            lineHeight: 1.55,
            padding: "9px 11px",
            borderRadius: 8,
            background: "var(--control-muted)",
            color: "var(--text-hi)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <IconAlertCircle size={15} stroke={2} style={{ flexShrink: 0, marginTop: 1, color: "var(--accent)" }} />
          <span>{t("localLlm.required")}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {models.map((model) => {
          const prog = progress[model.id];
          const isDownloading =
            prog?.status === "downloading" || prog?.status === "starting";
          const isBusy = busy === model.id;
          const isDeleting = deleting === model.id;
          const isSelected = selectedModelId === model.id && usingLocalEndpoint;
          // Collapsed by default like the recognition cards; force-open while a
          // download runs so its progress bar stays visible.
          const open = expandedId === model.id || isDownloading;

          const statusLabel = isDeleting
            ? t("localLlm.status.deleting")
            : isDownloading
              ? t("localLlm.status.downloading")
              : isSelected
                ? t("localLlm.status.selected")
                : model.downloaded
                  ? t("localLlm.status.ready")
                  : t("localLlm.status.notDownloaded");
          const statusColor = isSelected
            ? "var(--success-bright)"
            : model.downloaded
              ? "var(--success-bright)"
              : isDownloading || isDeleting
                ? "var(--text-hi)"
                : "var(--text-low)";

          return (
            <div
              key={model.id}
              className="card"
              style={{ padding: 0, overflow: "hidden", position: "relative", background: "var(--surface)" }}
            >
              <div
                style={{ position: "relative", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, textAlign: "left", fontFamily: "var(--font-main)" }}
              >
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--text-hi)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {model.label}
                      </div>
                      {model.recommended && (
                        <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-hi)", padding: "3px 7px", borderRadius: 999, background: "var(--control-muted)", flexShrink: 0 }}>
                          {t("models.local.recommendedBadge")}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: statusColor,
                        padding: "5px 9px",
                        borderRadius: 999,
                        background: "var(--control-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {statusLabel}
                    </div>
                  </div>
                  <div style={{ paddingRight: 34 }}>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text-mid)" }}>
                      {model.description}
                    </div>
                    {renderLocalLlmStats(model)}
                  </div>
                  <ModelCardDisclosureButton
                    expanded={open}
                    onToggle={() => setExpandedId(expandedId === model.id ? null : model.id)}
                    label={t(open ? "mainTab.collapse" : "mainTab.expand")}
                  />
                </div>
              </div>

              {open && (
              <div
                style={{
                  borderTop: "1px solid var(--border-subtle)",
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {isDownloading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12,
                        color: "var(--text-mid)",
                        fontWeight: 650,
                      }}
                    >
                      <span>{t("localLlm.downloadingModel")}</span>
                      <span style={{ color: "var(--text-hi)" }}>
                        {prog?.percent != null ? `${prog.percent}%` : t("localLlm.preparing")}
                      </span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 8,
                        borderRadius: 999,
                        background: "var(--progress-track)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${prog?.percent ?? 2}%`,
                          minWidth: prog?.percent == null ? 18 : 0,
                          height: "100%",
                          borderRadius: 999,
                          background: "var(--accent)",
                          transition: "width 0.2s ease",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginLeft: "auto",
                    }}
                  >
                    {!model.downloaded ? (
                      isDownloading ? (
                        <button
                          onClick={() => void cancelDownload(model)}
                          style={{
                            ...ACTION_BUTTON_BASE,
                            background: "var(--control-muted)",
                            color: "var(--text-hi)",
                          }}
                        >
                          <IconX size={14} stroke={2.2} />
                          {t("localLlm.cancel")}
                        </button>
                      ) : (
                        <button
                          onClick={() => void download(model)}
                          style={{
                            ...ACTION_BUTTON_BASE,
                            background: "var(--accent)",
                            color: "var(--accent-contrast)",
                          }}
                        >
                          <IconDownload size={14} stroke={2.2} />
                          {t("localLlm.download")}
                        </button>
                      )
                    ) : (
                      <>
                        {!isSelected && (
                          <button
                            onClick={() => void useForSummary(model)}
                            disabled={isBusy}
                            style={{
                              ...ACTION_BUTTON_BASE,
                              background: "var(--control-muted)",
                              color: "var(--text-hi)",
                              opacity: isBusy ? 0.7 : 1,
                            }}
                          >
                            {isBusy ? (
                              <IconLoader2
                                size={14}
                                stroke={2.2}
                                style={{ animation: "spin 1s linear infinite" }}
                              />
                            ) : (
                              <IconCheck size={14} stroke={2.5} />
                            )}
                            {t("localLlm.select")}
                          </button>
                        )}
                        <button
                          onClick={() => void remove(model)}
                          disabled={isBusy}
                          style={{
                            ...ACTION_BUTTON_BASE,
                            background: "var(--control-muted)",
                            color: "var(--text-hi)",
                          }}
                        >
                          <IconTrash size={14} stroke={2.2} />
                          {t("localLlm.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
