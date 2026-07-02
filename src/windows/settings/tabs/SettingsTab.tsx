import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconCheck, IconChevronDown, IconMail, IconDeviceDesktop, IconMoon, IconSearch, IconSun, type Icon } from "../../../lib/icons";

import {
  getSettings,
  getHistory,
  saveSettings,
  writeHistoryToDefaultStorage,
  writeHistoryToStorageDir,
  AppSettings,
  DEFAULT_HOTKEY,
  formatHotkeyLabel,
  isMacPlatform,
  normalizeHotkey,
} from "../../../lib/store";
import { applyThemePreference } from "../../../lib/theme";
import {
  formatWidgetScalePercent,
  normalizeWidgetScale,
  WIDGET_SCALE_MAX,
  WIDGET_SCALE_MIN,
  WIDGET_SCALE_STEP,
} from "../../../lib/widgetScale";
import {
  HOTKEY_CAPTURE_STATE_EVENT,
  HOTKEY_CHANGE_REQUEST_EVENT,
  HOTKEY_REGISTRATION_RESULT_EVENT,
  HotkeyRegistrationResultPayload,
  NATIVE_HOTKEY_CAPTURE_EVENT,
  NativeHotkeyCapturePayload,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { logError, logInfo } from "../../../lib/logger";
import { buildFrontendHotkeyCandidate } from "../../../lib/frontendHotkeyCapture";
import { LANGUAGES } from "../../../config/languages";
import { useI18n } from "../../../lib/i18n";

type HotkeyFeedbackTone = "idle" | "success" | "error";
type StorageFeedbackTone = "idle" | "success" | "error";

const SETTING_ROW_COLUMNS = "minmax(0, 1fr) 280px";
const SETTING_ROW_GAP = 16;
const CONTROL_HEIGHT = 38;
const CONTROL_RADIUS = 8;
const CONTROL_FONT_SIZE = 12;
const SUPPORT_EMAIL = "david.perov60@gmail.com";
const SETTINGS_CARD_STYLE = {
  display: "grid",
  gap: 10,
  background: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
} as const;
const THEME_OPTIONS: Array<{ id: AppSettings["theme"]; Icon: Icon }> = [
  { id: "system", Icon: IconDeviceDesktop },
  { id: "light", Icon: IconSun },
  { id: "dark", Icon: IconMoon },
];

export function SettingsTab() {
  const { lang, t } = useI18n();
  const usesNativeHotkeyCapture = isMacPlatform();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Language picker state
  const [langSearch, setLangSearch] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micOpen, setMicOpen] = useState(false);
  const [micStatus, setMicStatus] = useState<MicAvailabilityState>("empty");
  const [micMessage, setMicMessage] = useState(t("settingsGeneralExtra.mic.checking"));
  const micRef = useRef<HTMLDivElement>(null);

  const settingsRef = useRef<AppSettings | null>(null);
  const hotkeyButtonRef = useRef<HTMLDivElement>(null);
  const pendingHotkeyRef = useRef<string | null>(null);
  const hotkeyFeedbackResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isHotkeyCaptureActive, setIsHotkeyCaptureActive] = useState(false);
  const [isHotkeySubmitting, setIsHotkeySubmitting] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState<string | null>(null);
  const [hotkeyFeedback, setHotkeyFeedback] = useState(t("settingsGeneralExtra.hotkey.initial"));
  const [hotkeyFeedbackTone, setHotkeyFeedbackTone] = useState<HotkeyFeedbackTone>("idle");
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoaded, setAutostartLoaded] = useState(false);
  const [autostartPending, setAutostartPending] = useState(false);
  const [defaultLocalModelsDir, setDefaultLocalModelsDir] = useState("");
  const [defaultTranscriptionStorageDir, setDefaultTranscriptionStorageDir] = useState("");
  const [transcriptionStorageFeedback, setTranscriptionStorageFeedback] = useState("");
  const [transcriptionStorageFeedbackTone, setTranscriptionStorageFeedbackTone] = useState<StorageFeedbackTone>("idle");
  const [supportFeedback, setSupportFeedback] = useState("");

  type MicAvailabilityState = "ready" | "missing-selected" | "permission-needed" | "empty";

  const clearHotkeyFeedbackResetTimer = () => {
    if (!hotkeyFeedbackResetTimerRef.current) {
      return;
    }

    clearTimeout(hotkeyFeedbackResetTimerRef.current);
    hotkeyFeedbackResetTimerRef.current = null;
  };

  useEffect(() => {
    getSettings({ reload: true }).then(s => {
      setSettings(s);
      settingsRef.current = s;
    });
  }, []);

  useEffect(() => {
    invoke<string>("get_local_stt_default_models_dir")
      .then(setDefaultLocalModelsDir)
      .catch((error) => {
        void logError("SETTINGS", `Failed to load default local models directory: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);

  useEffect(() => {
    invoke<string>("get_default_transcription_storage_dir")
      .then(setDefaultTranscriptionStorageDir)
      .catch((error) => {
        void logError("SETTINGS", `Failed to load default transcription storage directory: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadAutostartState = async (): Promise<void> => {
      try {
        const enabled = await isAutostartEnabled();
        if (!mounted) return;
        setAutostartEnabled(enabled);
        setAutostartLoaded(true);
      } catch (error) {
        if (!mounted) return;
        setAutostartLoaded(true);
        void logError("SETTINGS", `Failed to load autostart state: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void loadAutostartState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unlistenHotkeyResult = listen<HotkeyRegistrationResultPayload>(
      HOTKEY_REGISTRATION_RESULT_EVENT,
      async ({ payload }) => {
        if (!pendingHotkeyRef.current || payload.requestedHotkey !== pendingHotkeyRef.current) {
          return;
        }

        pendingHotkeyRef.current = null;
        setIsHotkeySubmitting(false);
        setHotkeyDraft(null);

        if (!payload.success) {
          setHotkeyFeedbackTone("error");
          setHotkeyFeedback(payload.message || t("settingsGeneralExtra.hotkey.applyFailed"));
          return;
        }

        const latestSettings = await getSettings({ reload: true });
        settingsRef.current = latestSettings;
        setSettings(latestSettings);
        setHotkeyFeedbackTone("success");
        setHotkeyFeedback(t("settingsGeneralExtra.hotkey.saved"));
        clearHotkeyFeedbackResetTimer();
        hotkeyFeedbackResetTimerRef.current = setTimeout(() => {
          setHotkeyFeedbackTone("idle");
          setHotkeyFeedback(t("settingsGeneralExtra.hotkey.changeAgain"));
          hotkeyFeedbackResetTimerRef.current = null;
        }, 2200);
      },
    );

    const unlistenNativeHotkeyCapture = listen<NativeHotkeyCapturePayload>(
      NATIVE_HOTKEY_CAPTURE_EVENT,
      async ({ payload }) => {
        if (payload.status === "listening") {
          setIsHotkeyCaptureActive(true);
          setIsHotkeySubmitting(false);
          setHotkeyDraft(null);
          setHotkeyFeedbackTone("idle");
          setHotkeyFeedback(payload.message || t("settingsGeneralExtra.hotkey.pressNew"));
          return;
        }

        if (payload.status === "preview") {
          setHotkeyDraft(payload.hotkey || null);
          setHotkeyFeedbackTone("idle");
          setHotkeyFeedback(payload.message || t("settingsGeneralExtra.hotkey.releaseToApply"));
          return;
        }

        if (payload.status === "cancelled") {
          await invoke("stop_native_hotkey_capture").catch(() => null);
          await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
          setIsHotkeyCaptureActive(false);
          setHotkeyDraft(null);
          setHotkeyFeedbackTone("idle");
          setHotkeyFeedback(payload.message || t("settingsGeneralExtra.hotkey.inputCancelled"));
          return;
        }

        if (payload.status !== "completed") {
          return;
        }

        await invoke("stop_native_hotkey_capture").catch(() => null);
        await applyCapturedHotkey(payload.hotkey?.trim() || null);
      },
    );

    return () => {
      unlistenHotkeyResult.then((unlisten) => unlisten());
      unlistenNativeHotkeyCapture.then((unlisten) => unlisten());
      void emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
      void invoke("stop_native_hotkey_capture").catch(() => null);
      clearHotkeyFeedbackResetTimer();
    };
  }, []);

  useEffect(() => {
    if (!isHotkeyCaptureActive || usesNativeHotkeyCapture) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        void stopHotkeyCapture(t("settingsGeneralExtra.hotkey.cancelledKept"));
        return;
      }

      const candidate = buildFrontendHotkeyCandidate(event);
      if (!candidate) {
        setHotkeyDraft(null);
        setHotkeyFeedbackTone("idle");
        setHotkeyFeedback(t("settingsGeneralExtra.hotkey.needMainKey"));
        return;
      }

      const normalized = normalizeHotkey(candidate);
      setHotkeyDraft(candidate);

      if (!normalized.valid) {
        setHotkeyFeedbackTone("error");
        setHotkeyFeedback(normalized.error || t("settingsGeneralExtra.hotkey.invalid"));
        return;
      }

      void applyCapturedHotkey(normalized.normalized || candidate);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.setTimeout(() => hotkeyButtonRef.current?.focus(), 0);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isHotkeyCaptureActive, usesNativeHotkeyCapture]);

  useEffect(() => {
    if (!settings) return;

    const fetchMics = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          void logInfo("SETTINGS", "Media devices API not available");
          setMicStatus("empty");
          setMicMessage(t("settingsGeneralExtra.mic.unavailableEnv"));
          return;
        }

        let devices = await navigator.mediaDevices.enumerateDevices();
        let mics = devices.filter(d => d.kind === "audioinput");
        let needsPermission = false;

        if (mics.length === 0 || mics.some(m => !m.label || m.label === "")) {
          if (navigator.mediaDevices.getUserMedia) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              await new Promise(r => setTimeout(r, 50));
              devices = await navigator.mediaDevices.enumerateDevices();
              mics = devices.filter(d => d.kind === "audioinput");
              stream.getTracks().forEach(t => t.stop());
            } catch (permitErr) {
              void logInfo("SETTINGS", `Microphone permission denied or no mic available: ${permitErr instanceof Error ? permitErr.message : String(permitErr)}`);
              needsPermission = true;
            }
          }
        }

        const uniqueMics: MediaDeviceInfo[] = [];
        const seenIds = new Set<string>();
        for (const m of mics) {
          if (m.deviceId && !seenIds.has(m.deviceId)) {
            uniqueMics.push(m);
            seenIds.add(m.deviceId);
          }
        }

        setMicrophones(uniqueMics);

        const selectedMic = settings.micId ? uniqueMics.find(m => m.deviceId === settings.micId) : null;
        if (settings.micId && !selectedMic) {
          setMicStatus("missing-selected");
          setMicMessage(t("settingsGeneralExtra.mic.missingSelected"));
          return;
        }

        if (uniqueMics.length === 0) {
          if (needsPermission) {
            setMicStatus("permission-needed");
            setMicMessage(t("settingsGeneralExtra.mic.permissionNeeded"));
            return;
          }

          setMicStatus("empty");
          setMicMessage(t("settingsGeneralExtra.mic.noneFound"));
          return;
        }

        const activeLabel = selectedMic ? getMicrophoneLabel(selectedMic, uniqueMics.indexOf(selectedMic)) : t("settings.mic.systemDefault");
        setMicStatus("ready");
        setMicMessage(t("settingsGeneralExtra.mic.inUse", { label: activeLabel }));
      } catch (err) {
        void logError("SETTINGS", `IconMicrophone enumeration error: ${err instanceof Error ? err.message : String(err)}`);
        setMicStatus("empty");
        setMicMessage(t("settingsGeneralExtra.mic.enumFailed"));
      }
    };

    fetchMics();

    navigator.mediaDevices?.addEventListener?.("devicechange", fetchMics);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", fetchMics);
    };
  }, [settings?.micId]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
      if (micRef.current && !micRef.current.contains(e.target as Node)) setMicOpen(false);
      if (isHotkeyCaptureActive && hotkeyButtonRef.current && !hotkeyButtonRef.current.contains(e.target as Node)) {
        void stopHotkeyCapture(t("settingsGeneralExtra.hotkey.cancelledKept"));
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isHotkeyCaptureActive]);

  const update = async (patch: Partial<AppSettings>): Promise<AppSettings | null> => {
    if (!settingsRef.current) return null;
    const s = { ...settingsRef.current, ...patch };
    settingsRef.current = s;
    setSettings(s);
    await saveSettings(s);
    emit(SETTINGS_UPDATED_EVENT).catch((e) => {
      void logError("SETTINGS", `Failed to emit settings update event: ${e instanceof Error ? e.message : String(e)}`);
    });
    return s;
  };

  const restorePersistedSettings = async (): Promise<void> => {
    try {
      const latestSettings = await getSettings({ reload: true });
      settingsRef.current = latestSettings;
      setSettings(latestSettings);
    } catch (error) {
      void logError("SETTINGS", `Failed to reload persisted settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const applyCapturedHotkey = async (candidate: string | null): Promise<void> => {
    await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);

    if (!candidate) {
      setIsHotkeyCaptureActive(false);
      setHotkeyDraft(null);
      setHotkeyFeedbackTone("error");
      setHotkeyFeedback(t("settingsGeneralExtra.hotkey.recognizeFailed"));
      return;
    }

    const normalized = normalizeHotkey(candidate);
    if (!normalized.valid || !normalized.normalized) {
      setIsHotkeyCaptureActive(false);
      setHotkeyDraft(null);
      setHotkeyFeedbackTone("error");
      setHotkeyFeedback(normalized.error || t("settingsGeneralExtra.hotkey.invalid"));
      return;
    }

    pendingHotkeyRef.current = normalized.normalized;
    setIsHotkeyCaptureActive(false);
    setIsHotkeySubmitting(true);
    setHotkeyDraft(normalized.normalized);
    setHotkeyFeedbackTone("idle");
    setHotkeyFeedback(t("settingsGeneralExtra.hotkey.checkingFree"));

    emit(HOTKEY_CHANGE_REQUEST_EVENT, { hotkey: normalized.normalized }).catch((error) => {
      pendingHotkeyRef.current = null;
      setIsHotkeySubmitting(false);
      setHotkeyDraft(null);
      setHotkeyFeedbackTone("error");
      setHotkeyFeedback(t("settingsGeneralExtra.hotkey.sendFailed"));
      void logError("SETTINGS", `Failed to emit hotkey change request: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const startHotkeyCapture = async (): Promise<void> => {
    if (isHotkeySubmitting || isHotkeyCaptureActive) {
      return;
    }

    clearHotkeyFeedbackResetTimer();
    pendingHotkeyRef.current = null;
    setIsHotkeyCaptureActive(true);
    setHotkeyDraft(null);
    setHotkeyFeedbackTone("idle");
    setHotkeyFeedback(usesNativeHotkeyCapture ? t("settingsGeneralExtra.hotkey.startingCapture") : t("settingsGeneralExtra.hotkey.pressNewCombo"));

    try {
      await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: true });
      if (usesNativeHotkeyCapture) {
        await invoke("start_native_hotkey_capture");
      } else {
        window.setTimeout(() => hotkeyButtonRef.current?.focus(), 0);
      }
    } catch (error) {
      await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);
      setIsHotkeyCaptureActive(false);
      setHotkeyDraft(null);
      setHotkeyFeedbackTone("error");
      setHotkeyFeedback(t("settingsGeneralExtra.hotkey.captureStartFailed"));
      void logError("SETTINGS", `Failed to start native hotkey capture: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const stopHotkeyCapture = async (message?: string): Promise<void> => {
    pendingHotkeyRef.current = null;
    setIsHotkeyCaptureActive(false);
    setHotkeyDraft(null);

    if (usesNativeHotkeyCapture) {
      try {
        await invoke("stop_native_hotkey_capture");
      } catch (error) {
        void logError("SETTINGS", `Failed to stop native hotkey capture: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await emit(HOTKEY_CAPTURE_STATE_EVENT, { active: false }).catch(() => null);

    if (message) {
      setHotkeyFeedbackTone("idle");
      setHotkeyFeedback(message);
    }
  };

  const handleHotkeyCaptureSurfaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isHotkeyCaptureActive || isHotkeySubmitting) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    void startHotkeyCapture();
  };

  const handleHotkeyCaptureSurfaceMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();

    if (isHotkeyCaptureActive || isHotkeySubmitting) {
      return;
    }

    void startHotkeyCapture();
  };

  const contactSupport = async (): Promise<void> => {
    const subject = encodeURIComponent(t("settingsGeneralExtra.support.mailSubject"));
    const body = encodeURIComponent(
      t("settingsGeneralExtra.support.mailBody"),
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      await openUrl(mailto);
      setSupportFeedback("");
    } catch (error) {
      void logError("SETTINGS", `Failed to open support mail: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback: put the address on the clipboard so support is still reachable.
      try {
        await navigator.clipboard.writeText(SUPPORT_EMAIL);
        setSupportFeedback(t("settingsGeneralExtra.support.mailCopied", { email: SUPPORT_EMAIL }));
      } catch {
        setSupportFeedback(t("settingsGeneralExtra.support.writeUs", { email: SUPPORT_EMAIL }));
      }
    }
  };

  const toggleAutostart = async (): Promise<void> => {
    if (autostartPending) {
      return;
    }

    const nextEnabled = !autostartEnabled;
    setAutostartPending(true);

    try {
      if (nextEnabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }

      const confirmedEnabled = await isAutostartEnabled();
      setAutostartEnabled(confirmedEnabled);
      setAutostartLoaded(true);
      void logInfo("SETTINGS", `Autostart ${confirmedEnabled ? "enabled" : "disabled"}`);
    } catch (error) {
      void logError("SETTINGS", `Failed to update autostart: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAutostartPending(false);
    }
  };

  const changeLocalModelsDir = async (): Promise<void> => {
    try {
      const selected = await openDialog({
        title: t("settingsGeneralExtra.dialog.chooseModelsDir"),
        directory: true,
        multiple: false,
        defaultPath: effectiveLocalModelsDir || defaultLocalModelsDir || undefined,
      });

      if (typeof selected !== "string") {
        return;
      }

      await update({ localModelsDir: selected });
      void logInfo("SETTINGS", `Local models directory changed: ${selected}`);
    } catch (error) {
      void logError("SETTINGS", `Failed to change local models directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const changeTranscriptionStorageDir = async (): Promise<void> => {
    try {
      const selected = await openDialog({
        title: t("settingsGeneralExtra.dialog.chooseStorageDir"),
        directory: true,
        multiple: false,
        defaultPath: (settingsRef.current?.transcriptionStorageDir || "").trim() || defaultTranscriptionStorageDir || undefined,
      });

      if (typeof selected !== "string") {
        return;
      }

      const history = await getHistory();
      await writeHistoryToStorageDir(selected, history);
      await update({ transcriptionStorageDir: selected });
      setTranscriptionStorageFeedbackTone("success");
      setTranscriptionStorageFeedback(t("settingsGeneralExtra.storage.moved"));
      void logInfo("SETTINGS", "Transcription storage directory changed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await restorePersistedSettings();
      setTranscriptionStorageFeedbackTone("error");
      setTranscriptionStorageFeedback(t("settingsGeneralExtra.storage.moveFailed"));
      void logError("SETTINGS", `Failed to change transcription storage directory: ${message}`);
    }
  };

  const resetTranscriptionStorageDir = async (): Promise<void> => {
    try {
      const history = await getHistory();
      await writeHistoryToDefaultStorage(history);
      await update({ transcriptionStorageDir: "" });
      setTranscriptionStorageFeedbackTone("success");
      setTranscriptionStorageFeedback(t("settingsGeneralExtra.storage.resetDone"));
      void logInfo("SETTINGS", "Transcription storage directory reset to default.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await restorePersistedSettings();
      setTranscriptionStorageFeedbackTone("error");
      setTranscriptionStorageFeedback(t("settingsGeneralExtra.storage.resetFailed"));
      void logError("SETTINGS", `Failed to reset transcription storage directory: ${message}`);
    }
  };

  const getMicrophoneLabel = (mic: MediaDeviceInfo, index: number): string => {
    const label = mic.label?.trim();
    return label ? label : t("settingsGeneralExtra.mic.fallbackName", { index: index + 1 });
  };

  if (!settings) return null;

  const filteredLangs = LANGUAGES.filter(l =>
    l.name.toLowerCase().includes(langSearch.toLowerCase()) ||
    l.native.toLowerCase().includes(langSearch.toLowerCase()) ||
    l.code.toLowerCase().includes(langSearch.toLowerCase())
  );
  const currentLang = LANGUAGES.find(l => l.code === settings.language);
  const selectedMicrophone = microphones.find(m => m.deviceId === settings.micId) || null;
  const visibleMicrophoneLabel = selectedMicrophone
    ? getMicrophoneLabel(selectedMicrophone, microphones.indexOf(selectedMicrophone))
    : settings.micId
      ? t("settings.mic.systemDefault")
      : t("settings.mic.systemDefault");
  const hotkeyDisplayValue = hotkeyDraft
    ? formatHotkeyLabel(hotkeyDraft)
    : isHotkeyCaptureActive
      ? t("settings.hotkey.press")
      : formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY);
  const hotkeyFeedbackColor = hotkeyFeedbackTone === "error"
    ? "var(--danger)"
    : hotkeyFeedbackTone === "success"
      ? "var(--success)"
      : "var(--text-mid)";
  const autostartDisabled = !autostartLoaded || autostartPending;
  const localModelsDir = (settings.localModelsDir || "").trim();
  const effectiveLocalModelsDir = localModelsDir || defaultLocalModelsDir;
  const transcriptionStorageDir = (settings.transcriptionStorageDir || "").trim();
  const transcriptionStorageFeedbackColor = transcriptionStorageFeedbackTone === "error"
    ? "var(--danger)"
    : transcriptionStorageFeedbackTone === "success"
      ? "var(--success)"
      : "var(--text-mid)";
  const widgetScale = normalizeWidgetScale(settings.widgetScale);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.uiLanguage.title")}</div>
          </div>
          <div style={{ display: "flex", background: "var(--control-track)", borderRadius: 10, padding: 3, gap: 2, width: "100%", justifySelf: "end" }}>
            {(["ru", "en"] as const).map((code) => {
              const active = lang === code;

              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => { void update({ uiLanguage: code }); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: CONTROL_HEIGHT - 6,
                    padding: "0 4px",
                    borderRadius: CONTROL_RADIUS,
                    border: "none",
                    fontSize: CONTROL_FONT_SIZE,
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--dropdown-active)" : "transparent",
                    color: active ? "var(--text-hi)" : "var(--text-mid)",
                    cursor: "pointer",
                    transition: "background 0.15s ease, color 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t(code === "ru" ? "settings.uiLanguage.ru" : "settings.uiLanguage.en")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>{t("settings.uiLanguage.desc")}</div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.theme.title")}</div>
          </div>
          <div style={{ display: "flex", background: "var(--control-track)", borderRadius: 10, padding: 3, gap: 2, width: "100%", justifySelf: "end" }}>
            {THEME_OPTIONS.map(({ id, Icon }) => {
              const active = settings.theme === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    applyThemePreference(id);
                    void update({ theme: id });
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: CONTROL_HEIGHT - 6,
                    padding: "0 4px",
                    borderRadius: CONTROL_RADIUS,
                    border: "none",
                    fontSize: CONTROL_FONT_SIZE,
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--dropdown-active)" : "transparent",
                    color: active ? "var(--text-hi)" : "var(--text-mid)",
                    cursor: "pointer",
                    transition: "background 0.15s ease, color 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <Icon size={13} stroke={active ? 2.2 : 1.7} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(`settings.theme.${id}`)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>{t("settings.theme.desc")}</div>
      </div>

      <div className="card" style={{ ...SETTINGS_CARD_STYLE, zIndex: langOpen ? 20 : 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.recognitionLang.title")}</div>
          </div>
        <div ref={langRef} style={{ position: "relative", width: "100%", justifySelf: "end" }}>
          <button onClick={() => setLangOpen((o) => !o)} className="btn" style={{ width: "100%", justifyContent: "space-between", gap: 8, minHeight: CONTROL_HEIGHT, padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentLang ? `${currentLang.native} (${currentLang.name})` : settings.language}
            </span>
            <IconChevronDown size={13} stroke={2} style={{ flexShrink: 0, transform: langOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {langOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxHeight: 320, background: "var(--dropdown-bg)", border: "1px solid var(--border)", borderRadius: 24, boxShadow: "var(--shadow-panel)", zIndex: 100, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: 12, borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
                <IconSearch size={13} style={{ color: "var(--text-low)", flexShrink: 0 }} />
                <input autoFocus value={langSearch} onChange={(e) => setLangSearch(e.target.value)} placeholder={t("settings.recognitionLang.searchPlaceholder")} style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, color: "var(--text-hi)", flex: 1 }} />
              </div>
              <div style={{ overflow: "auto", flex: 1 }}>
                {filteredLangs.length === 0 ? (
                  <div style={{ padding: "14px 16px", fontSize: 12, color: "var(--text-low)" }}>{t("common.notFound")}</div>
                ) : filteredLangs.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { update({ language: lang.code }); setLangOpen(false); setLangSearch(""); }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      cursor: "pointer",
                      padding: "10px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: settings.language === lang.code ? "var(--dropdown-active)" : "transparent",
                      color: settings.language === lang.code ? "var(--text-hi)" : "var(--text-mid)",
                      fontSize: 12,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--dropdown-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = settings.language === lang.code ? "var(--dropdown-active)" : "transparent"}
                  >
                    <span style={{ minWidth: 28, fontSize: 10, color: "var(--text-low)", fontFamily: "monospace" }}>{lang.code}</span>
                    <span style={{ flex: 1 }}>{lang.native}</span>
                    <span style={{ fontSize: 10, color: "var(--text-low)" }}>{lang.name}</span>
                    {settings.language === lang.code && <IconCheck size={12} stroke={2.5} style={{ color: "var(--text-hi)", flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>{t("settings.recognitionLang.desc")}</div>
      </div>

      <div className="card" style={{ ...SETTINGS_CARD_STYLE, zIndex: micOpen ? 20 : 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.mic.title")}</div>
          </div>
        <div ref={micRef} style={{ position: "relative", width: "100%", justifySelf: "end" }}>
          <button
            onClick={() => {
              if (microphones.length === 0 || micStatus === "permission-needed") return;
              setMicOpen((o) => !o);
            }}
            className="btn"
            style={{ width: "100%", justifyContent: "space-between", gap: 8, minHeight: CONTROL_HEIGHT, padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE, opacity: microphones.length === 0 || micStatus === "permission-needed" ? 0.7 : 1, cursor: microphones.length === 0 || micStatus === "permission-needed" ? "not-allowed" : "pointer" }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {microphones.length === 0 ? t("settings.mic.systemDefault") : visibleMicrophoneLabel}
            </span>
            <IconChevronDown size={13} stroke={2} style={{ flexShrink: 0, transform: micOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>

          {micOpen && microphones.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: "100%", maxHeight: 240, background: "var(--dropdown-bg)", border: "1px solid var(--border)", borderRadius: 24, boxShadow: "var(--shadow-panel)", zIndex: 100, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ overflow: "auto", flex: 1, padding: "6px 0" }}>
                <button
                  onClick={() => { void update({ micId: "" }); setMicOpen(false); }}
                  style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: settings.micId === "" ? "var(--dropdown-active)" : "transparent", color: settings.micId === "" ? "var(--text-hi)" : "var(--text-mid)", fontSize: 12, transition: "background 0.1s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--dropdown-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = settings.micId === "" ? "var(--dropdown-active)" : "transparent"}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("settings.mic.systemDefault")}</span>
                  {settings.micId === "" && <IconCheck size={12} stroke={2.5} style={{ color: "var(--text-hi)", flexShrink: 0 }} />}
                </button>
                {microphones.map((m, i) => (
                  <button
                    key={m.deviceId}
                    onClick={() => { void update({ micId: m.deviceId }); setMicOpen(false); }}
                    style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: settings.micId === m.deviceId ? "var(--dropdown-active)" : "transparent", color: settings.micId === m.deviceId ? "var(--text-hi)" : "var(--text-mid)", fontSize: 12, transition: "background 0.1s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--dropdown-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = settings.micId === m.deviceId ? "var(--dropdown-active)" : "transparent"}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getMicrophoneLabel(m, i)}</span>
                    {settings.micId === m.deviceId && <IconCheck size={12} stroke={2.5} style={{ color: "var(--text-hi)", flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>{t("settings.mic.desc")}</div>
        <div style={{ fontSize: 13, color: "var(--text-low)", lineHeight: 1.6 }}>{micMessage}</div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.hotkey.title")}</div>
          </div>
          <div
            ref={hotkeyButtonRef}
            role="button"
            tabIndex={0}
            aria-disabled={isHotkeySubmitting}
            onMouseDown={handleHotkeyCaptureSurfaceMouseDown}
            onKeyDown={handleHotkeyCaptureSurfaceKeyDown}
            className="btn"
            style={{
              width: "100%",
              minHeight: CONTROL_HEIGHT,
              padding: "0 10px",
              borderRadius: CONTROL_RADIUS,
              justifyContent: "space-between",
              gap: 8,
              border: isHotkeyCaptureActive ? "1px solid rgba(15,118,110,0.28)" : undefined,
              boxShadow: isHotkeyCaptureActive ? "0 0 0 4px rgba(15,118,110,0.08)" : undefined,
              opacity: isHotkeySubmitting ? 0.8 : 1,
              cursor: isHotkeySubmitting ? "wait" : "pointer",
              justifySelf: "end",
            }}
          >
            <span style={{ color: "var(--text-hi)", fontSize: CONTROL_FONT_SIZE, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hotkeyDisplayValue}
            </span>
            <span style={{ color: "var(--text-low)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
              {isHotkeySubmitting ? t("settings.hotkey.checking") : isHotkeyCaptureActive ? t("settings.hotkey.recording") : t("settings.hotkey.change")}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.hotkey.desc")}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: hotkeyFeedbackColor, lineHeight: 1.6 }}>{hotkeyFeedback}</div>
          <div style={{ fontSize: 12, color: "var(--text-low)", whiteSpace: "nowrap" }}>
            {t("settings.hotkey.current", { hotkey: formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY) })}
          </div>
        </div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.widgetSize.title")}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 56px", alignItems: "center", gap: 12, justifySelf: "end", width: "100%" }}>
            <input
              type="range"
              min={WIDGET_SCALE_MIN}
              max={WIDGET_SCALE_MAX}
              step={WIDGET_SCALE_STEP}
              value={widgetScale}
              onChange={(event) => {
                void update({ widgetScale: normalizeWidgetScale(Number(event.currentTarget.value)) });
              }}
              aria-label={t("settings.widgetSize.aria")}
              style={{
                width: "100%",
                accentColor: "var(--accent)",
                cursor: "pointer",
              }}
            />
            <div
              style={{
                height: CONTROL_HEIGHT,
                borderRadius: CONTROL_RADIUS,
                background: "var(--control-muted)",
                color: "var(--text-hi)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: CONTROL_FONT_SIZE,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatWidgetScalePercent(widgetScale)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.widgetSize.desc")}
        </div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.autostart.title")}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autostartEnabled}
            aria-disabled={autostartDisabled}
            onClick={() => { void toggleAutostart(); }}
            className="btn"
            style={{
              width: "100%",
              minHeight: CONTROL_HEIGHT,
              padding: "0 10px",
              borderRadius: CONTROL_RADIUS,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 34px",
              alignItems: "center",
              gap: 10,
              opacity: autostartDisabled ? 0.72 : 1,
              cursor: autostartDisabled ? "wait" : "pointer",
              transform: "none",
              justifySelf: "end",
            }}
          >
            <span style={{ color: "var(--text-hi)", fontSize: CONTROL_FONT_SIZE, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
              {autostartEnabled ? t("settings.autostart.on") : t("settings.autostart.off")}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: autostartEnabled ? "var(--accent)" : "var(--switch-track)",
                padding: 3,
                position: "relative",
                transition: "background 0.15s ease",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 3,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "var(--accent-contrast)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                  transform: autostartEnabled ? "translateX(14px)" : "translateX(0)",
                  transition: "transform 0.18s ease",
                }}
              />
            </span>
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.autostart.desc")}
        </div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.modelsDir.title")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end", width: "100%" }}>
            <button
              type="button"
              onClick={() => { void changeLocalModelsDir(); }}
              className="btn"
              style={{ minHeight: CONTROL_HEIGHT, flex: 1, justifyContent: "center", padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}
            >
              {t("common.change")}
            </button>
            {localModelsDir && (
              <button
                type="button"
                onClick={() => { void update({ localModelsDir: "" }); }}
                className="btn"
                style={{ minHeight: CONTROL_HEIGHT, flex: 1, justifyContent: "center", padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}
              >
                {t("common.default")}
              </button>
            )}
          </div>
        </div>
        <input
          type="text"
          value={settings.localModelsDir}
          onChange={(event) => { void update({ localModelsDir: event.target.value }); }}
          className="input"
          placeholder={defaultLocalModelsDir || t("settings.modelsDir.placeholder")}
          style={{ height: 40, padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11 }}
        />
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.modelsDir.desc")}
        </div>
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.storage.title")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end", width: "100%" }}>
            <button
              type="button"
              onClick={() => { void changeTranscriptionStorageDir(); }}
              className="btn"
              style={{ minHeight: CONTROL_HEIGHT, flex: 1, justifyContent: "center", padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}
            >
              {t("common.change")}
            </button>
            {transcriptionStorageDir && (
              <button
                type="button"
                onClick={() => { void resetTranscriptionStorageDir(); }}
                className="btn"
                style={{ minHeight: CONTROL_HEIGHT, flex: 1, justifyContent: "center", padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}
              >
                {t("common.default")}
              </button>
            )}
          </div>
        </div>
        <input
          type="text"
          value={settings.transcriptionStorageDir}
          readOnly
          className="input"
          placeholder={defaultTranscriptionStorageDir || t("settings.modelsDir.placeholder")}
          style={{ height: 40, padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11 }}
        />
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.storage.desc")}
        </div>
        {transcriptionStorageFeedback && (
          <div style={{ fontSize: 13, color: transcriptionStorageFeedbackColor, lineHeight: 1.6 }}>
            {transcriptionStorageFeedback}
          </div>
        )}
      </div>

      <div className="card" style={SETTINGS_CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: SETTING_ROW_COLUMNS, alignItems: "center", gap: SETTING_ROW_GAP }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", margin: 0 }}>{t("settings.support.title")}</div>
          </div>
          <button
            type="button"
            onClick={() => { void contactSupport(); }}
            className="btn"
            style={{ minHeight: CONTROL_HEIGHT, width: "100%", justifySelf: "end", justifyContent: "center", gap: 8, padding: "0 10px", borderRadius: CONTROL_RADIUS, fontSize: CONTROL_FONT_SIZE }}
          >
            <IconMail size={14} stroke={2} />
            {t("settings.support.button")}
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65 }}>
          {t("settings.support.desc", { email: SUPPORT_EMAIL })}
        </div>
        {supportFeedback && (
          <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
            {supportFeedback}
          </div>
        )}
      </div>
    </div>
  );
}
