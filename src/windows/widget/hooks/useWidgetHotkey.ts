import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { register, unregister, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";

import { AppSettings, DEFAULT_HOTKEY, getSettings, validateHotkey } from "../../../lib/store";
import { logError, logInfo } from "../../../lib/logger";
import { SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { WidgetState } from "../widgetConstants";
import { evaluateHotkeyFsm, HotkeyShortcutState } from "../services/hotkeyFsm";

interface UseWidgetHotkeyParams {
  settingsLoaded: boolean;
  settings: AppSettings | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  settingsRef: MutableRefObject<AppSettings | null>;
  stateRef: MutableRefObject<WidgetState>;
  registeredHotkeyRef: MutableRefObject<string | null>;
  hotkeyHeldRef: MutableRefObject<boolean>;
  recordingActiveRef: MutableRefObject<boolean>;
  pendingStopAfterStartRef: MutableRefObject<boolean>;
  lockedRecordingRef: MutableRefObject<boolean>;
  suppressNextReleaseRef: MutableRefObject<boolean>;
  releaseStopTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  stopAndProcessRef: MutableRefObject<() => Promise<void>>;
  clearReleaseStopTimer: () => void;
  setLockedRecordingMode: (value: boolean) => void;
  startRecording: () => Promise<void>;
  stopAndProcess: () => Promise<void>;
  showError: (message: string) => void;
}

function normalizeHotkey(rawHotkey: string): { valid: boolean; normalized?: string; error?: string } {
  const validation = validateHotkey(rawHotkey);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  const normalized = rawHotkey
    .split("+")
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === "ctrl") return "Control";
      if (p === "alt" || p === "option") return "Alt";
      if (p === "shift") return "Shift";
      if (p === "cmd" || p === "command" || p === "meta") return "Command";
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("+");

  return { valid: true, normalized };
}

export function useWidgetHotkey({
  settingsLoaded,
  settings,
  setSettings,
  settingsRef,
  stateRef,
  registeredHotkeyRef,
  hotkeyHeldRef,
  recordingActiveRef,
  pendingStopAfterStartRef,
  lockedRecordingRef,
  suppressNextReleaseRef,
  releaseStopTimerRef,
  stopAndProcessRef,
  clearReleaseStopTimer,
  setLockedRecordingMode,
  startRecording,
  stopAndProcess,
  showError,
}: UseWidgetHotkeyParams): void {
  const unregisterCurrentHotkey = useCallback(async () => {
    const currentHotkey = registeredHotkeyRef.current;
    if (!currentHotkey) {
      return;
    }

    logInfo("HOTKEY", `Unregistering: ${currentHotkey}`);
    await unregister(currentHotkey).catch(() => {});
    registeredHotkeyRef.current = null;
  }, [registeredHotkeyRef]);

  const handleHotkeyPress = useCallback(
    (event: ShortcutEvent) => {
      const currentState = stateRef.current;
      logInfo("HOTKEY", `Triggered! state=${currentState}, shortcutState=${event.state}`);

      if (event.state !== "Pressed" && event.state !== "Released") {
        return;
      }

      const shortcutState: HotkeyShortcutState = event.state;

      const doubleTapTimeout = settingsRef.current?.doubleTapTimeout ?? 400;

      const scheduleStopAfterRelease = () => {
        clearReleaseStopTimer();
        releaseStopTimerRef.current = setTimeout(() => {
          releaseStopTimerRef.current = null;
          if (stateRef.current !== "recording" || lockedRecordingRef.current) {
            return;
          }

          if (recordingActiveRef.current) {
            logInfo("HOTKEY", "Release grace window ended, stopping recording");
            void stopAndProcessRef.current();
          } else {
            logInfo("HOTKEY", "Release grace window ended before recorder startup completed");
            pendingStopAfterStartRef.current = true;
          }
        }, doubleTapTimeout);
      };

      const decision = evaluateHotkeyFsm(
        {
          widgetState: currentState,
          hotkeyHeld: hotkeyHeldRef.current,
          lockedRecording: lockedRecordingRef.current,
          suppressNextRelease: suppressNextReleaseRef.current,
          pendingStopAfterStart: pendingStopAfterStartRef.current,
          releaseStopTimerActive: releaseStopTimerRef.current !== null,
        },
        shortcutState,
      );

      hotkeyHeldRef.current = decision.nextState.hotkeyHeld;
      suppressNextReleaseRef.current = decision.nextState.suppressNextRelease;
      pendingStopAfterStartRef.current = decision.nextState.pendingStopAfterStart;

      if (decision.nextState.lockedRecording !== lockedRecordingRef.current) {
        setLockedRecordingMode(decision.nextState.lockedRecording);
      }

      for (const command of decision.commands) {
        if (command === "clear_release_stop_timer") {
          clearReleaseStopTimer();
          continue;
        }

        if (command === "schedule_stop_after_release") {
          if (recordingActiveRef.current) {
            logInfo("HOTKEY", "Shortcut released, waiting for possible lock gesture");
          } else {
            logInfo(
              "HOTKEY",
              "Shortcut released before startup completed, waiting for possible lock gesture",
            );
          }
          scheduleStopAfterRelease();
          continue;
        }

        if (command === "start_recording") {
          void startRecording();
          continue;
        }

        if (command === "stop_recording") {
          logInfo("HOTKEY", "Locked recording pressed again, stopping recording");
          void stopAndProcess();
        }
      }
    },
    [
      clearReleaseStopTimer,
      hotkeyHeldRef,
      lockedRecordingRef,
      pendingStopAfterStartRef,
      recordingActiveRef,
      releaseStopTimerRef,
      setLockedRecordingMode,
      settingsRef,
      startRecording,
      stateRef,
      stopAndProcess,
      stopAndProcessRef,
      suppressNextReleaseRef,
    ],
  );

  const registerCurrentHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      logInfo("HOTKEY", `Skipping registration: loaded=${settingsLoaded}, settings=${!!activeSettings}`);
      return;
    }

    const rawHotkey = DEFAULT_HOTKEY;
    const normalized = normalizeHotkey(rawHotkey);
    if (!normalized.valid || !normalized.normalized) {
      logError("HOTKEY", `Invalid hotkey format: ${rawHotkey} - ${normalized.error}`);
      showError(`Неверный формат горячей клавиши: ${normalized.error}. Откройте настройки и задайте корректную комбинацию.`);
      return;
    }

    await unregisterCurrentHotkey();

    logInfo("HOTKEY", `Attempting to register: ${normalized.normalized}`);
    try {
      await register(normalized.normalized, handleHotkeyPress);
      registeredHotkeyRef.current = normalized.normalized;
      logInfo("HOTKEY", `Registered successfully: ${normalized.normalized}`);
    } catch (error) {
      logError("HOTKEY", `Failed to register: ${error}`);
      showError(`Не удалось зарегистрировать горячую клавишу "${normalized.normalized}". Возможно, сочетание занято другим приложением.`);
    }
  }, [
    handleHotkeyPress,
    registeredHotkeyRef,
    settingsLoaded,
    settingsRef,
    showError,
    unregisterCurrentHotkey,
  ]);

  useEffect(() => {
    void registerCurrentHotkey();
  }, [registerCurrentHotkey, settings]);

  useEffect(() => {
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, async () => {
      const latestSettings = await getSettings();
      setSettings(latestSettings);
      await registerCurrentHotkey();
    });

    return () => {
      unlistenSettings.then((unlisten) => unlisten());
      void unregisterCurrentHotkey();
    };
  }, [registerCurrentHotkey, setSettings, unregisterCurrentHotkey]);
}
