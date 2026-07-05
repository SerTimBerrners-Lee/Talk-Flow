import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import {
  AppSettings,
  DEFAULT_HOTKEY,
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  getSettings,
  normalizeHotkey,
  saveSettings,
} from "../../../lib/store";
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
import type {
  WidgetAction,
  WidgetMachineState,
} from "../services/widgetMachine";

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
  onSelectionTranslationHotkey: () => void;
}

type HandyHotkeyIntent = "selection" | "voice" | "ignore";
type SelectionHotkeyAction = "arm" | "trigger" | "consume";

export function resolveHandyHotkeyIntent({
  eventHotkey,
  voiceHotkey,
  selectionHotkey,
  selectionEnabled,
}: {
  eventHotkey: string | null;
  voiceHotkey: string | null;
  selectionHotkey: string | null;
  selectionEnabled: boolean;
}): HandyHotkeyIntent {
  if (selectionEnabled && eventHotkey && eventHotkey === selectionHotkey) {
    return "selection";
  }

  if (eventHotkey && eventHotkey === voiceHotkey) {
    return "voice";
  }

  return "ignore";
}

export function resolveSelectionHotkeyAction(
  state: HandyHotkeyEventPayload["state"],
  armed: boolean,
): SelectionHotkeyAction {
  if (state === "Pressed") {
    return "arm";
  }

  if (state === "Released" && armed) {
    return "trigger";
  }

  return "consume";
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
  onSelectionTranslationHotkey,
}: UseWidgetHotkeyParams): void {
  const { t } = useI18n();
  const attemptHotkeyRegistrationRef = useRef<
    (rawHotkey: string) => Promise<HotkeyRegistrationResultPayload>
  >(attemptHotkeyRegistrationPlaceholder);
  const isHotkeyCaptureActiveRef = useRef(false);
  const selectionRegisteredHotkeyRef = useRef<string | null>(null);
  const selectionHotkeyArmedRef = useRef(false);

  const hotkeyForComparison = useCallback(
    (hotkey: string | null | undefined): string | null => {
      if (!hotkey) return null;
      return normalizeHotkey(hotkey).normalized ?? hotkey;
    },
    [],
  );

  const unregisterHotkeyRef = useCallback(
    async (hotkeyRef: MutableRefObject<string | null>) => {
      const currentHotkey = hotkeyRef.current;
      if (!currentHotkey) return;

      logInfo("HOTKEY", `Unregistering: ${currentHotkey}`);
      await invoke("unregister_handy_hotkey", { hotkey: currentHotkey }).catch(
        () => {},
      );
      hotkeyRef.current = null;
    },
    [],
  );

  const unregisterCurrentHotkey = useCallback(async () => {
    await unregisterHotkeyRef(registeredHotkeyRef);
  }, [registeredHotkeyRef, unregisterHotkeyRef]);

  const activateWidgetForHotkey = useCallback(() => {
    invoke("activate_widget_for_hotkey").catch((error) => {
      logError("HOTKEY", `Failed to activate widget for hotkey: ${error}`);
    });
  }, []);

  const handleHotkeyPress = useCallback(
    (event: HandyHotkeyEventPayload) => {
      if (isHotkeyCaptureActiveRef.current) {
        selectionHotkeyArmedRef.current = false;
        dispatch({ type: "RESET_HOTKEY_STATE" });
        return;
      }

      const machine = machineRef.current;
      logInfo(
        "HOTKEY",
        `Triggered! state=${machine.widgetState}, shortcutState=${event.state}`,
      );

      if (event.state !== "Pressed" && event.state !== "Released") {
        return;
      }

      const eventHotkey = hotkeyForComparison(event.hotkey);
      const voiceHotkey = hotkeyForComparison(
        registeredHotkeyRef.current ??
          settingsRef.current?.hotkey ??
          DEFAULT_HOTKEY,
      );
      const selectionHotkey = hotkeyForComparison(
        selectionRegisteredHotkeyRef.current ??
          settingsRef.current?.translation.selectionHotkey ??
          DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      );

      const intent = resolveHandyHotkeyIntent({
        eventHotkey,
        voiceHotkey,
        selectionHotkey,
        selectionEnabled: !!settingsRef.current?.translation.selectionEnabled,
      });

      if (intent === "selection") {
        const action = resolveSelectionHotkeyAction(
          event.state,
          selectionHotkeyArmedRef.current,
        );

        if (action === "arm") {
          selectionHotkeyArmedRef.current = true;
          logInfo(
            "HOTKEY",
            `Selection translation hotkey armed: ${event.hotkey}`,
          );
        } else if (action === "trigger") {
          selectionHotkeyArmedRef.current = false;
          logInfo(
            "HOTKEY",
            `Selection translation hotkey released: ${event.hotkey}`,
          );
          onSelectionTranslationHotkey();
        }
        return;
      }

      if (event.state === "Released" && selectionHotkeyArmedRef.current) {
        selectionHotkeyArmedRef.current = false;
        return;
      }

      if (intent !== "voice") {
        return;
      }

      if (event.state === "Pressed") {
        activateWidgetForHotkey();
        dispatch({ type: "HOTKEY_PRESSED" });
      } else {
        dispatch({ type: "HOTKEY_RELEASED" });
      }
    },
    [
      activateWidgetForHotkey,
      dispatch,
      hotkeyForComparison,
      machineRef,
      onSelectionTranslationHotkey,
      registeredHotkeyRef,
      settingsRef,
    ],
  );

  const attemptHotkeyRegistration = useCallback(
    async (
      rawHotkey: string,
      activeHotkeyRef: MutableRefObject<string | null> = registeredHotkeyRef,
      fallbackHotkey: string = DEFAULT_HOTKEY,
    ): Promise<HotkeyRegistrationResultPayload> => {
      const normalized = normalizeHotkey(rawHotkey);
      if (!normalized.valid || !normalized.normalized) {
        return {
          success: false,
          requestedHotkey: rawHotkey,
          activeHotkey: activeHotkeyRef.current ?? fallbackHotkey,
          message: normalized.error || t("widget.hotkey.invalidFormat"),
        };
      }

      const nextHotkey = normalized.normalized;
      const currentHotkey = activeHotkeyRef.current;
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

        activeHotkeyRef.current = nextHotkey;
        if (currentHotkey && currentHotkey !== nextHotkey) {
          const stillUsedByVoice =
            activeHotkeyRef !== registeredHotkeyRef &&
            registeredHotkeyRef.current === currentHotkey;
          const stillUsedBySelection =
            activeHotkeyRef !== selectionRegisteredHotkeyRef &&
            selectionRegisteredHotkeyRef.current === currentHotkey;
          if (!stillUsedByVoice && !stillUsedBySelection) {
            await invoke("unregister_handy_hotkey", {
              hotkey: currentHotkey,
            }).catch(() => {});
          }
        }
        logInfo(
          "HOTKEY",
          `Registered successfully via handy-keys: ${nextHotkey}`,
        );

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
          activeHotkey: currentHotkey ?? fallbackHotkey,
          message: t("widget.hotkey.registerFailed", { hotkey: nextHotkey }),
        };
      }
    },
    [registeredHotkeyRef, t],
  );

  const registerCurrentHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      logInfo(
        "HOTKEY",
        `Skipping registration: loaded=${settingsLoaded}, settings=${!!activeSettings}`,
      );
      return;
    }

    const result = await attemptHotkeyRegistration(
      activeSettings.hotkey || DEFAULT_HOTKEY,
    );
    if (!result.success) {
      showError(result.message || t("widget.hotkey.registerFailedGeneric"));
    }
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t]);

  const registerSelectionHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      return;
    }

    if (!activeSettings.translation.selectionEnabled) {
      await unregisterHotkeyRef(selectionRegisteredHotkeyRef);
      return;
    }

    const selectionHotkey =
      normalizeHotkey(
        activeSettings.translation.selectionHotkey ||
          DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      ).normalized || DEFAULT_SELECTION_TRANSLATION_HOTKEY;
    const voiceHotkey =
      normalizeHotkey(activeSettings.hotkey || DEFAULT_HOTKEY).normalized ||
      DEFAULT_HOTKEY;

    if (selectionHotkey === voiceHotkey) {
      await unregisterHotkeyRef(selectionRegisteredHotkeyRef);
      logInfo(
        "HOTKEY",
        "Selection translation hotkey shares the voice hotkey; selection handler will consume matching events",
      );
      return;
    }

    const result = await attemptHotkeyRegistration(
      selectionHotkey,
      selectionRegisteredHotkeyRef,
      DEFAULT_SELECTION_TRANSLATION_HOTKEY,
    );
    if (!result.success) {
      showError(result.message || t("widget.hotkey.registerFailedGeneric"));
    }
  }, [
    attemptHotkeyRegistration,
    settingsLoaded,
    settingsRef,
    showError,
    t,
    unregisterHotkeyRef,
  ]);

  useEffect(() => {
    void registerCurrentHotkey();
  }, [registerCurrentHotkey, settings?.hotkey]);

  useEffect(() => {
    void registerSelectionHotkey();
  }, [
    registerSelectionHotkey,
    settings?.hotkey,
    settings?.translation.selectionEnabled,
    settings?.translation.selectionHotkey,
  ]);

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

    const unlistenCaptureState = listen<HotkeyCaptureStatePayload>(
      HOTKEY_CAPTURE_STATE_EVENT,
      ({ payload }) => {
        isHotkeyCaptureActiveRef.current = payload.active;

        if (!payload.active) return;

        dispatch({ type: "RESET_HOTKEY_STATE" });
      },
    );

    const unlistenHandyHotkey = listen<HandyHotkeyEventPayload>(
      HANDY_HOTKEY_EVENT,
      ({ payload }) => {
        handleHotkeyPress(payload);
      },
    );

    const unlistenHotkeyRequests = listen<HotkeyChangeRequestPayload>(
      HOTKEY_CHANGE_REQUEST_EVENT,
      async ({ payload }) => {
        const result = await attemptHotkeyRegistrationRef.current(
          payload.hotkey,
        );

        if (result.success) {
          const updatedSettings = {
            ...(settingsRef.current ?? (await getSettings())),
            hotkey: result.activeHotkey,
          };

          await saveSettings({ hotkey: result.activeHotkey });
          settingsRef.current = updatedSettings;
          setSettings(updatedSettings);

          emit(SETTINGS_UPDATED_EVENT).catch((error) => {
            logError(
              "HOTKEY",
              `Failed to emit settings update event: ${error}`,
            );
          });
        }

        emit(HOTKEY_REGISTRATION_RESULT_EVENT, result).catch((error) => {
          logError(
            "HOTKEY",
            `Failed to emit hotkey registration result: ${error}`,
          );
        });
      },
    );

    return () => {
      selectionHotkeyArmedRef.current = false;
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCaptureState.then((unlisten) => unlisten());
      unlistenHandyHotkey.then((unlisten) => unlisten());
      unlistenHotkeyRequests.then((unlisten) => unlisten());
      void unregisterCurrentHotkey();
      void unregisterHotkeyRef(selectionRegisteredHotkeyRef);
    };
  }, [
    clearReleaseStopTimer,
    dispatch,
    handleHotkeyPress,
    setSettings,
    settingsRef,
    unregisterCurrentHotkey,
    unregisterHotkeyRef,
  ]);
}

async function attemptHotkeyRegistrationPlaceholder(): Promise<HotkeyRegistrationResultPayload> {
  throw new Error("attemptHotkeyRegistration called before initialization");
}
