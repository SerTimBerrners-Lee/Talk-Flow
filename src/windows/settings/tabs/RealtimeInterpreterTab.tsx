import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  IconAlertTriangle,
  IconHeadphones,
  IconLanguage,
  IconMicrophone,
  IconPlayerPlay,
  IconBroadcast,
  IconRefresh,
  IconSpeakerphone,
  IconSquare,
  IconVolume,
} from "../../../lib/icons";

import {
  addHistoryEntry,
  AppSettings,
  getSettings,
  HistoryEntry,
  RealtimeInterpreterSettings,
  RealtimeTranslationSegment,
  saveSettings,
} from "../../../lib/store";
import {
  HISTORY_UPDATED_EVENT,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { logError } from "../../../lib/logger";
import { useI18n, type TFunc } from "../../../lib/i18n";
import {
  getRealtimeInterpreterStatus,
  listRealtimeAudioDevices,
  REALTIME_INTERPRETER_AUDIO_LEVEL_EVENT,
  REALTIME_INTERPRETER_ERROR_EVENT,
  REALTIME_INTERPRETER_PARTIAL_TEXT_EVENT,
  REALTIME_INTERPRETER_STATUS_EVENT,
  REALTIME_LANGUAGE_PAIRS,
  REALTIME_TRANSLATE_ENDPOINT,
  REALTIME_TRANSLATE_MODEL,
  RealtimeAudioDevice,
  RealtimeAudioDevices,
  RealtimeInterpreterAudioLevelEvent,
  RealtimeInterpreterErrorEvent,
  RealtimeInterpreterPartialTextEvent,
  RealtimeInterpreterStatus,
  realtimeLanguagePairDefinition,
  startRealtimeInterpreter,
  stopRealtimeInterpreter,
  testVirtualMicOutput,
} from "../../../lib/realtimeInterpreter";

const CARD_STYLE: CSSProperties = {
  display: "grid",
  gap: 14,
  background: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
};

const FIELD_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  alignItems: "center",
  gap: 16,
};

const CONTROL_STYLE: CSSProperties = {
  minHeight: 38,
  height: 38,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--control-bg)",
  color: "var(--text-hi)",
  fontSize: 12,
  outline: "none",
};

interface LiveTextState {
  userToRemote: string;
  remoteToUser: string;
}

function statusLabel(status: RealtimeInterpreterStatus | null, t: TFunc): string {
  if (!status) return t("realtime.status.checking");
  if (status.state === "running") return t("realtime.status.running");
  if (status.state === "starting") return t("realtime.status.starting");
  if (status.state === "stopping") return t("realtime.status.stopping");
  if (status.state === "error") return t("realtime.status.error");
  return t("realtime.status.off");
}

function statusColor(status: RealtimeInterpreterStatus | null): string {
  if (!status) return "var(--text-low)";
  if (status.state === "running") return "var(--success-bright)";
  if (status.state === "error") return "var(--error-bright)";
  if (status.state === "starting" || status.state === "stopping") {
    return "var(--text-hi)";
  }
  return "var(--text-low)";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deviceStillExists(
  devices: RealtimeAudioDevice[],
  deviceId: string,
): boolean {
  return devices.some((device) => device.id === deviceId);
}

function preferredPlaybackDevice(
  devices: RealtimeAudioDevice[],
): RealtimeAudioDevice | undefined {
  return (
    devices.find((device) => device.isDefault && !device.isVirtual) ||
    devices.find((device) => !device.isVirtual) ||
    devices[0]
  );
}

function SettingField({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div style={FIELD_GRID}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
          {label}
        </div>
        {note && (
          <div
            style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.5 }}
          >
            {note}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function formatDurationSeconds(startedAt?: string | null): number {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

function directionSpeakerLabel(
  direction: RealtimeTranslationSegment["direction"],
  t: TFunc,
): string {
  return direction === "user_to_remote"
    ? t("realtime.speaker.you")
    : t("realtime.speaker.remote");
}

function formatRealtimeRawTranscript(
  segments: RealtimeTranslationSegment[],
  t: TFunc,
): string {
  return segments
    .map(
      (segment) =>
        `${directionSpeakerLabel(segment.direction, t)} (${segment.sourceLanguage}): ${segment.sourceText}`,
    )
    .join("\n");
}

function formatRealtimeBilingualTranscript(
  segments: RealtimeTranslationSegment[],
  t: TFunc,
): string {
  return segments
    .map(
      (segment) =>
        `${directionSpeakerLabel(segment.direction, t)}: ${segment.sourceText}\n${t("realtime.transcript.translationLabel", { lang: segment.targetLanguage })}: ${segment.translatedText}`,
    )
    .join("\n\n");
}

function transcriptDisplayText(
  payload: RealtimeInterpreterPartialTextEvent,
): string {
  const source = payload.sourceText?.trim();
  const translated = payload.translatedText?.trim();

  if (source && translated) {
    return `${source}\n→ ${translated}`;
  }

  return translated || source || payload.text;
}

function DeviceSelect({
  value,
  onChange,
  devices,
  emptyLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  devices: RealtimeAudioDevice[];
  emptyLabel: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      disabled={disabled}
      aria-invalid={!disabled && devices.length === 0 ? true : undefined}
      style={{
        ...CONTROL_STYLE,
        width: "100%",
        opacity: disabled ? 0.72 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <option value="">{emptyLabel}</option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.label}
          {device.isDefault ? " · default" : ""}
          {device.driverHint ? ` · ${device.driverHint}` : ""}
        </option>
      ))}
    </select>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        gap: 2,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--control-muted)",
      }}
    >
      <div className="label" style={{ letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--text-hi)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LevelMeter({
  label,
  inputLevel,
  outputLevel,
}: {
  label: string;
  inputLevel: number;
  outputLevel: number;
}): ReactElement {
  const safeInput = Math.max(0, Math.min(1, inputLevel || 0));
  const safeOutput = Math.max(0, Math.min(1, outputLevel || 0));

  return (
    <div style={{ display: "grid", gap: 7 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
      >
        <span
          style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)" }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-low)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(safeInput * 100)}% / {Math.round(safeOutput * 100)}%
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--progress-track)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "1fr",
        }}
      >
        <div
          style={{
            width: `${Math.max(safeInput, safeOutput) * 100}%`,
            minWidth: safeInput || safeOutput ? 3 : 0,
            height: "100%",
            borderRadius: 999,
            background:
              safeOutput >= safeInput
                ? "var(--success-bright)"
                : "var(--text-hi)",
            transition: "width 0.12s ease",
          }}
        />
      </div>
    </div>
  );
}

export function RealtimeInterpreterTab(): ReactElement {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [devices, setDevices] = useState<RealtimeAudioDevices | null>(null);
  const [status, setStatus] = useState<RealtimeInterpreterStatus | null>(null);
  const [loadPending, setLoadPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState<LiveTextState>({
    userToRemote: "",
    remoteToUser: "",
  });
  const [finalSegments, setFinalSegments] = useState<
    RealtimeTranslationSegment[]
  >([]);

  const interpreterSettings = settings?.realtimeInterpreter;
  const hasCloudToken = Boolean(settings?.deviceToken);
  const languagePair = interpreterSettings?.languagePair || "ru_en";
  const pairDefinition = realtimeLanguagePairDefinition(languagePair);
  const selectedVirtualOutput = devices?.virtualMicOutputs.find(
    (device) => device.id === interpreterSettings?.virtualMicOutputDeviceId,
  );
  const selectedPlayback = devices?.localPlaybackOutputs.find(
    (device) => device.id === interpreterSettings?.localPlaybackDeviceId,
  );

  const loadState = async (): Promise<void> => {
    setLoadPending(true);
    setError(null);
    try {
      const [nextSettings, nextDevices, nextStatus] = await Promise.all([
        getSettings({ reload: true }),
        listRealtimeAudioDevices(),
        getRealtimeInterpreterStatus(),
      ]);
      setSettings(nextSettings);
      setDevices(nextDevices);
      setStatus(nextStatus);
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      void logError("REALTIME_INTERPRETER", `Failed to load state: ${message}`);
    } finally {
      setLoadPending(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  useEffect(() => {
    const statusListener = listen<RealtimeInterpreterStatus>(
      REALTIME_INTERPRETER_STATUS_EVENT,
      ({ payload }) => {
        setStatus(payload);
        if (payload.lastError) {
          setError(payload.lastError);
        }
      },
    );
    const errorListener = listen<RealtimeInterpreterErrorEvent>(
      REALTIME_INTERPRETER_ERROR_EVENT,
      ({ payload }) => {
        setError(payload.message);
      },
    );
    const levelListener = listen<RealtimeInterpreterAudioLevelEvent>(
      REALTIME_INTERPRETER_AUDIO_LEVEL_EVENT,
      ({ payload }) => {
        setStatus((current) => {
          if (!current) return current;
          const key =
            payload.direction === "user_to_remote"
              ? "userToRemote"
              : "remoteToUser";
          return {
            ...current,
            [key]: {
              ...current[key],
              inputLevel: payload.inputLevel,
              outputLevel: payload.outputLevel,
            },
          };
        });
      },
    );
    const textListener = listen<RealtimeInterpreterPartialTextEvent>(
      REALTIME_INTERPRETER_PARTIAL_TEXT_EVENT,
      ({ payload }) => {
        const displayText = transcriptDisplayText(payload);
        setLiveText((current) => ({
          ...current,
          [payload.direction === "user_to_remote"
            ? "userToRemote"
            : "remoteToUser"]: displayText,
        }));
        if (!payload.isFinal) return;

        const sourceText = payload.sourceText?.trim() || "";
        const translatedText =
          payload.translatedText?.trim() || payload.text.trim();
        if (!sourceText && !translatedText) return;

        setFinalSegments((current) => [
          ...current,
          {
            direction: payload.direction,
            startMs: payload.startMs ?? undefined,
            endMs: payload.endMs ?? undefined,
            sourceText,
            translatedText,
            sourceLanguage:
              payload.sourceLanguage ||
              (payload.direction === "user_to_remote"
                ? pairDefinition.userSourceLanguage
                : pairDefinition.remoteSourceLanguage),
            targetLanguage:
              payload.targetLanguage ||
              (payload.direction === "user_to_remote"
                ? pairDefinition.userTargetLanguage
                : pairDefinition.remoteTargetLanguage),
          },
        ]);
      },
    );

    return () => {
      void statusListener.then((unlisten) => unlisten());
      void errorListener.then((unlisten) => unlisten());
      void levelListener.then((unlisten) => unlisten());
      void textListener.then((unlisten) => unlisten());
    };
  }, [pairDefinition]);

  useEffect(() => {
    if (!settings || !devices) return;

    const current = settings.realtimeInterpreter;
    const patch: Partial<RealtimeInterpreterSettings> = {};
    const setPatch = <Key extends keyof RealtimeInterpreterSettings>(
      key: Key,
      value: RealtimeInterpreterSettings[Key],
    ): void => {
      if (current[key] !== value) {
        patch[key] = value;
      }
    };

    if (
      current.realMicDeviceId &&
      !deviceStillExists(devices.realMics, current.realMicDeviceId)
    ) {
      setPatch("realMicDeviceId", "");
    }

    const virtualOutputExists = deviceStillExists(
      devices.virtualMicOutputs,
      current.virtualMicOutputDeviceId,
    );
    if (!current.virtualMicOutputDeviceId || !virtualOutputExists) {
      setPatch(
        "virtualMicOutputDeviceId",
        devices.virtualMicOutputs[0]?.id || "",
      );
    }

    const playbackExists = deviceStillExists(
      devices.localPlaybackOutputs,
      current.localPlaybackDeviceId,
    );
    if (!current.localPlaybackDeviceId || !playbackExists) {
      const preferred = preferredPlaybackDevice(devices.localPlaybackOutputs);
      setPatch("localPlaybackDeviceId", preferred?.id || "");
    }

    if (current.apiMode !== "cloud") {
      setPatch("apiMode", "cloud");
    }

    if (Object.keys(patch).length === 0) return;

    void updateInterpreterSettings(patch);
  }, [devices, settings?.deviceToken, settings?.realtimeInterpreter]);

  const updateInterpreterSettings = async (
    patch: Partial<RealtimeInterpreterSettings>,
  ): Promise<void> => {
    if (!settings) return;

    const nextRealtimeSettings: RealtimeInterpreterSettings = {
      ...settings.realtimeInterpreter,
      ...patch,
    };
    const nextSettings = {
      ...settings,
      realtimeInterpreter: nextRealtimeSettings,
    };
    setSettings(nextSettings);

    try {
      await saveSettings({ realtimeInterpreter: nextRealtimeSettings });
      await emit(SETTINGS_UPDATED_EVENT).catch(() => {});
    } catch (saveError) {
      const message = errorMessage(saveError);
      setError(message);
      void logError(
        "REALTIME_INTERPRETER",
        `Failed to save settings: ${message}`,
      );
    }
  };

  const warnings = useMemo(() => {
    const result = [...(devices?.warnings || [])];
    if (!hasCloudToken) {
      result.push(t("realtime.warning.needLogin"));
    }
    if (!interpreterSettings?.headphonesConfirmed) {
      result.push(t("realtime.warning.needHeadphones"));
    }
    return result;
  }, [devices?.warnings, hasCloudToken, interpreterSettings, t]);

  const canStart = Boolean(
    interpreterSettings &&
    selectedVirtualOutput &&
    interpreterSettings.headphonesConfirmed &&
    hasCloudToken,
  );

  const handleStart = async (): Promise<void> => {
    if (!settings || !interpreterSettings) return;

    setActionPending(true);
    setError(null);
    setTestMessage(null);
    setFinalSegments([]);
    setLiveText({
      userToRemote: "",
      remoteToUser: "",
    });
    try {
      const nextStatus = await startRealtimeInterpreter({
        realMicDeviceId: interpreterSettings.realMicDeviceId || null,
        virtualMicOutputDeviceId: interpreterSettings.virtualMicOutputDeviceId,
        localPlaybackDeviceId:
          interpreterSettings.localPlaybackDeviceId || null,
        languagePair: interpreterSettings.languagePair,
        apiMode: "cloud",
        deviceToken: settings.deviceToken,
        model: REALTIME_TRANSLATE_MODEL,
        endpoint: REALTIME_TRANSLATE_ENDPOINT,
        headphonesConfirmed: interpreterSettings.headphonesConfirmed,
      });
      setStatus(nextStatus);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setActionPending(false);
    }
  };

  const saveRealtimeTranslationHistory = async (
    sessionStatus: RealtimeInterpreterStatus | null,
  ): Promise<void> => {
    if (!sessionStatus?.sessionId || finalSegments.length === 0) return;

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      duration: formatDurationSeconds(sessionStatus.startedAt),
      raw: formatRealtimeRawTranscript(finalSegments, t),
      cleaned: formatRealtimeBilingualTranscript(finalSegments, t),
      source: "call",
      fileName: t("realtime.history.fileName"),
      callSessionId: sessionStatus.sessionId,
      status: "completed",
      translation: {
        provider: "talkis-cloud",
        model: sessionStatus.model || REALTIME_TRANSLATE_MODEL,
        languagePair: sessionStatus.languagePair,
        segments: finalSegments,
      },
    };

    await addHistoryEntry(entry);
    await emit(HISTORY_UPDATED_EVENT, entry);
  };

  const handleStop = async (): Promise<void> => {
    const sessionStatus = status;
    setActionPending(true);
    setError(null);
    try {
      const nextStatus = await stopRealtimeInterpreter();
      await saveRealtimeTranslationHistory(sessionStatus);
      setStatus(nextStatus);
      setFinalSegments([]);
    } catch (stopError) {
      setError(errorMessage(stopError));
    } finally {
      setActionPending(false);
    }
  };

  const handleTestOutput = async (): Promise<void> => {
    if (!interpreterSettings?.virtualMicOutputDeviceId) return;

    setActionPending(true);
    setError(null);
    setTestMessage(null);
    try {
      await testVirtualMicOutput(interpreterSettings.virtualMicOutputDeviceId);
      setTestMessage(t("realtime.test.signalSent"));
    } catch (testError) {
      setError(errorMessage(testError));
    } finally {
      setActionPending(false);
    }
  };

  if (!settings || !interpreterSettings) {
    return (
      <div className="card" style={CARD_STYLE}>
        <div style={{ fontSize: 14, color: "var(--text-mid)" }}>
          {t("realtime.loading")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={CARD_STYLE}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <div
              className="label"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <IconLanguage size={14} stroke={2} />
              Beta
            </div>
            <div
              style={{
                fontFamily: "var(--font-accent)",
                fontSize: 28,
                lineHeight: 1.05,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                color: "var(--text-hi)",
              }}
            >
              {t("realtime.title")}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(120px, 1fr))",
              gap: 8,
              minWidth: 390,
              maxWidth: "100%",
            }}
          >
            <Metric label={t("realtime.metric.status")} value={statusLabel(status, t)} />
            <Metric label={t("realtime.metric.languages")} value={pairDefinition.label} />
            <Metric label={t("realtime.metric.route")} value="Talkis IconCloud" />
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: statusColor(status),
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <IconBroadcast size={14} stroke={2.2} />
          {status?.message || t("realtime.statusMessage.off")}
        </div>
      </div>

      <div className="card" style={CARD_STYLE}>
        <SettingField
          label={t("realtime.field.realMic.label")}
          note={t("realtime.field.realMic.note", { lang: pairDefinition.userTargetLanguage })}
        >
          <DeviceSelect
            value={interpreterSettings.realMicDeviceId}
            onChange={(value) => {
              void updateInterpreterSettings({ realMicDeviceId: value });
            }}
            devices={devices?.realMics || []}
            emptyLabel={t("realtime.field.realMic.empty")}
            disabled={loadPending}
          />
        </SettingField>

        <SettingField
          label={t("realtime.field.languagePair.label")}
          note={t("realtime.field.languagePair.note")}
        >
          <select
            value={interpreterSettings.languagePair}
            onChange={(event) => {
              void updateInterpreterSettings({
                languagePair: event.currentTarget
                  .value as RealtimeInterpreterSettings["languagePair"],
              });
            }}
            disabled={loadPending || status?.active}
            style={{
              ...CONTROL_STYLE,
              width: "100%",
              opacity: loadPending || status?.active ? 0.72 : 1,
              cursor: loadPending || status?.active ? "not-allowed" : "pointer",
            }}
          >
            {REALTIME_LANGUAGE_PAIRS.map((pair) => (
              <option key={pair.id} value={pair.id}>
                {pair.label}
              </option>
            ))}
          </select>
        </SettingField>

        <SettingField
          label="Virtual mic output"
          note={t("realtime.field.virtualMic.note", { driver: devices?.virtualDriverName || "Virtual driver" })}
        >
          <DeviceSelect
            value={interpreterSettings.virtualMicOutputDeviceId}
            onChange={(value) => {
              void updateInterpreterSettings({
                virtualMicOutputDeviceId: value,
              });
            }}
            devices={devices?.virtualMicOutputs || []}
            emptyLabel={t("realtime.field.virtualMic.empty", { driver: devices?.virtualDriverName || "virtual driver" })}
            disabled={
              loadPending || (devices?.virtualMicOutputs.length || 0) === 0
            }
          />
        </SettingField>

        <SettingField
          label={t("realtime.field.localPlayback.label")}
          note={t("realtime.field.localPlayback.note")}
        >
          <DeviceSelect
            value={interpreterSettings.localPlaybackDeviceId}
            onChange={(value) => {
              void updateInterpreterSettings({ localPlaybackDeviceId: value });
            }}
            devices={devices?.localPlaybackOutputs || []}
            emptyLabel={t("realtime.field.localPlayback.empty")}
            disabled={loadPending}
          />
        </SettingField>

        <SettingField
          label={t("realtime.field.access.label")}
          note={t("realtime.field.access.note")}
        >
          <div
            style={{
              ...CONTROL_STYLE,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              width: "100%",
              background: "var(--control-muted)",
            }}
          >
            <span style={{ fontWeight: 700 }}>IconCloud proxy</span>
            <span
              style={{
                color: hasCloudToken
                  ? "var(--success-bright)"
                  : "var(--text-low)",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {hasCloudToken ? t("realtime.access.connected") : t("realtime.access.needLogin")}
            </span>
          </div>
        </SettingField>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 40,
            cursor: "pointer",
            color: "var(--text-hi)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={interpreterSettings.headphonesConfirmed}
            onChange={(event) => {
              void updateInterpreterSettings({
                headphonesConfirmed: event.currentTarget.checked,
              });
            }}
            style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
          />
          <IconHeadphones size={16} stroke={2} />
          <span>{t("realtime.headphonesConfirm")}</span>
        </label>
      </div>

      <div className="card" style={CARD_STYLE}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IconMicrophone size={16} stroke={2} />
            <div
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}
            >
              {t("realtime.checkAndRun")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              title={t("realtime.button.refresh.title")}
              disabled={loadPending || actionPending}
              onClick={() => {
                void loadState();
              }}
              style={{ minHeight: 36, borderRadius: 10, padding: "0 12px" }}
            >
              <IconRefresh size={14} stroke={2} />
              {t("realtime.button.refresh")}
            </button>
            <button
              type="button"
              className="btn"
              title={t("realtime.button.test.title")}
              disabled={
                actionPending ||
                !interpreterSettings.virtualMicOutputDeviceId ||
                !selectedVirtualOutput
              }
              onClick={() => {
                void handleTestOutput();
              }}
              style={{ minHeight: 36, borderRadius: 10, padding: "0 12px" }}
            >
              <IconVolume size={14} stroke={2} />
              {t("realtime.button.test")}
            </button>
            {status?.active ? (
              <button
                type="button"
                className="btn btn-danger"
                title={t("realtime.button.stop.title")}
                disabled={actionPending}
                onClick={() => {
                  void handleStop();
                }}
                style={{ minHeight: 36, borderRadius: 10, padding: "0 12px" }}
              >
                <IconSquare size={13} stroke={2.4} />
                {t("realtime.button.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                title={t("realtime.button.start.title")}
                disabled={actionPending || !canStart}
                onClick={() => {
                  void handleStart();
                }}
                style={{ minHeight: 36, borderRadius: 10, padding: "0 12px" }}
              >
                <IconPlayerPlay size={13} stroke={2.4} />
                {t("realtime.button.start")}
              </button>
            )}
          </div>
        </div>

        {(warnings.length > 0 || error || testMessage) && (
          <div style={{ display: "grid", gap: 8 }}>
            {error && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger-border)",
                  color: "var(--danger)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <IconAlertTriangle
                  size={15}
                  stroke={2}
                  style={{ flexShrink: 0 }}
                />
                <span>{error}</span>
              </div>
            )}
            {testMessage && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--success-soft)",
                  border: "1px solid var(--success-border)",
                  color: "var(--success-bright)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {testMessage}
              </div>
            )}
            {warnings.map((warning) => (
              <div
                key={warning}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--control-muted)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-mid)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {warning}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={CARD_STYLE}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconSpeakerphone size={15} stroke={2} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t("realtime.panel.youToCall")}</div>
            </div>
            <LevelMeter
              label={`RU → ${pairDefinition.userTargetLanguage}`}
              inputLevel={status?.userToRemote.inputLevel || 0}
              outputLevel={status?.userToRemote.outputLevel || 0}
            />
            <div
              style={{
                minHeight: 44,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--control-muted)",
                color: liveText.userToRemote
                  ? "var(--text-hi)"
                  : "var(--text-low)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {liveText.userToRemote || t("realtime.noLiveTranscript")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconHeadphones size={15} stroke={2} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t("realtime.panel.callToYou")}</div>
            </div>
            <LevelMeter
              label={`${pairDefinition.remoteSourceLanguage} → RU`}
              inputLevel={status?.remoteToUser.inputLevel || 0}
              outputLevel={status?.remoteToUser.outputLevel || 0}
            />
            <div
              style={{
                minHeight: 44,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--control-muted)",
                color: liveText.remoteToUser
                  ? "var(--text-hi)"
                  : "var(--text-low)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {liveText.remoteToUser || t("realtime.noLiveTranscript")}
            </div>
          </div>
        </div>

        <div
          style={{ fontSize: 12, color: "var(--text-low)", lineHeight: 1.55 }}
        >
          {t("realtime.routingSummary", {
            virtualMic: selectedVirtualOutput?.label || t("realtime.routing.notSelected"),
            playback: selectedPlayback?.label || t("realtime.routing.systemOutput"),
          })}
        </div>
      </div>
    </div>
  );
}
