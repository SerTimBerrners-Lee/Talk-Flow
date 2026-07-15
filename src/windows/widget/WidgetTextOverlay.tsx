import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLanguage,
  IconMicrophone,
  IconX,
} from "../../lib/icons";
import { SETTINGS_UPDATED_EVENT } from "../../lib/hotkeyEvents";
import { applySavedTheme } from "../../lib/theme";
import {
  shouldAutoDismissTextOverlay,
  TEXT_OVERLAY_AUTO_DISMISS_MS,
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
  const overlayWindow = getCurrentWindow();
  const [state, setState] = useState<WidgetTextOverlayState | null>(null);
  const [copied, setCopied] = useState(false);
  const [followingLatest, setFollowingLatest] = useState(true);
  const copiedResetTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragTriggeredRef = useRef(false);
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
        setFollowingLatest(true);
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

  useEffect(() => {
    const syncTheme = (): void => {
      void applySavedTheme();
    };
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, syncTheme);

    syncTheme();
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const translatedText = state?.translatedText.trim() ?? "";
  const liveSegments = state?.liveSegments ?? [];
  const translatedLiveSegments = liveSegments.filter((segment) =>
    Boolean(segment.translated.trim()),
  );
  const liveCopyText = translatedLiveSegments
    .map((segment) => segment.translated.trim())
    .join("\n\n");
  const messageText = state?.message?.trim() ?? "";
  const isLoading =
    state?.status === "copying" ||
    (state?.status === "translating" && !translatedText) ||
    (state?.status === "dictating" && !translatedText) ||
    (state?.status === "liveTranslation" && !liveCopyText && !messageText);
  const visibleText =
    liveCopyText ||
    translatedText ||
    (state?.status === "error" || state?.status === "liveTranslation"
      ? messageText
      : "");
  const LoadingIcon =
    state?.status === "dictating"
      ? IconMicrophone
      : state?.status === "translating" || state?.status === "liveTranslation"
        ? IconLanguage
        : IconCopy;
  const loadingLabel =
    state?.status === "dictating"
      ? "Слушаем"
      : state?.status === "translating" || state?.status === "liveTranslation"
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

    const frame = window.requestAnimationFrame(() => {
      if (followingLatest) {
        node.scrollTop = node.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followingLatest, visibleText]);

  useEffect(() => {
    setFollowingLatest(true);
  }, [state?.requestId]);

  const handleScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    setFollowingLatest(distanceFromBottom <= 20);
  };

  const scrollToLatest = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setFollowingLatest(true);
  };

  useEffect(() => {
    if (
      !visibleText ||
      !state?.status ||
      !shouldAutoDismissTextOverlay(state.status)
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void invoke("hide_widget_text_overlay");
    }, TEXT_OVERLAY_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeout);
  }, [state?.requestId, state?.status, visibleText]);

  const handleDragPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragTriggeredRef.current = false;
  };

  const handleDragPointerMove = async (
    event: ReactPointerEvent<HTMLDivElement>,
  ): Promise<void> => {
    if (
      !dragStartRef.current ||
      dragTriggeredRef.current ||
      (event.buttons & 1) === 0
    ) {
      return;
    }

    const deltaX = Math.abs(event.clientX - dragStartRef.current.x);
    const deltaY = Math.abs(event.clientY - dragStartRef.current.y);
    if (deltaX < 4 && deltaY < 4) {
      return;
    }

    dragTriggeredRef.current = true;
    try {
      await overlayWindow.startDragging();
    } catch {
      dragTriggeredRef.current = false;
    }
  };

  const handleDragPointerEnd = (): void => {
    dragStartRef.current = null;
    dragTriggeredRef.current = false;
  };

  const close = (): void => {
    void invoke("hide_widget_text_overlay");
  };

  const copy = async (): Promise<void> => {
    const textToCopy = liveCopyText || translatedText;
    if (!textToCopy) {
      return;
    }

    try {
      await writeText(textToCopy);
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
          "linear-gradient(180deg, var(--app-gradient-start) 0%, var(--app-gradient-end) 100%)",
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
        onPointerDown={handleDragPointerDown}
        onPointerMove={(event) => {
          void handleDragPointerMove(event);
        }}
        onPointerUp={handleDragPointerEnd}
        onPointerCancel={handleDragPointerEnd}
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
            "linear-gradient(180deg, var(--app-gradient-start) 0%, var(--app-gradient-end) 100%)",
          boxShadow: "none",
          color: "var(--text-hi)",
          animation: "widget-notice-in 0.22s var(--ease-standard)",
          position: "relative",
          cursor: "grab",
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
            disabled={!visibleText}
            onClick={() => {
              void copy();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              width: 22,
              height: 22,
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "var(--control-bg)",
              color: "var(--text-mid)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: visibleText ? "pointer" : "default",
              opacity: visibleText ? 1 : 0.45,
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
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              width: 22,
              height: 22,
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "var(--control-bg)",
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
              onScroll={handleScroll}
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
                lineHeight: 1.55,
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
              {state.status === "liveTranslation" ? (
                <div>
                  {translatedLiveSegments.length === 0 && messageText ? (
                    <div style={{ color: "var(--text-mid)", fontWeight: 600 }}>
                      {messageText}
                    </div>
                  ) : null}
                  {translatedLiveSegments.map((segment, index) => (
                    <div
                      key={`${segment.channel}-${segment.startedAtMs}-${index}`}
                      style={{
                        minWidth: 0,
                        padding: index === 0 ? "1px 2px 5px" : "5px 2px",
                        borderTop:
                          index === 0
                            ? "none"
                            : "1px solid var(--border-subtle)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          marginBottom: 1,
                          fontSize: 10,
                          lineHeight: 1.3,
                          fontWeight: 750,
                          color: "var(--text-low)",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 5,
                            height: 5,
                            flex: "0 0 auto",
                            borderRadius: "50%",
                            background:
                              segment.channel === "mic"
                                ? "var(--success)"
                                : "var(--accent)",
                          }}
                        />
                        {segment.channel === "mic" ? "Вы" : "Системный звук"}
                      </div>
                      <div
                        style={{
                          minWidth: 0,
                          fontSize: 12,
                          lineHeight: 1.55,
                          fontWeight: 550,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {segment.translated.slice(
                          0,
                          segment.stableTranslatedLength ??
                            segment.translated.length,
                        )}
                        {segment.stableTranslatedLength !== undefined ? (
                          <span style={{ opacity: 0.62 }}>
                            {segment.translated.slice(
                              segment.stableTranslatedLength,
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : visibleText}
            </div>
            {!followingLatest && state.status === "liveTranslation" ? (
              <button
                type="button"
                aria-label="Перейти к последнему переводу"
                title="К последнему переводу"
                onClick={scrollToLatest}
                onPointerDown={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  right: 10,
                  bottom: 8,
                  height: 24,
                  padding: "0 8px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  background: "var(--control-bg)",
                  color: "var(--text-mid)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <IconChevronDown size={11} stroke={2.2} />
                К последнему
              </button>
            ) : null}
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
