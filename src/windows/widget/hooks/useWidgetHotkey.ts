import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import { AppSettings, DEFAULT_HOTKEY, getSettings, normalizeHotkey, saveSettings } from "../../../lib/store";
import {
  HOTKEY_CAPTURE_STATE_EVENT,
  HOTKEY_CHANGE_REQUEST_EVENT,
  HOTKEY_REGISTRATION_RESULT_EVENT,
  HANDY_HOTKEY_EVENT,
  HandyHotkeyEventPayload,
  HotkeyCaptureStatePayload,
  HotkeyChangeRequestPayload,
  HotkeyRegistrationResultPayload,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { logError, logInfo } from "../../../lib/logger";
import { useI18n } from "../../../lib/i18n";
import type { WidgetAction, WidgetMachineState } from "../services/widgetMachine";

interface UseWidgetHotkeyParams {
  settingsLoaded: boolean;
  settings: AppSettings | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  settingsRef: MutableRefObject<AppSettings | null>;
  machineRef: MutableRefObject<WidgetMachineState>;
  dispatch: (action: WidgetAction) => void;
  registeredHotkeyRef: MutableRefObject<string | null>;
  clearReleaseStopTimer: () => void;
  showError: (message: string) => void;
}

export function useWidgetHotkey({
  settingsLoaded,
  settings,
  setSettings,
  settingsRef,
  machineRef,
  dispatch,
  registeredHotkeyRef,
  clearReleaseStopTimer,
  showError,
}: UseWidgetHotkeyParams): void {
  const { t } = useI18n();
  const attemptHotkeyRegistrationRef = useRef<(rawHotkey: string) => Promise<HotkeyRegistrationResultPayload>>(
    attemptHotkeyRegistrationPlaceholder,
  );
  const isHotkeyCaptureActiveRef = useRef(false);

  const unregisterCurrentHotkey = useCallback(async () => {
    const currentHotkey = registeredHotkeyRef.current;
    if (!currentHotkey) return;

    logInfo("HOTKEY", `Unregistering: ${currentHotkey}`);
    await invoke("unregister_handy_hotkey", { hotkey: currentHotkey }).catch(() => {});
    registeredHotkeyRef.current = null;
  }, [registeredHotkeyRef]);

  const activateWidgetForHotkey = useCallback(() => {
    invoke("activate_widget_for_hotkey").catch((error) => {
      logError("HOTKEY", `Failed to activate widget for hotkey: ${error}`);
    });
  }, []);

  const handleHotkeyPress = useCallback(
    (event: HandyHotkeyEventPayload) => {
      if (isHotkeyCaptureActiveRef.current) {
        dispatch({ type: "RESET_HOTKEY_STATE" });
        return;
      }

      const machine = machineRef.current;
      logInfo("HOTKEY", `Triggered! state=${machine.widgetState}, shortcutState=${event.state}`);

      if (event.state !== "Pressed" && event.state !== "Released") {
        return;
      }

      if (event.state === "Pressed") {
        activateWidgetForHotkey();
        dispatch({ type: "HOTKEY_PRESSED" });
      } else {
        dispatch({ type: "HOTKEY_RELEASED" });
      }
    },
    [activateWidgetForHotkey, dispatch, machineRef],
  );

  const attemptHotkeyRegistration = useCallback(async (rawHotkey: string): Promise<HotkeyRegistrationResultPayload> => {
    const normalized = normalizeHotkey(rawHotkey);
    if (!normalized.valid || !normalized.normalized) {
      return {
        success: false,
        requestedHotkey: rawHotkey,
        activeHotkey: registeredHotkeyRef.current ?? settingsRef.current?.hotkey ?? DEFAULT_HOTKEY,
        message: normalized.error || t("widget.hotkey.invalidFormat"),
      };
    }

    const nextHotkey = normalized.normalized;
    const currentHotkey = registeredHotkeyRef.current;
    if (currentHotkey === nextHotkey) {
      return {
        success: true,
        requestedHotkey: nextHotkey,
        activeHotkey: nextHotkey,
      };
    }

    logInfo("HOTKEY", `Attempting to register: ${nextHotkey}`);

    try {
      await invoke("register_handy_hotkey", { hotkey: nextHotkey });

      registeredHotkeyRef.current = nextHotkey;
      logInfo("HOTKEY", `Registered successfully via handy-keys: ${nextHotkey}`);

      return {
        success: true,
        requestedHotkey: nextHotkey,
        activeHotkey: nextHotkey,
      };
    } catch (error) {
      logError("HOTKEY", `Failed to register ${nextHotkey}: ${error}`);
      return {
        success: false,
        requestedHotkey: nextHotkey,
        activeHotkey: currentHotkey ?? settingsRef.current?.hotkey ?? DEFAULT_HOTKEY,
        message: t("widget.hotkey.registerFailed", { hotkey: nextHotkey }),
      };
    }
  }, [handleHotkeyPress, registeredHotkeyRef, settingsRef, t]);

  const registerCurrentHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      logInfo("HOTKEY", `Skipping registration: loaded=${settingsLoaded}, settings=${!!activeSettings}`);
      return;
    }

    const result = await attemptHotkeyRegistration(activeSettings.hotkey || DEFAULT_HOTKEY);
    if (!result.success) {
      showError(result.message || t("widget.hotkey.registerFailedGeneric"));
    }
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t]);

  useEffect(() => {
    void registerCurrentHotkey();
  }, [registerCurrentHotkey, settings?.hotkey]);

  useEffect(() => {
    attemptHotkeyRegistrationRef.current = attemptHotkeyRegistration;
  }, [attemptHotkeyRegistration]);

  useEffect(() => {
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, async () => {
      const latestSettings = await getSettings({ reload: true });
      setSettings(latestSettings);
      settingsRef.current = latestSettings;
      logInfo(
        "SETTINGS",
        `Applied settings update: mic=${latestSettings.micId || "[default]"}, hotkey=${latestSettings.hotkey}`,
      );
    });

    const unlistenCaptureState = listen<HotkeyCaptureStatePayload>(HOTKEY_CAPTURE_STATE_EVENT, ({ payload }) => {
      isHotkeyCaptureActiveRef.current = payload.active;

      if (!payload.active) return;

      dispatch({ type: "RESET_HOTKEY_STATE" });
    });

    const unlistenHandyHotkey = listen<HandyHotkeyEventPayload>(HANDY_HOTKEY_EVENT, ({ payload }) => {
      handleHotkeyPress(payload);
    });

    const unlistenHotkeyRequests = listen<HotkeyChangeRequestPayload>(HOTKEY_CHANGE_REQUEST_EVENT, async ({ payload }) => {
      const result = await attemptHotkeyRegistrationRef.current(payload.hotkey);

      if (result.success) {
        const updatedSettings = {
          ...(settingsRef.current ?? (await getSettings())),
          hotkey: result.activeHotkey,
        };

        await saveSettings({ hotkey: result.activeHotkey });
        settingsRef.current = updatedSettings;
        setSettings(updatedSettings);

        emit(SETTINGS_UPDATED_EVENT).catch((error) => {
          logError("HOTKEY", `Failed to emit settings update event: ${error}`);
        });
      }

      emit(HOTKEY_REGISTRATION_RESULT_EVENT, result).catch((error) => {
        logError("HOTKEY", `Failed to emit hotkey registration result: ${error}`);
      });
    });

    return () => {
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCaptureState.then((unlisten) => unlisten());
      unlistenHandyHotkey.then((unlisten) => unlisten());
      unlistenHotkeyRequests.then((unlisten) => unlisten());
      void unregisterCurrentHotkey();
    };
  }, [clearReleaseStopTimer, dispatch, handleHotkeyPress, setSettings, settingsRef, unregisterCurrentHotkey]);
}

async function attemptHotkeyRegistrationPlaceholder(): Promise<HotkeyRegistrationResultPayload> {
  throw new Error("attemptHotkeyRegistration called before initialization");
}
