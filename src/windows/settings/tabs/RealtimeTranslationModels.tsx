import { useRef, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";

import { Dropdown } from "../../../components/Dropdown";
import { ModelCardDisclosureButton } from "../../../components/ModelCardDisclosureButton";
import { IconBolt, IconBroadcast, IconCheck } from "../../../lib/icons";
import { useI18n } from "../../../lib/i18n";
import {
  REALTIME_TRANSLATION_ADAPTERS,
  hasVerifiedRealtimeCapability,
  realtimeConfigurationFingerprint,
  type RealtimeTranslationAdapterId,
} from "../../../lib/realtimeModels";
import type { ApiAdapterSettings, AppSettings } from "../../../lib/store";

const CUSTOM_MODEL = "__custom_model__";
type TestStatus = "idle" | "testing" | "success" | "error";

export function RealtimeTranslationModels({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}): ReactElement {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<RealtimeTranslationAdapterId | null>(null);
  const [statuses, setStatuses] = useState<
    Partial<Record<RealtimeTranslationAdapterId, { status: TestStatus; message?: string }>>
  >({});
  const [dirtyAdapters, setDirtyAdapters] = useState<
    Partial<Record<RealtimeTranslationAdapterId, boolean>>
  >({});
  const editRevisionsRef = useRef<
    Partial<Record<RealtimeTranslationAdapterId, number>>
  >({});

  const patchAdapter = (
    id: RealtimeTranslationAdapterId,
    patch: Partial<ApiAdapterSettings>,
  ): void => {
    editRevisionsRef.current[id] = (editRevisionsRef.current[id] || 0) + 1;
    const catalogAdapter = REALTIME_TRANSLATION_ADAPTERS.find(
      (adapter) => adapter.id === id,
    );
    update({
      translationAdapters: {
        ...settings.translationAdapters,
        [id]: {
          ...(settings.translationAdapters[id] || {
            apiKey: "",
            model: catalogAdapter?.recommendedModel || "",
            endpoint: "",
          }),
          ...patch,
          connectionStatus: "saved",
          streamingCapability: undefined,
          streamingCapabilityFingerprint: undefined,
        },
      },
    });
    setDirtyAdapters((current) => ({ ...current, [id]: true }));
    setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
  };

  const test = async (id: RealtimeTranslationAdapterId): Promise<void> => {
    const adapter = REALTIME_TRANSLATION_ADAPTERS.find((item) => item.id === id);
    const values = settings.translationAdapters[id];
    if (!adapter || !values?.apiKey.trim() || !values.model.trim()) {
      setStatuses((current) => ({
        ...current,
        [id]: { status: "error", message: t("models.test.needKeyAndModel") },
      }));
      return;
    }

    const testedRevision = editRevisionsRef.current[id] || 0;
    setStatuses((current) => ({ ...current, [id]: { status: "testing" } }));
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "test_realtime_connection",
        {
          req: {
            provider: id,
            apiKey: values.apiKey,
            model: values.model,
            endpoint: values.endpoint || adapter.defaultEndpoint,
            targetLanguage: settings.translation.liveTargetLanguage,
            purpose: "translation",
          },
        },
      );
      if (!result.success) throw new Error(result.message);
      if ((editRevisionsRef.current[id] || 0) !== testedRevision) {
        setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
        return;
      }

      const fingerprint = realtimeConfigurationFingerprint({
        provider: id,
        apiKey: values.apiKey,
        model: values.model,
        endpoint: values.endpoint,
        defaultEndpoint: adapter.defaultEndpoint,
      });
      update({
        translationAdapters: {
          ...settings.translationAdapters,
          [id]: {
            ...values,
            connectionStatus: "verified",
            lastConnectedAt: new Date().toISOString(),
            streamingCapability: "supported",
            streamingCapabilityFingerprint: fingerprint,
          },
        },
        selectedTranslationAdapter: id,
      });
      setDirtyAdapters((current) => ({ ...current, [id]: false }));
      setStatuses((current) => ({ ...current, [id]: { status: "success" } }));
    } catch (error) {
      if ((editRevisionsRef.current[id] || 0) !== testedRevision) {
        setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
        return;
      }
      setStatuses((current) => ({
        ...current,
        [id]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
          {t("models.translation.title")}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.55, color: "var(--text-mid)" }}>
          {t("models.translation.desc")}
        </div>
      </div>
      {REALTIME_TRANSLATION_ADAPTERS.map((adapter) => {
        const id = adapter.id as RealtimeTranslationAdapterId;
        const values = settings.translationAdapters[id] || {
          apiKey: "",
          model: adapter.recommendedModel,
          endpoint: "",
        };
        const verified =
          !dirtyAdapters[id] && hasVerifiedRealtimeCapability(adapter, values);
        const isSelected =
          settings.selectedTranslationAdapter === id && verified;
        const status = statuses[id]?.status || (verified ? "success" : "idle");
        const isExpanded = expanded === id;
        const knownModel = adapter.models.some((model) => model.id === values.model);
        const selectValue = knownModel ? values.model : CUSTOM_MODEL;
        const statusLabel = isSelected
          ? t("models.adapterStatus.selected")
          : status === "testing"
            ? t("models.adapterStatus.testing")
            : status === "success"
              ? t("models.adapterStatus.ready")
              : status === "error"
                ? t("models.adapterStatus.error")
                : t("models.adapterStatus.readyToTest");

        return (
          <div
            key={id}
            className="card"
            style={{
              padding: 0,
              overflow: isExpanded ? "visible" : "hidden",
              position: "relative",
              zIndex: isExpanded ? 10 : 0,
              background: "var(--surface)",
            }}
          >
            <div
              style={{
                position: "relative",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                fontFamily: "var(--font-main)",
              }}
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
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
                    {adapter.name}
                  </div>
                  <div
                    title={statuses[id]?.message}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color:
                        isSelected || status === "success"
                          ? "var(--success-bright)"
                          : status === "error"
                            ? "var(--error-bright)"
                            : "var(--text-low)",
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
                    {t("models.translation.desc")} {t("models.adapter.recommendedModel", { model: adapter.recommendedModel })}
                  </div>
                  {verified && (
                    <div
                      title={t("models.stat.streaming")}
                      aria-label={t("models.stat.streaming")}
                      style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9 }}
                    >
                      <IconBroadcast size={14} stroke={1.9} color="var(--text-hi)" />
                      <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text-hi)", lineHeight: 1, whiteSpace: "nowrap" }}>
                        {t("models.stat.streaming")}
                      </span>
                    </div>
                  )}
                </div>
                <ModelCardDisclosureButton
                  expanded={isExpanded}
                  onToggle={() => setExpanded(isExpanded ? null : id)}
                  label={t(isExpanded ? "mainTab.collapse" : "mainTab.expand")}
                />
              </div>
            </div>
            {isExpanded && (
              <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label className="label" htmlFor={`translation-${id}-key`} style={{ width: 76, flexShrink: 0 }}>
                    {t("models.field.apiKey")}
                  </label>
                  <input
                    id={`translation-${id}-key`}
                    type="password"
                    className="input"
                    value={values.apiKey}
                    placeholder="API key"
                    onChange={(event) => patchAdapter(id, { apiKey: event.currentTarget.value })}
                    style={{ flex: 1, minWidth: 0, height: 36, padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="label" style={{ width: 76, flexShrink: 0 }}>
                    {t("models.field.model")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                    <Dropdown
                      value={selectValue}
                      options={[
                        ...adapter.models.map((model) => ({
                          value: model.id,
                          label: `${model.id} · ${t("models.stat.streaming")}`,
                        })),
                        { value: CUSTOM_MODEL, label: t("models.field.customModel") },
                      ]}
                      onChange={(value) => patchAdapter(id, { model: value === CUSTOM_MODEL ? "" : value })}
                    />
                    {selectValue === CUSTOM_MODEL && (
                      <input
                        type="text"
                        className="input"
                        value={values.model}
                        aria-label={t("models.field.customModelPlaceholder")}
                        placeholder={t("models.field.customModelPlaceholder")}
                        onChange={(event) => patchAdapter(id, { model: event.currentTarget.value })}
                        style={{ width: "100%", height: 36, padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-low)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {t("models.field.recommended", { model: adapter.recommendedModel })}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label className="label" htmlFor={`translation-${id}-host`} style={{ width: 76, flexShrink: 0 }}>
                    {t("models.field.host")}
                  </label>
                  <input
                    id={`translation-${id}-host`}
                    type="url"
                    className="input"
                    value={values.endpoint || ""}
                    placeholder={t("models.field.hostDefaultPlaceholder", { endpoint: adapter.defaultEndpoint })}
                    onChange={(event) => patchAdapter(id, { endpoint: event.currentTarget.value })}
                    style={{ flex: 1, minWidth: 0, height: 36, padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}
                  />
                  {values.endpoint?.trim() ? (
                    <button
                      type="button"
                      onClick={() => patchAdapter(id, { endpoint: "" })}
                      style={{ border: "1px solid var(--border-dashed)", background: "var(--control-muted)", color: "var(--text-hi)", borderRadius: 8, padding: "7px 9px", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-main)", whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
                    >
                      {t("models.common.reset")}
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--text-low)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {t("models.common.optional")}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  {isSelected ? (
                    <div style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--success-border)", background: "var(--success-soft)", color: "var(--success-bright)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                      <IconCheck size={14} stroke={2.5} />
                      {t("models.common.selected")}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={status === "testing" || !values.apiKey.trim() || !values.model.trim()}
                      onClick={() => void test(id)}
                      style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border-dashed)", background: status === "testing" || !values.apiKey.trim() || !values.model.trim() ? "var(--control-muted)" : "var(--accent)", color: status === "testing" || !values.apiKey.trim() || !values.model.trim() ? "var(--text-mid)" : "var(--accent-contrast)", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-main)", cursor: status === "testing" ? "wait" : !values.apiKey.trim() || !values.model.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
                    >
                      {status === "testing" ? <span className="loading-soft-ring" /> : <IconBolt size={14} stroke={2.2} />}
                      {status === "testing" ? t("models.test.checking") : t("models.test.testAndSave")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
