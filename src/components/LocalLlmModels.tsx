import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, HardDrive, Loader2, MemoryStick, Trash2, X } from "lucide-react";

import { AppSettings } from "../lib/store";
import qwenAvatar from "../assets/adapters/qwen.png";

interface LocalLlmModel {
  id: string;
  label: string;
  file_name: string;
  size_label: string;
  min_ram_gb: number;
  downloaded: boolean;
}

interface LocalLlmStatus {
  running: boolean;
  model_id: string | null;
  base_url: string | null;
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
  const [models, setModels] = useState<LocalLlmModel[]>([]);
  const [status, setStatus] = useState<LocalLlmStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const [list, runtime] = await Promise.all([
        invoke<LocalLlmModel[]>("list_local_llm_models"),
        invoke<LocalLlmStatus>("get_local_llm_status"),
      ]);
      setModels(list);
      setStatus(runtime);
    } catch {
      /* keep last known state */
    }
  };

  useEffect(() => {
    void refresh();
    const unlisten = listen<DownloadProgress>(
      "local-llm-model-download-progress",
      (event) => {
        setProgress((prev) => ({ ...prev, [event.payload.model_id]: event.payload }));
        if (event.payload.status === "downloaded") {
          void refresh();
        }
      },
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const download = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setError(null);
    try {
      await invoke("download_local_llm_model", { modelId: model.id });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("отменена")) {
        setError(message);
      }
      await refresh();
    } finally {
      setBusy(null);
    }
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
    setError(null);
    try {
      await invoke("delete_local_llm_model", { modelId: model.id });
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
    }
  };

  const useForSummary = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setError(null);
    try {
      const baseUrl = await invoke<string>("start_local_llm", { modelId: model.id });
      update({ llmEndpoint: baseUrl, llmModel: model.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const activeModelId = status?.running ? status.model_id : null;
  const usingLocalEndpoint = Boolean(
    settings.llmEndpoint?.trim().includes("127.0.0.1"),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)", marginBottom: 4 }}>
          Текстовые модели
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
          Скачайте локальную модель и используйте ее для summary без облака.
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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {models.map((model) => {
          const prog = progress[model.id];
          const isBusy = busy === model.id;
          const isDownloading =
            isBusy && (!prog || prog.status === "downloading" || prog.status === "starting");
          const isActive = activeModelId === model.id && usingLocalEndpoint;

          const statusLabel = isActive
            ? "Активна"
            : model.downloaded
              ? "Скачана"
              : isDownloading
                ? "Загрузка"
                : "Не скачана";
          const statusColor = isActive
            ? "var(--success)"
            : model.downloaded
              ? "var(--text-hi)"
              : "var(--text-low)";

          return (
            <div
              key={model.id}
              className="card"
              style={{ padding: 0, overflow: "hidden", background: "var(--surface)" }}
            >
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: "var(--icon-soft-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={qwenAvatar}
                    alt=""
                    aria-hidden="true"
                    style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 3,
                    }}
                  >
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      marginTop: 7,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      title={`Размер на диске: ${model.size_label}`}
                      aria-label={`Размер на диске: ${model.size_label}`}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <HardDrive size={14} strokeWidth={1.9} color="var(--text-hi)" />
                      <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1 }}>
                        {model.size_label}
                      </span>
                    </div>
                    <div
                      title={`Требуется ОЗУ: от ${model.min_ram_gb} ГБ`}
                      aria-label={`Требуется ОЗУ: от ${model.min_ram_gb} ГБ`}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <MemoryStick size={14} strokeWidth={1.9} color="var(--text-hi)" />
                      <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1 }}>
                        ≥ {model.min_ram_gb} ГБ
                      </span>
                    </div>
                  </div>
                </div>
              </div>

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
                      <span>Загрузка модели</span>
                      <span style={{ color: "var(--text-hi)" }}>
                        {prog?.percent != null ? `${prog.percent}%` : "Подготовка"}
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
                    gap: 8,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  {!model.downloaded ? (
                    <>
                      <button
                        onClick={() => void download(model)}
                        disabled={isBusy}
                        style={{
                          ...ACTION_BUTTON_BASE,
                          background: "var(--accent)",
                          color: "var(--accent-contrast)",
                          opacity: isBusy && !isDownloading ? 0.6 : 1,
                        }}
                      >
                        {isDownloading ? (
                          <Loader2
                            size={14}
                            strokeWidth={2.2}
                            style={{ animation: "spin 1s linear infinite" }}
                          />
                        ) : (
                          <Download size={14} strokeWidth={2.2} />
                        )}
                        {isDownloading
                          ? `Загрузка${prog?.percent != null ? ` ${prog.percent}%` : ""}`
                          : "Скачать"}
                      </button>
                      {isDownloading && (
                        <button
                          onClick={() => void cancelDownload(model)}
                          style={{
                            ...ACTION_BUTTON_BASE,
                            background: "var(--control-muted)",
                            color: "var(--text-hi)",
                          }}
                        >
                          <X size={14} strokeWidth={2.2} />
                          Отмена
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => void useForSummary(model)}
                        disabled={isBusy}
                        style={{
                          ...ACTION_BUTTON_BASE,
                          background: isActive ? "var(--control-muted)" : "var(--accent)",
                          color: isActive ? "var(--text-hi)" : "var(--accent-contrast)",
                          opacity: isBusy ? 0.7 : 1,
                        }}
                      >
                        {isBusy ? (
                          <Loader2
                            size={14}
                            strokeWidth={2.2}
                            style={{ animation: "spin 1s linear infinite" }}
                          />
                        ) : (
                          <Check size={14} strokeWidth={2.4} />
                        )}
                        {isActive ? "Используется" : "Для summary"}
                      </button>
                      <button
                        onClick={() => void remove(model)}
                        disabled={isBusy}
                        style={{
                          ...ACTION_BUTTON_BASE,
                          background: "var(--control-muted)",
                          color: "var(--danger)",
                        }}
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                        Удалить
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
