import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import {
  AppSettings,
  DEFAULT_HOTKEY,
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  getSettings,
  isUnsafeMacGlobalHotkey,
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
  HotkeyTarget,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { logError, logInfo } from "../../../lib/logger";
import { useI18n } from "../../../lib/i18n";
import type {
  WidgetAction,
  WidgetMachineState,
} from "../services/widgetMachine";
import { applyHotkeyTransaction } from "../services/hotkeyTransaction";

interface UseWidgetHotkeyParams {
  settingsLoaded: boolean;
  settings: AppSettings | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  settingsRef: MutableRefObject<AppSettings | null>;
  machineRef: MutableRefObject<WidgetMachineState>;
  dispatch: (action: WidgetAction) => void;
  registeredHotkeyRef: MutableRefObject<string | null>;
  showError: (message: string) => void;
  onSelectionTranslationHotkey: () => void;
}

type HandyHotkeyIntent = "selection" | "voice" | "ignore";
type SelectionHotkeyAction = "arm" | "trigger" | "consume";
interface RegistrationAttemptResult {
  success: boolean;
  requestedHotkey: string;
  activeHotkey: string;
  message?: string;
}
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
  if (
    selectionEnabled &&
    eventHotkey &&
    eventHotkey === selectionHotkey &&
    selectionHotkey !== voiceHotkey
  ) {
    return "selection";
  }

  if (eventHotkey && eventHotkey === voiceHotkey) {
    return "voice";
  }

  if (selectionEnabled && eventHotkey && eventHotkey === selectionHotkey) {
    return "ignore";
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
  showError,
  onSelectionTranslationHotkey,
}: UseWidgetHotkeyParams): void {
  const { t } = useI18n();
  const isHotkeyCaptureActiveRef = useRef(false);
  const activeCaptureRequestIdRef = useRef<string | null>(null);
  const selectionRegisteredHotkeyRef = useRef<string | null>(null);
  const latestRequestIdsRef = useRef<Record<HotkeyTarget, string | null>>({
    dictation: null,
    selection: null,
  });
  const transactionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectionHotkeyArmedRef = useRef(false);
  const handleHotkeyPressRef = useRef<(event: HandyHotkeyEventPayload) => void>(
    () => {},
  );
  const retryRegistrationsRef = useRef<() => Promise<void>>(async () => {});

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
      if (isUnsafeMacGlobalHotkey(eventHotkey)) {
        selectionHotkeyArmedRef.current = false;
        dispatch({ type: "RESET_HOTKEY_STATE" });
        logError(
          "HOTKEY",
          `Ignored unsafe macOS system hotkey event: ${event.hotkey}`,
        );
        return;
      }

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
        if (machine.widgetState !== "recording") {
          dispatch({ type: "RESET_HOTKEY_STATE" });
        }

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
        if (machine.widgetState !== "recording") {
          dispatch({ type: "RESET_HOTKEY_STATE" });
        }
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

  useEffect(() => {
    handleHotkeyPressRef.current = handleHotkeyPress;
  }, [handleHotkeyPress]);

  const attemptHotkeyRegistration = useCallback(
    async (
      rawHotkey: string,
      activeHotkeyRef: MutableRefObject<string | null> = registeredHotkeyRef,
      fallbackHotkey: string = DEFAULT_HOTKEY,
    ): Promise<RegistrationAttemptResult> => {
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
        "Selection translation hotkey shares the voice hotkey; voice hotkey keeps ownership",
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
    retryRegistrationsRef.current = async () => {
      await registerCurrentHotkey();
      await registerSelectionHotkey();
    };
  }, [registerCurrentHotkey, registerSelectionHotkey]);

  useEffect(() => {
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, async () => {
      const latestSettings = await getSettings({ reload: true });
      setSettings(latestSettings);
      settingsRef.current = latestSettings;
      logInfo(
        "SETTINGS",
        `Applied settings update: mic=${latestSettings.micId || "[default]"}, hotkey=${latestSettings.hotkey}`,
      );
      await retryRegistrationsRef.current();
    });

    const unlistenCaptureState = listen<HotkeyCaptureStatePayload>(
      HOTKEY_CAPTURE_STATE_EVENT,
      ({ payload }) => {
        if (payload.active) {
          activeCaptureRequestIdRef.current = payload.requestId;
        } else if (activeCaptureRequestIdRef.current !== payload.requestId) {
          logInfo(
            "HOTKEY_CAPTURE",
            `Ignored stale capture state requestId=${payload.requestId} target=${payload.target}`,
          );
          return;
        } else {
          activeCaptureRequestIdRef.current = null;
        }
        isHotkeyCaptureActiveRef.current = payload.active;

        if (!payload.active) return;

        dispatch({ type: "RESET_HOTKEY_STATE" });
      },
    );

    const unlistenHandyHotkey = listen<HandyHotkeyEventPayload>(
      HANDY_HOTKEY_EVENT,
      ({ payload }) => {
        handleHotkeyPressRef.current(payload);
      },
    );

    const unlistenHotkeyRequests = listen<HotkeyChangeRequestPayload>(
      HOTKEY_CHANGE_REQUEST_EVENT,
      ({ payload }) => {
        latestRequestIdsRef.current[payload.target] = payload.requestId;

        const runTransaction = async (): Promise<void> => {
          let result;
          try {
            result = await applyHotkeyTransaction(payload, {
              loadSettings: () => getSettings({ reload: true }),
              saveSettings,
              registerHotkey: (hotkey) =>
                invoke("register_handy_hotkey", { hotkey }),
              unregisterHotkey: (hotkey) =>
                invoke("unregister_handy_hotkey", { hotkey }),
              getActiveHotkey: (target) =>
                target === "dictation"
                  ? registeredHotkeyRef.current
                  : selectionRegisteredHotkeyRef.current,
              setActiveHotkey: (target, hotkey) => {
                if (target === "dictation") {
                  registeredHotkeyRef.current = hotkey;
                } else {
                  selectionRegisteredHotkeyRef.current = hotkey;
                }
              },
              isCurrentRequest: (target, requestId) =>
                latestRequestIdsRef.current[target] === requestId,
              log: (stage, request, message) => {
                const details = `requestId=${request.requestId} target=${request.target} stage=${stage} ${message}`;
                if (stage === "rollback" || stage === "conflict") {
                  logError("HOTKEY_TRANSACTION", details);
                } else {
                  logInfo("HOTKEY_TRANSACTION", details);
                }
              },
              messages: {
                conflict: t("widget.hotkey.conflict"),
                registerFailed: (hotkey) =>
                  t("widget.hotkey.registerFailed", { hotkey }),
                saveFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
                stale: t("settingsGeneralExtra.hotkey.applyFailed"),
              },
            });
          } catch (error) {
            logError(
              "HOTKEY_TRANSACTION",
              `requestId=${payload.requestId} target=${payload.target} stage=load failed=${error}`,
            );
            result = {
              requestId: payload.requestId,
              target: payload.target,
              success: false,
              requestedHotkey: payload.hotkey,
              activeHotkey:
                (payload.target === "dictation"
                  ? registeredHotkeyRef.current
                  : selectionRegisteredHotkeyRef.current) ?? payload.hotkey,
              message: t("settingsGeneralExtra.hotkey.applyFailed"),
            };
          }

          if (result.success) {
            const latestSettings = await getSettings({ reload: true });
            settingsRef.current = latestSettings;
            setSettings(latestSettings);
            emit(SETTINGS_UPDATED_EVENT).catch((error) => {
              logError(
                "HOTKEY_TRANSACTION",
                `requestId=${payload.requestId} target=${payload.target} stage=notify failed=${error}`,
              );
            });
          }

          emit(HOTKEY_REGISTRATION_RESULT_EVENT, result).catch((error) => {
            logError(
              "HOTKEY_TRANSACTION",
              `requestId=${payload.requestId} target=${payload.target} stage=result failed=${error}`,
            );
          });
        };

        transactionQueueRef.current = transactionQueueRef.current.then(
          runTransaction,
          runTransaction,
        );
      },
    );

    return () => {
      selectionHotkeyArmedRef.current = false;
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCaptureState.then((unlisten) => unlisten());
      unlistenHandyHotkey.then((unlisten) => unlisten());
      unlistenHotkeyRequests.then((unlisten) => unlisten());
      // The native manager owns registrations for the process lifetime and
      // drops them on shutdown. Unregistering here breaks shortcuts during
      // React Fast Refresh, because effect cleanup is also run for HMR.
    };
  }, []);
}
