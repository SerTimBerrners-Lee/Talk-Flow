import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { IconCheck, IconCopy, IconX } from "../../lib/icons";
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

  const clearCopiedResetTimer = (): void => {
    if (!copiedResetTimerRef.current) {
      return;
    }

    window.clearTimeout(copiedResetTimerRef.current);
    copiedResetTimerRef.current = null;
  };

  useEffect(() => {
    let mounted = true;

    void invoke<WidgetTextOverlayState | null>(
      "get_widget_text_overlay_payload",
    )
      .then((payload) => {
        if (mounted && payload) {
          setState({ ...EMPTY_STATE, ...payload });
        }
      })
      .catch(() => {});

    const unlistenPromise = listen<WidgetTextOverlayState>(
      TEXT_OVERLAY_EVENT,
      (event) => {
        if (!mounted) {
          return;
        }

        setState({ ...EMPTY_STATE, ...event.payload });
        clearCopiedResetTimer();
        setCopied(false);
      },
    );

    return () => {
      mounted = false;
      clearCopiedResetTimer();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const translatedText = state?.translatedText.trim() ?? "";

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

  if (!translatedText) {
    return null;
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        padding: 8,
        boxSizing: "border-box",
        background: "transparent",
        overflow: "hidden",
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
            "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(244,239,231,0.97) 100%)",
          boxShadow: "var(--shadow-panel)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          color: "var(--text-hi)",
          animation: "widget-notice-in 0.22s var(--ease-standard)",
        }}
      >
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
            padding: "0 3px 2px 2px",
            boxSizing: "border-box",
            color: "var(--text-hi)",
            fontSize: 12,
            lineHeight: 1.45,
            fontWeight: 500,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <div
            style={{
              float: "right",
              display: "flex",
              gap: 4,
              margin: "0 0 5px 7px",
            }}
          >
            <button
              type="button"
              aria-label="Скопировать перевод"
              title="Скопировать перевод"
              onClick={() => {
                void copy();
              }}
              style={{
                width: 22,
                height: 22,
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.72)",
                color: "var(--text-mid)",
                display: "grid",
                placeItems: "center",
                padding: 0,
                cursor: "pointer",
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
              aria-label="Закрыть перевод"
              title="Закрыть перевод"
              onClick={close}
              style={{
                width: 22,
                height: 22,
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.72)",
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
          {translatedText}
        </div>
      </div>
    </div>
  );
}
