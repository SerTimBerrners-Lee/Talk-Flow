import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import {
  IconCheck,
  IconCopy,
  IconLanguage,
  IconMicrophone,
  IconX,
} from "../../lib/icons";
import {
  TEXT_OVERLAY_EVENT,
  type WidgetTextOverlayState,
} from "./widgetConstants";

const EMPTY_STATE: WidgetTextOverlayState = {
  status: "copying",
  sourceText: "",
  translatedText: "",
  targetLanguage: "",
};

export function WidgetTextOverlay(): ReactElement | null {
  const [state, setState] = useState<WidgetTextOverlayState | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedResetTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const clearCopiedResetTimer = (): void => {
    if (!copiedResetTimerRef.current) {
      return;
    }

    window.clearTimeout(copiedResetTimerRef.current);
    copiedResetTimerRef.current = null;
  };

  useEffect(() => {
    let mounted = true;

    const applyPayload = (payload: WidgetTextOverlayState | null): void => {
      if (!mounted) {
        return;
      }

      if (!payload) {
        setState(null);
        clearCopiedResetTimer();
        setCopied(false);
        return;
      }

      setState({ ...EMPTY_STATE, ...payload });
      clearCopiedResetTimer();
      setCopied(false);
    };

    const loadCachedPayload = (): void => {
      void invoke<WidgetTextOverlayState | null>(
        "get_widget_text_overlay_payload",
      )
        .then(applyPayload)
        .catch(() => {});
    };

    const unlistenPromise = listen<WidgetTextOverlayState | null>(
      TEXT_OVERLAY_EVENT,
      (event) => {
        applyPayload(event.payload);
      },
    ).then((unlisten) => {
      loadCachedPayload();
      void invoke("widget_text_overlay_ready").catch(() => {});
      return unlisten;
    });

    const refreshFromCache = (): void => {
      loadCachedPayload();
    };
    const refreshWhenVisible = (): void => {
      if (document.visibilityState !== "hidden") {
        loadCachedPayload();
      }
    };

    loadCachedPayload();
    window.addEventListener("focus", refreshFromCache);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshFromCache);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      clearCopiedResetTimer();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const translatedText = state?.translatedText.trim() ?? "";
  const messageText = state?.message?.trim() ?? "";
  const isLoading =
    state?.status === "copying" ||
    (state?.status === "translating" && !translatedText) ||
    (state?.status === "dictating" && !translatedText);
  const visibleText =
    translatedText || (state?.status === "error" ? messageText : "");
  const LoadingIcon =
    state?.status === "dictating"
      ? IconMicrophone
      : state?.status === "translating"
        ? IconLanguage
        : IconCopy;
  const loadingLabel =
    state?.status === "dictating"
      ? "Слушаем"
      : state?.status === "translating"
        ? "Перевод"
        : "Копируем";

  useEffect(() => {
    if (!visibleText) {
      return;
    }

    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [visibleText]);

  useEffect(() => {
    if (!translatedText || state?.status !== "done") {
      return;
    }

    const timeout = window.setTimeout(() => {
      void invoke("hide_widget_text_overlay");
    }, 60_000);

    return () => window.clearTimeout(timeout);
  }, [state?.status, translatedText]);

  const close = (): void => {
    void invoke("hide_widget_text_overlay");
  };

  const copy = async (): Promise<void> => {
    if (!translatedText) {
      return;
    }

    try {
      await writeText(translatedText);
      clearCopiedResetTimer();
      setCopied(true);
      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedResetTimerRef.current = null;
      }, 1200);
    } catch {
      setCopied(false);
    }
  };

  if (!state || (!isLoading && !visibleText)) {
    return null;
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        padding: 0,
        boxSizing: "border-box",
        background:
          "linear-gradient(180deg, rgba(252,251,248,1) 0%, rgba(244,239,231,1) 100%)",
        overflow: "hidden",
        isolation: "isolate",
        borderRadius: 16,
        clipPath: "inset(0 round 16px)",
        WebkitClipPath: "inset(0 round 16px)",
        contain: "paint",
      }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background:
            "linear-gradient(180deg, rgba(252,251,248,1) 0%, rgba(244,239,231,1) 100%)",
          boxShadow: "none",
          color: "var(--text-hi)",
          animation: "widget-notice-in 0.22s var(--ease-standard)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            gap: 4,
            zIndex: 2,
          }}
        >
          <button
            type="button"
            aria-label="Скопировать текст"
            title="Скопировать текст"
            disabled={!translatedText}
            onClick={() => {
              void copy();
            }}
            style={{
              width: 22,
              height: 22,
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.78)",
              color: "var(--text-mid)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: translatedText ? "pointer" : "default",
              opacity: translatedText ? 1 : 0.45,
            }}
          >
            {copied ? (
              <IconCheck size={12} stroke={2.4} />
            ) : (
              <IconCopy size={12} stroke={2} />
            )}
          </button>
          <button
            type="button"
            aria-label="Закрыть плашку"
            title="Закрыть плашку"
            onClick={close}
            style={{
              width: 22,
              height: 22,
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.78)",
              color: "var(--text-mid)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <IconX size={12} stroke={2.2} />
          </button>
        </div>
        {isLoading ? (
          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--text-mid)",
              opacity: 0.58,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <LoadingIcon size={14} stroke={2.2} />
              <span>{loadingLabel}</span>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="widget-text-overlay-scroll"
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                overscrollBehavior: "contain",
                scrollbarGutter: "stable",
                padding: "1px 8px 2px 2px",
                boxSizing: "border-box",
                color: "var(--text-hi)",
                fontSize: 12,
                lineHeight: 1.45,
                fontWeight: 500,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  float: "right",
                  width: 56,
                  height: 29,
                  pointerEvents: "none",
                }}
              />
              {visibleText}
            </div>
            {state?.status === "error" && translatedText && messageText ? (
              <div
                style={{
                  flex: "0 0 auto",
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: "1px solid var(--border-subtle)",
                  color: "var(--text-low)",
                  fontSize: 10,
                  lineHeight: 1.35,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={messageText}
              >
                {messageText}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
