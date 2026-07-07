import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  AppSettings,
  getSettings,
  getWidgetPosition,
  saveWidgetPosition,
} from "../../../lib/store";
import { tn } from "../../../lib/i18n";
import { logError, logInfo } from "../../../lib/logger";
import {
  SELECTION_TEXT_REQUEST_EVENT,
  SELECTION_TEXT_RESPONSE_EVENT,
  type SelectionTextResponsePayload,
} from "../../../lib/hotkeyEvents";
import { formatErrorMessage } from "../../../lib/utils";
import {
  DEFAULT_WIDGET_SCALE,
  normalizeWidgetScale,
  scaleWidgetDimension,
} from "../../../lib/widgetScale";
import {
  CALL_STACK_WIDGET_HEIGHT,
  CALL_STACK_WIDGET_WIDTH,
  WidgetNoticeState,
  WidgetState,
} from "../widgetConstants";
import { resolveInitialWidgetPosition } from "../widgetPositioning";
import { useWidgetHotkey } from "./useWidgetHotkey";
import { useWidgetNotice } from "./useWidgetNotice";
import { useWidgetRecording } from "./useWidgetRecording";
import {
  selectionTranslationLanguageLabel,
  translateSelectedText,
  type SelectionTranslationProgress,
} from "../services/selectionTranslation";
import type { WidgetTextOverlayStatus } from "../widgetConstants";
import {
  initialWidgetMachineState,
  widgetReducer,
  WidgetAction,
  WidgetEffect,
  WidgetMachineState,
} from "../services/widgetMachine";

interface WidgetControllerOptions {
  onVoiceRecordingProcessing?: () => void;
  onVoiceRecordingStart?: () => void;
  onVoiceRecordingStartFailed?: () => void;
}

interface ResizeWidgetOptions {
  growthOffsetRatio?: number;
}

interface WidgetControllerState {
  state: WidgetState;
  stream: MediaStream | null;
  notice: WidgetNoticeState | null;
  lockedRecording: boolean;
  widgetScale: number;
  resizeWidget: (
    width: number,
    height: number,
    options?: ResizeWidgetOptions,
  ) => Promise<void>;
  toggleManualRecording: () => void;
}

export function useWidgetController({
  onVoiceRecordingProcessing,
  onVoiceRecordingStart,
  onVoiceRecordingStartFailed,
}: WidgetControllerOptions = {}): WidgetControllerState {
  const widgetWindow = getCurrentWindow();

  // ── Centralized machine state ───────────────────────────────────────────
  const machineRef = useRef<WidgetMachineState>(initialWidgetMachineState);

  // React render state (derived from machine)
  const [widgetState, setWidgetState] = useState<WidgetState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [lockedRecording, setLockedRecording] = useState(false);
  const [widgetScale, setWidgetScale] = useState(DEFAULT_WIDGET_SCALE);

  // Settings
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsRef = useRef<AppSettings | null>(null);

  // Imperative refs (truly need ref semantics)
  const registeredHotkeyRef = useRef<string | null>(null);
  const releaseStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const moveSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionReadyRef = useRef(false);
  const widgetScaleRef = useRef(DEFAULT_WIDGET_SCALE);
  const widgetBaseSizeRef = useRef<{ width: number; height: number }>({
    width: CALL_STACK_WIDGET_WIDTH,
    height: CALL_STACK_WIDGET_HEIGHT,
  });
  const widgetSizeRef = useRef<{ width: number; height: number }>({
    width: scaleWidgetDimension(CALL_STACK_WIDGET_WIDTH, DEFAULT_WIDGET_SCALE),
    height: scaleWidgetDimension(
      CALL_STACK_WIDGET_HEIGHT,
      DEFAULT_WIDGET_SCALE,
    ),
  });
  const stopAndProcessRef = useRef<() => Promise<void>>(async () => {});
  const selectionTranslationBusyRef = useRef(false);

  // ── Dispatch: apply action → update machine state → execute effects ─────
  const dispatch = useCallback((action: WidgetAction) => {
    const { state: nextState, effects } = widgetReducer(
      machineRef.current,
      action,
    );
    machineRef.current = nextState;

    // Sync React render state
    setWidgetState(nextState.widgetState);
    setLockedRecording(nextState.lockedRecording);

    // Execute effects (processed in executeEffect below)
    for (const effect of effects) {
      executeEffect(effect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Effect executor ─────────────────────────────────────────────────────
  const executeEffect = useCallback((effect: WidgetEffect) => {
    switch (effect.type) {
      case "start_recording":
        void startRecordingRef.current();
        break;
      case "stop_and_process":
        void stopAndProcessRef.current();
        break;
      case "schedule_release_stop_timer":
        scheduleReleaseStopTimer();
        break;
      case "clear_release_stop_timer":
        clearReleaseStopTimer();
        break;
      case "resize_widget":
        void resizeWidget(effect.width, effect.height);
        break;
      case "set_stream":
        setStream(effect.stream);
        break;
      case "show_notice":
        showNotice(effect.message, effect.tone);
        break;
      case "set_locked_recording_ui":
        setLockedRecording(effect.value);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer helpers ───────────────────────────────────────────────────────
  const clearReleaseStopTimer = useCallback(() => {
    if (!releaseStopTimerRef.current) return;
    clearTimeout(releaseStopTimerRef.current);
    releaseStopTimerRef.current = null;
  }, []);

  const scheduleReleaseStopTimer = useCallback(() => {
    clearReleaseStopTimer();
    const doubleTapTimeout = settingsRef.current?.doubleTapTimeout ?? 400;
    releaseStopTimerRef.current = setTimeout(() => {
      releaseStopTimerRef.current = null;
      dispatch({ type: "RELEASE_STOP_TIMER_FIRED" });
    }, doubleTapTimeout);
  }, [clearReleaseStopTimer, dispatch]);

  const clearMoveSaveTimer = useCallback(() => {
    if (!moveSaveTimerRef.current) return;
    clearTimeout(moveSaveTimerRef.current);
    moveSaveTimerRef.current = null;
  }, []);

  // ── Settings loading ────────────────────────────────────────────────────
  useEffect(() => {
    logInfo("SETTINGS", "Loading settings...");
    getSettings()
      .then((loadedSettings) => {
        logInfo(
          "SETTINGS",
          `Loaded: apiKey=${loadedSettings.apiKey ? "[set]" : "[empty]"}, hotkey=${loadedSettings.hotkey}`,
        );
        setSettings(loadedSettings);
        settingsRef.current = loadedSettings;
        setSettingsLoaded(true);
      })
      .catch((error) => {
        logError("SETTINGS", `Failed to load: ${error}`);
        setSettingsLoaded(true);
      });
  }, []);

  // ── Position tracking ───────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    widgetWindow
      .onMoved(({ payload }) => {
        if (!positionReadyRef.current) return;
        clearMoveSaveTimer();
        moveSaveTimerRef.current = setTimeout(() => {
          moveSaveTimerRef.current = null;
          void saveWidgetPosition({ x: payload.x, y: payload.y }).catch(
            (error) => {
              if (!disposed) {
                logError(
                  "WIDGET",
                  `Failed to save widget position: ${formatErrorMessage(error)}`,
                );
              }
            },
          );
        }, 120);
      })
      .then((removeListener) => {
        if (disposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        if (!disposed) {
          logError(
            "WIDGET",
            `Failed to track widget movement: ${formatErrorMessage(error)}`,
          );
        }
      });

    return () => {
      disposed = true;
      clearMoveSaveTimer();
      unlisten?.();
    };
  }, [clearMoveSaveTimer, widgetWindow]);

  useEffect(() => {
    let cancelled = false;

    const restoreWidgetPosition = async () => {
      try {
        const savedPosition = await getWidgetPosition();
        const targetPosition = await resolveInitialWidgetPosition(
          widgetWindow,
          savedPosition,
        );
        if (!targetPosition || cancelled) return;

        await widgetWindow.setPosition(
          new PhysicalPosition(targetPosition.x, targetPosition.y),
        );

        if (!savedPosition) {
          await saveWidgetPosition(targetPosition);
        }
      } catch (error) {
        if (!cancelled) {
          logError(
            "WIDGET",
            `Failed to restore widget position: ${formatErrorMessage(error)}`,
          );
        }
      } finally {
        if (!cancelled) {
          positionReadyRef.current = true;
        }
      }
    };

    void restoreWidgetPosition();
    return () => {
      cancelled = true;
    };
  }, [widgetWindow]);

  // ── Widget resize ───────────────────────────────────────────────────────
  const resizeWidget = useCallback(
    async (
      width: number,
      height: number,
      options: ResizeWidgetOptions = {},
    ) => {
      try {
        const scale = normalizeWidgetScale(widgetScaleRef.current);
        const scaledWidth = scaleWidgetDimension(width, scale);
        const scaledHeight = scaleWidgetDimension(height, scale);
        const currentBaseSize = widgetBaseSizeRef.current;
        const currentSize = widgetSizeRef.current;

        if (
          currentBaseSize.width === width &&
          currentBaseSize.height === height &&
          currentSize.width === scaledWidth &&
          currentSize.height === scaledHeight
        ) {
          return;
        }

        const resizePayload: {
          width: number;
          height: number;
          growthOffsetRatio?: number;
        } = {
          width: scaledWidth,
          height: scaledHeight,
        };

        if (options.growthOffsetRatio !== undefined) {
          resizePayload.growthOffsetRatio = options.growthOffsetRatio;
        }

        await invoke("widget_resize", resizePayload);
        widgetBaseSizeRef.current = { width, height };
        widgetSizeRef.current = { width: scaledWidth, height: scaledHeight };
      } catch (error) {
        logError("WIDGET", `Resize failed: ${formatErrorMessage(error)}`);
      }
    },
    [],
  );

  useEffect(() => {
    if (!settings) {
      return;
    }

    const nextScale = normalizeWidgetScale(settings.widgetScale);
    setWidgetScale(nextScale);

    if (widgetScaleRef.current === nextScale) {
      return;
    }

    widgetScaleRef.current = nextScale;
    const baseSize = widgetBaseSizeRef.current;
    void resizeWidget(baseSize.width, baseSize.height, {
      growthOffsetRatio: 0,
    });
  }, [resizeWidget, settings?.widgetScale]);

  // ── Notice ──────────────────────────────────────────────────────────────
  const machineStateRefForNotice = useRef(machineRef);
  machineStateRefForNotice.current = machineRef;

  const stateRefForNotice = useRef<WidgetState>("idle");
  useEffect(() => {
    stateRefForNotice.current = widgetState;
  }, [widgetState]);

  const { showNotice, hideNotice } = useWidgetNotice({
    stateRef: stateRefForNotice,
  });

  // ── Error handler ───────────────────────────────────────────────────────
  const showError = useCallback(
    (message: string) => {
      logError("WIDGET", message);
      dispatch({ type: "ERROR", message });
    },
    [dispatch],
  );

  const showSelectionTextOverlay = useCallback(
    (payload: {
      status: WidgetTextOverlayStatus;
      sourceText?: string;
      translatedText?: string;
      targetLanguage?: string;
      message?: string;
    }): void => {
      void invoke("show_widget_text_overlay", {
        payload: {
          status: payload.status,
          sourceText: payload.sourceText ?? "",
          translatedText: payload.translatedText ?? "",
          targetLanguage: payload.targetLanguage ?? "",
          ...(payload.message ? { message: payload.message } : {}),
        },
      }).catch((error) => {
        logError(
          "TRANSLATION",
          `Failed to show text overlay: ${formatErrorMessage(error)}`,
        );
      });
    },
    [],
  );

  const hideSelectionTextOverlay = useCallback((): void => {
    void invoke("hide_widget_text_overlay").catch((error) => {
      logError(
        "TRANSLATION",
        `Failed to hide text overlay: ${formatErrorMessage(error)}`,
      );
    });
  }, []);

  const requestTalkisSelectedText = useCallback((): Promise<string> => {
    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    return new Promise((resolve) => {
      let settled = false;
      let dispose: (() => void) | null = null;
      let timeoutId: number | null = null;

      const finish = (text: string): void => {
        if (settled) return;
        settled = true;
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
        dispose?.();
        resolve(text);
      };

      const unlistenPromise = listen<SelectionTextResponsePayload>(
        SELECTION_TEXT_RESPONSE_EVENT,
        ({ payload }) => {
          if (payload.requestId !== requestId) return;
          if (payload.text.trim()) {
            logInfo(
              "TRANSLATION",
              `Using selected text from ${payload.sourceWindow}, chars=${payload.text.trim().length}`,
            );
            finish(payload.text);
          }
        },
      );

      timeoutId = window.setTimeout(() => finish(""), 160);

      unlistenPromise
        .then((unlisten) => {
          if (settled) {
            unlisten();
            return;
          }
          dispose = unlisten;
          void emit(SELECTION_TEXT_REQUEST_EVENT, { requestId }).catch(() => {
            finish("");
          });
        })
        .catch(() => finish(""));
    });
  }, []);

  const translateSelectionFromHotkey = useCallback(async (): Promise<void> => {
    if (selectionTranslationBusyRef.current) {
      return;
    }

    if (machineRef.current.widgetState !== "idle") {
      return;
    }

    selectionTranslationBusyRef.current = true;

    try {
      const activeSettings =
        settingsRef.current ?? (await getSettings({ reload: true }));
      settingsRef.current = activeSettings;
      const targetLanguage = selectionTranslationLanguageLabel(
        activeSettings.translation.selectionTargetLanguage,
      );

      if (!activeSettings.translation.selectionEnabled) {
        return;
      }

      let selectedText = await requestTalkisSelectedText();

      if (!selectedText.trim()) {
        showSelectionTextOverlay({
          status: "copying",
          targetLanguage,
        });

        await invoke("remember_paste_target_window").catch((error) => {
          logError(
            "PASTE",
            `Failed to remember selection translation target: ${formatErrorMessage(error)}`,
          );
        });

        try {
          selectedText = await invoke<string>("copy_selected_text");
        } catch (error) {
          logError(
            "TRANSLATION",
            `Failed to copy selected text: ${formatErrorMessage(error)}`,
          );
          const message = formatErrorMessage(error);
          const hasNoSelection = /no selected text/i.test(message);
          const visibleMessage = hasNoSelection
            ? tn("widget.selectionTranslation.noSelection")
            : tn("widget.selectionTranslation.copyFailed");

          if (hasNoSelection) {
            hideSelectionTextOverlay();
          } else {
            showSelectionTextOverlay({
              status: "error",
              targetLanguage,
              message: visibleMessage,
            });
          }
          showError(visibleMessage);
          return;
        }
      }

      if (!selectedText.trim()) {
        hideSelectionTextOverlay();
        showError(tn("widget.selectionTranslation.noSelection"));
        return;
      }

      showSelectionTextOverlay({
        status: "translating",
        sourceText: selectedText,
        targetLanguage,
      });

      const translatedText = await translateSelectedText({
        text: selectedText,
        settings: activeSettings,
        onProgress: (progress: SelectionTranslationProgress) => {
          showSelectionTextOverlay({
            status: "translating",
            sourceText: progress.sourceText,
            translatedText: progress.translatedText,
            targetLanguage,
          });
        },
      });

      if (!translatedText.trim()) {
        showSelectionTextOverlay({
          status: "error",
          sourceText: selectedText,
          targetLanguage,
          message: tn("widget.selectionTranslation.emptyResult"),
        });
        showError(tn("widget.selectionTranslation.emptyResult"));
        return;
      }

      showSelectionTextOverlay({
        status: "done",
        sourceText: selectedText,
        translatedText,
        targetLanguage,
      });
    } catch (error) {
      showSelectionTextOverlay({
        status: "error",
        message: formatErrorMessage(error),
      });
      showError(formatErrorMessage(error));
    } finally {
      selectionTranslationBusyRef.current = false;
    }
  }, [
    hideSelectionTextOverlay,
    requestTalkisSelectedText,
    showError,
    showSelectionTextOverlay,
  ]);

  // ── Recording ───────────────────────────────────────────────────────────
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});

  const { startRecording } = useWidgetRecording({
    settings,
    machineRef,
    dispatch,
    setStream,
    resizeWidget,
    showError,
    showNotice,
    hideNotice,
    stopAndProcessRef,
    onRecordingProcessing: onVoiceRecordingProcessing,
    onRecordingStart: onVoiceRecordingStart,
    onRecordingStartFailed: onVoiceRecordingStartFailed,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // ── Hotkey ──────────────────────────────────────────────────────────────
  useWidgetHotkey({
    settingsLoaded,
    settings,
    setSettings,
    settingsRef,
    machineRef,
    dispatch,
    registeredHotkeyRef,
    showError,
    onSelectionTranslationHotkey: () => {
      void translateSelectionFromHotkey();
    },
  });

  const toggleManualRecording = useCallback(() => {
    const currentState = machineRef.current.widgetState;

    if (currentState === "idle") {
      dispatch({ type: "MANUAL_RECORDING_START" });
      return;
    }

    if (currentState === "recording") {
      dispatch({ type: "MANUAL_RECORDING_STOP" });
    }
  }, [dispatch]);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearReleaseStopTimer();
      clearMoveSaveTimer();
    };
  }, [clearMoveSaveTimer, clearReleaseStopTimer]);

  return {
    state: widgetState,
    stream,
    notice: null,
    lockedRecording,
    widgetScale,
    resizeWidget,
    toggleManualRecording,
  };
}
