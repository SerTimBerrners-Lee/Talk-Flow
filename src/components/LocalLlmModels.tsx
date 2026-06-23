import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, Loader2, Play, Sparkles, Trash2 } from "lucide-react";

import { AppSettings } from "../lib/store";

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

/**
 * Local text (LLM) model slot for "Локально" mode: download a bundled GGUF
 * model and start the managed llama.cpp runtime, then point summary at it.
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
      /* ignore — keep last known state */
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
  const usingEndpoint = settings.llmEndpoint?.trim();

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles size={16} strokeWidth={1.9} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
          Текстовая модель (для summary)
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-mid)", lineHeight: 1.6 }}>
        Встроенная локальная модель для пересказа разговоров — без облака. Скачайте
        и запустите её, чтобы summary работало офлайн.
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {models.map((model) => {
        const isBusy = busy === model.id;
        const prog = progress[model.id];
        const isDownloading =
          isBusy && (!prog || prog.status === "downloading" || prog.status === "starting");
        const isActive =
          activeModelId === model.id &&
          Boolean(usingEndpoint && usingEndpoint.includes("127.0.0.1"));

        return (
          <div
            key={model.id}
            className="card"
            style={{
              padding: 14,
              display: "grid",
              gap: 8,
              border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 650, color: "var(--text-hi)" }}>
                    {model.label}
                  </span>
                  {isActive && (
                    <span className="label" style={{ color: "var(--accent)" }}>
                      Активна
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "var(--text-low)" }}>
                  {model.size_label} · ОЗУ ≥ {model.min_ram_gb} ГБ
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!model.downloaded ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void download(model)}
                    disabled={isBusy}
                    style={{ minHeight: 34, padding: "0 14px" }}
                  >
                    {isDownloading ? (
                      <Loader2
                        size={14}
                        strokeWidth={2.2}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                    ) : (
                      <Download size={14} strokeWidth={2} />
                    )}
                    {isDownloading
                      ? `Загрузка${prog?.percent != null ? ` ${prog.percent}%` : "…"}`
                      : "Скачать"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void useForSummary(model)}
                      disabled={isBusy}
                      style={{ minHeight: 34, padding: "0 14px" }}
                    >
                      {isBusy ? (
                        <Loader2
                          size={14}
                          strokeWidth={2.2}
                          style={{ animation: "spin 1s linear infinite" }}
                        />
                      ) : isActive ? (
                        <Check size={14} strokeWidth={2.2} />
                      ) : (
                        <Play size={14} strokeWidth={2} />
                      )}
                      {isActive ? "Используется" : "Для summary"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      title="Удалить модель"
                      onClick={() => void remove(model)}
                      disabled={isBusy}
                      style={{ width: 34, minWidth: 34, minHeight: 34, padding: 0 }}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {isDownloading && prog?.percent != null && (
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "var(--control-track)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${prog.percent}%`,
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 0.2s",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
