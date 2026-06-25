import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { NOTICE_AREA_HEIGHT, NOTICE_WIDGET_WIDTH, WIDGET_NOTICE_EVENT, type WidgetNoticeState } from "./widgetConstants";

export function WidgetNoticeOverlay(): ReactElement | null {
  const [notice, setNotice] = useState<WidgetNoticeState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const unlistenPromise = listen<WidgetNoticeState>(WIDGET_NOTICE_EVENT, (event) => {
      if (!mounted) {
        return;
      }

      // A fresh notice always starts collapsed (Rust re-shows it at the small size).
      setExpanded(false);
      setNotice(event.payload);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Resize the OS window to fit the bubble whenever the expanded state (or the
  // message) changes. scrollHeight is measured after React has dropped the
  // line-clamp, so it reflects the full text height including padding.
  useLayoutEffect(() => {
    if (!notice) {
      return;
    }
    const height = expanded && bubbleRef.current
      ? bubbleRef.current.scrollHeight
      : NOTICE_AREA_HEIGHT;
    void invoke("expand_widget_notice", { height });
  }, [expanded, notice]);

  if (!notice) {
    return null;
  }

  const toggleExpanded = () => {
    setExpanded((value) => !value);
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        ref={bubbleRef}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggleExpanded}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          toggleExpanded();
        }}
        style={{
          position: "relative",
          width: NOTICE_WIDGET_WIDTH,
          minHeight: NOTICE_AREA_HEIGHT,
          maxHeight: expanded ? "100vh" : NOTICE_AREA_HEIGHT,
          padding: "10px 14px",
          borderRadius: 16,
          fontSize: 11,
          lineHeight: 1.4,
          letterSpacing: "0.01em",
          color: "rgba(0,0,0,0.82)",
          background: "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(244,239,231,0.96) 100%)",
          border: "1px solid rgba(0,0,0,0.08)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          animation: "widget-notice-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
          overflowY: expanded ? "auto" : "hidden",
          overflowX: "hidden",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        <div
          style={
            expanded
              ? { paddingRight: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingRight: 4,
                }
          }
        >
          {notice.message}
        </div>
      </div>
    </div>
  );
}
