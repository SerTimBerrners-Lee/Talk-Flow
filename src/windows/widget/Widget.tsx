import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Bell } from "lucide-react";

import { Waveform } from "../../components/Waveform";
import { useWidgetController } from "./hooks/useWidgetController";
import { IDLE_WIDGET_HEIGHT, IDLE_WIDGET_WIDTH, NOTICE_WIDGET_GAP, WidgetNoticeState } from "./widgetConstants";

export function Widget() {
  const { state, stream, notice, lockedRecording } = useWidgetController();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        background: "transparent",
        overflow: "visible",
        pointerEvents: "none",
        position: "relative",
        paddingBottom: 2,
      }}
    >
      {notice && <WidgetNotice message={notice.message} tone={notice.tone} />}
      {state === "idle" && <IdlePill />}
      {state === "recording" && <RecordingPill stream={stream} locked={lockedRecording} />}
      {state === "processing" && <ProcessingPill />}
    </div>
  );
}

function WidgetNotice({ message, tone }: WidgetNoticeState) {
  const Icon = tone === "error" ? AlertCircle : Bell;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `calc(100% - ${NOTICE_WIDGET_GAP + 2}px)`,
        left: "50%",
        transform: "translateX(-50%)",
        width: 212,
        minHeight: 52,
        padding: "10px 34px 10px 14px",
        borderRadius: 16,
        fontSize: 11,
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        color: "rgba(0,0,0,0.82)",
        background: "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(244,239,231,0.96) 100%)",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        pointerEvents: "none",
        animation: "widget-notice-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: tone === "error" ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.72)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={11} strokeWidth={2.2} />
      </div>
      {message}
    </div>
  );
}

function IdlePill() {
  return (
    <div
      style={{
        width: IDLE_WIDGET_WIDTH,
        height: IDLE_WIDGET_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        cursor: "pointer",
        pointerEvents: "auto",
      }}
      onClick={() => invoke("open_settings")}
    >
      <div
        style={{
          width: 38,
          height: 16,
          borderRadius: 999,
          background: "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(245,241,234,0.98) 100%)",
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
        }}
      />
    </div>
  );
}

interface RecordingPillProps {
  stream: MediaStream | null;
  locked: boolean;
}

function ActiveWidgetShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 96,
        height: 28,
        borderRadius: 999,
        background: "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(245,241,234,0.96) 100%)",
        border: "1px solid rgba(0,0,0,0.1)",
        boxShadow: "0 14px 28px rgba(0,0,0,0.14)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 10px",
        pointerEvents: "auto",
        transformOrigin: "center center",
        transition:
          "width 0.18s ease, height 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function RecordingPill({ stream, locked }: RecordingPillProps) {
  return (
    <ActiveWidgetShell>
      <div
        style={{
          width: "100%",
          height: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingRight: locked ? 4 : 0,
        }}
      >
        <Waveform stream={stream} isActive={true} />
        {locked && (
          <span
            style={{
              width: 6,
              height: 6,
              flexShrink: 0,
              borderRadius: 999,
              background: "#d92d20",
              boxShadow: "0 0 0 3px rgba(217,45,32,0.14)",
            }}
          />
        )}
      </div>
    </ActiveWidgetShell>
  );
}

function ProcessingPill() {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 999,
        background: "linear-gradient(180deg, rgba(252,251,248,0.98) 0%, rgba(244,239,231,0.96) 100%)",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 3,
          height: 8,
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              width: 3,
              height: 3,
              borderRadius: 999,
              background: index === 1 ? "rgba(0,0,0,0.82)" : "rgba(0,0,0,0.46)",
              animation: `widget-processing-dot 0.72s ease-in-out ${index * 0.12}s infinite`,
              boxShadow: index === 1 ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}
