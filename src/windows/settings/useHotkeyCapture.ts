import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import {
  cancelHotkeyCapture,
  createHotkeyCaptureMachineState,
  hotkeyCaptureKeyDown,
  hotkeyCaptureKeyUp,
} from "../../lib/hotkeyCaptureMachine";
import {
  HOTKEY_CAPTURE_STATE_EVENT,
  HOTKEY_CHANGE_REQUEST_EVENT,
  HOTKEY_REGISTRATION_RESULT_EVENT,
  NATIVE_HOTKEY_CAPTURE_EVENT,
  type HotkeyRegistrationResultPayload,
  type HotkeyTarget,
  type NativeHotkeyCapturePayload,
} from "../../lib/hotkeyEvents";
import { isMacPlatform, normalizeHotkey } from "../../lib/store";
import { logError } from "../../lib/logger";

export type HotkeyFeedbackTone = "idle" | "success" | "error";

export interface HotkeyCaptureMessages {
  initial: string;
  applyFailed: string;
  saved: string;
  changeAgain: string;
  pressNew: string;
  releaseToApply: string;
  cancelledKept: string;
  needMainKey: string;
  invalid: string;
  recognizeFailed: string;
  checkingFree: string;
  sendFailed: string;
  startingCapture: string;
  pressNewCombo: string;
  captureStartFailed: string;
}

interface UseHotkeyCaptureOptions {
  target: HotkeyTarget;
  messages: HotkeyCaptureMessages;
  onApplied: (result: HotkeyRegistrationResultPayload) => Promise<void> | void;
  logTag: string;
}

interface UseHotkeyCaptureResult {
  surfaceRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  submitting: boolean;
  draft: string | null;
  feedback: string;
  tone: HotkeyFeedbackTone;
  start: () => Promise<void>;
  stop: (message?: string) => Promise<void>;
  submit: (candidate: string | null) => Promise<void>;
  resetFeedback: () => void;
  showIdleFeedback: (message: string) => void;
  handleSurfaceKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleSurfaceMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

function createRequestId(target: HotkeyTarget): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${target}-${crypto.randomUUID()}`;
  }
  return `${target}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useHotkeyCapture({
  target,
  messages,
  onApplied,
  logTag,
}: UseHotkeyCaptureOptions): UseHotkeyCaptureResult {
  const usesNativeCapture = isMacPlatform();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const machineRef = useRef(createHotkeyCaptureMachineState());
  const activeRef = useRef(false);
  const captureRequestIdRef = useRef<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAppliedRef = useRef(onApplied);
  const messagesRef = useRef(messages);

  const [active, setActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(messages.initial);
  const [tone, setTone] = useState<HotkeyFeedbackTone>("idle");

  useEffect(() => {
    onAppliedRef.current = onApplied;
    messagesRef.current = messages;
  }, [messages, onApplied]);

  const clearFeedbackTimer = useCallback((): void => {
    if (!feedbackTimerRef.current) return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  }, []);

  const setActiveValue = useCallback((value: boolean): void => {
    activeRef.current = value;
    setActive(value);
  }, []);

  const stop = useCallback(
    async (message?: string): Promise<void> => {
      const requestId = captureRequestIdRef.current;
      captureRequestIdRef.current = null;
      machineRef.current = createHotkeyCaptureMachineState();
      setActiveValue(false);
      setDraft(null);
      if (requestId) {
        await emit(HOTKEY_CAPTURE_STATE_EVENT, {
          requestId,
          target,
          active: false,
        }).catch(() => null);
      }
      if (usesNativeCapture && requestId) {
        await invoke("stop_native_hotkey_capture", { requestId, target }).catch(
          (error) => {
            void logError(
              logTag,
              `Failed to stop native hotkey capture: ${String(error)}`,
            );
          },
        );
      }
      if (message) {
        setTone("idle");
        setFeedback(message);
      }
    },
    [logTag, setActiveValue, target, usesNativeCapture],
  );

  const submit = useCallback(
    async (candidate: string | null): Promise<void> => {
      const requestId = captureRequestIdRef.current ?? createRequestId(target);
      await stop();

      if (!candidate) {
        setDraft(null);
        setTone("error");
        setFeedback(messagesRef.current.recognizeFailed);
        return;
      }

      const normalized = normalizeHotkey(candidate);
      if (!normalized.valid || !normalized.normalized) {
        setDraft(candidate);
        setTone("error");
        setFeedback(normalized.error || messagesRef.current.invalid);
        return;
      }

      pendingRequestIdRef.current = requestId;
      setSubmitting(true);
      setDraft(normalized.normalized);
      setTone("idle");
      setFeedback(messagesRef.current.checkingFree);

      try {
        await emit(HOTKEY_CHANGE_REQUEST_EVENT, {
          requestId,
          target,
          hotkey: normalized.normalized,
        });
      } catch (error) {
        pendingRequestIdRef.current = null;
        setSubmitting(false);
        setDraft(null);
        setTone("error");
        setFeedback(messagesRef.current.sendFailed);
        void logError(
          logTag,
          `Failed to emit hotkey request requestId=${requestId} target=${target}: ${String(error)}`,
        );
      }
    },
    [logTag, stop, target],
  );

  const start = useCallback(async (): Promise<void> => {
    if (activeRef.current || pendingRequestIdRef.current) return;

    clearFeedbackTimer();
    const requestId = createRequestId(target);
    captureRequestIdRef.current = requestId;
    machineRef.current = createHotkeyCaptureMachineState();
    setActiveValue(true);
    setDraft(null);
    setTone("idle");
    setFeedback(
      usesNativeCapture
        ? messagesRef.current.startingCapture
        : messagesRef.current.pressNewCombo,
    );
    await emit(HOTKEY_CAPTURE_STATE_EVENT, {
      requestId,
      target,
      active: true,
    }).catch(() => null);

    try {
      if (usesNativeCapture) {
        await invoke("start_native_hotkey_capture", { requestId, target });
      } else {
        window.setTimeout(() => surfaceRef.current?.focus(), 0);
      }
    } catch (error) {
      captureRequestIdRef.current = null;
      setActiveValue(false);
      setDraft(null);
      setTone("error");
      setFeedback(messagesRef.current.captureStartFailed);
      await emit(HOTKEY_CAPTURE_STATE_EVENT, {
        requestId,
        target,
        active: false,
      }).catch(() => null);
      void logError(
        logTag,
        `Failed to start native hotkey capture requestId=${requestId} target=${target}: ${String(error)}`,
      );
    }
  }, [clearFeedbackTimer, logTag, setActiveValue, target, usesNativeCapture]);

  useEffect(() => {
    const resultListener = listen<HotkeyRegistrationResultPayload>(
      HOTKEY_REGISTRATION_RESULT_EVENT,
      async ({ payload }) => {
        if (
          payload.target !== target ||
          payload.requestId !== pendingRequestIdRef.current
        ) {
          return;
        }

        pendingRequestIdRef.current = null;
        setSubmitting(false);
        setDraft(null);
        if (!payload.success) {
          setTone("error");
          setFeedback(payload.message || messagesRef.current.applyFailed);
          return;
        }

        await onAppliedRef.current(payload);
        setTone("success");
        setFeedback(messagesRef.current.saved);
        clearFeedbackTimer();
        feedbackTimerRef.current = setTimeout(() => {
          setTone("idle");
          setFeedback(messagesRef.current.changeAgain);
          feedbackTimerRef.current = null;
        }, 2200);
      },
    );

    const nativeListener = listen<NativeHotkeyCapturePayload>(
      NATIVE_HOTKEY_CAPTURE_EVENT,
      async ({ payload }) => {
        if (
          payload.target !== target ||
          payload.requestId !== captureRequestIdRef.current ||
          !activeRef.current
        ) {
          return;
        }

        if (payload.status === "listening") {
          setDraft(null);
          setTone("idle");
          setFeedback(payload.message || messagesRef.current.pressNew);
        } else if (payload.status === "preview") {
          setDraft(payload.hotkey || null);
          setTone("idle");
          setFeedback(payload.message || messagesRef.current.releaseToApply);
        } else if (payload.status === "cancelled") {
          await stop(messagesRef.current.cancelledKept);
        } else if (payload.status === "completed") {
          await submit(payload.hotkey?.trim() || null);
        }
      },
    );

    return () => {
      void resultListener.then((unlisten) => unlisten());
      void nativeListener.then((unlisten) => unlisten());
    };
  }, [clearFeedbackTimer, stop, submit, target]);

  useEffect(() => {
    if (!active || usesNativeCapture) return;

    const handleEffect = (
      effect: ReturnType<typeof hotkeyCaptureKeyDown>["effect"],
    ): void => {
      if (effect.type === "preview") {
        setDraft(effect.hotkey);
        setTone("idle");
        setFeedback(
          effect.hotkey
            ? messagesRef.current.releaseToApply
            : messagesRef.current.needMainKey,
        );
      } else if (effect.type === "completed") {
        void submit(effect.hotkey);
      } else if (effect.type === "rejected") {
        setDraft(effect.hotkey);
        setTone("error");
        setFeedback(messagesRef.current.needMainKey);
      } else if (effect.type === "cancelled") {
        void stop(messagesRef.current.cancelledKept);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const transition = hotkeyCaptureKeyDown(machineRef.current, event);
      machineRef.current = transition.state;
      handleEffect(transition.effect);
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const transition = hotkeyCaptureKeyUp(machineRef.current, event);
      machineRef.current = transition.state;
      handleEffect(transition.effect);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.setTimeout(() => surfaceRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [active, stop, submit, usesNativeCapture]);

  useEffect(() => {
    if (!active) return;
    const cancel = (): void => {
      machineRef.current = cancelHotkeyCapture().state;
      void stop(messagesRef.current.cancelledKept);
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "hidden") cancel();
    };
    const handleMouseDown = (event: MouseEvent): void => {
      if (
        surfaceRef.current &&
        !surfaceRef.current.contains(event.target as Node)
      ) {
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [active, stop]);

  useEffect(() => {
    return () => {
      clearFeedbackTimer();
      if (activeRef.current) void stop();
    };
  }, [clearFeedbackTimer, stop]);

  const handleSurfaceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (active || submitting) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      event.preventDefault();
      event.stopPropagation();
      void start();
    },
    [active, start, submitting],
  );

  const handleSurfaceMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!active && !submitting) void start();
    },
    [active, start, submitting],
  );

  const resetFeedback = useCallback((): void => {
    clearFeedbackTimer();
    setTone("idle");
    setFeedback("");
  }, [clearFeedbackTimer]);
  const showIdleFeedback = useCallback(
    (message: string): void => {
      clearFeedbackTimer();
      setTone("idle");
      setFeedback(message);
    },
    [clearFeedbackTimer],
  );

  return {
    surfaceRef,
    active,
    submitting,
    draft,
    feedback,
    tone,
    start,
    stop,
    submit,
    resetFeedback,
    showIdleFeedback,
    handleSurfaceKeyDown,
    handleSurfaceMouseDown,
  };
}
