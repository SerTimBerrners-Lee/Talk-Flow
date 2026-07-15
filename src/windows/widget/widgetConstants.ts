import type { LiveTranslationSegment } from "../../lib/store";

export type WidgetState = "idle" | "recording" | "processing";
export type WidgetNoticeTone = "error" | "info";

export interface WidgetNoticeState {
  message: string;
  tone: WidgetNoticeTone;
}

export const MIN_RECORDING_DURATION_MS = 500;
export const MIN_AUDIO_BLOB_BYTES = 1024;
export const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const NOTICE_TIMEOUT_MS = 5000;
export const WIDGET_SHELL_WIDTH = 74;
export const WIDGET_SHELL_HEIGHT = 22;
export const IDLE_HOVER_SCALE = 1;
export const ACTIVE_WIDGET_SHELL_WIDTH = WIDGET_SHELL_WIDTH * IDLE_HOVER_SCALE;
export const ACTIVE_WIDGET_SHELL_HEIGHT =
  WIDGET_SHELL_HEIGHT * IDLE_HOVER_SCALE;
export const IDLE_HOVER_WIDGET_WIDTH = ACTIVE_WIDGET_SHELL_WIDTH + 12;
export const IDLE_HOVER_WIDGET_HEIGHT = ACTIVE_WIDGET_SHELL_HEIGHT + 12;
export const IDLE_WIDGET_WIDTH = IDLE_HOVER_WIDGET_WIDTH;
export const IDLE_WIDGET_HEIGHT = IDLE_HOVER_WIDGET_HEIGHT;
export const RECORDING_WIDGET_WIDTH = IDLE_HOVER_WIDGET_WIDTH;
export const RECORDING_WIDGET_HEIGHT = IDLE_HOVER_WIDGET_HEIGHT;
export const CALL_BUBBLE_SIZE = WIDGET_SHELL_HEIGHT;
export const CALL_BUBBLE_GAP = 1;
export const CALL_STACK_WIDGET_WIDTH =
  IDLE_WIDGET_WIDTH + CALL_BUBBLE_GAP + CALL_BUBBLE_SIZE;
export const CALL_STACK_WIDGET_HEIGHT = IDLE_WIDGET_HEIGHT;
export const FILE_DROP_WIDGET_WIDTH = 236;
export const FILE_DROP_WIDGET_HEIGHT = 82;
export const FILE_DROP_STACK_WIDGET_WIDTH =
  FILE_DROP_WIDGET_WIDTH + CALL_BUBBLE_GAP + CALL_BUBBLE_SIZE;
export const FILE_DROP_STACK_WIDGET_HEIGHT = FILE_DROP_WIDGET_HEIGHT;
export const WIDGET_STACK_EDGE_PADDING = 10;

export function widgetStackWidth(
  fileDropActive: boolean,
  liveTranslationVisible = false,
): number {
  const baseWidth = fileDropActive
    ? FILE_DROP_STACK_WIDGET_WIDTH
    : CALL_STACK_WIDGET_WIDTH;

  return (
    baseWidth +
    Number(liveTranslationVisible) * (CALL_BUBBLE_GAP + CALL_BUBBLE_SIZE) +
    WIDGET_STACK_EDGE_PADDING * 2
  );
}

export function widgetStackHeight(fileDropActive: boolean): number {
  const baseHeight = fileDropActive
    ? FILE_DROP_STACK_WIDGET_HEIGHT
    : CALL_STACK_WIDGET_HEIGHT;

  return baseHeight + WIDGET_STACK_EDGE_PADDING * 2;
}

export const NOTICE_WIDGET_WIDTH = 212;
export const NOTICE_AREA_HEIGHT = 52;
/** Must match NOTICE_GAP in src-tauri/src/lib.rs (logical pixels). */
export const NOTICE_WIDGET_GAP = 2;
export const WIDGET_NOTICE_EVENT = "widget-notice:update";
export const TEXT_OVERLAY_WIDGET_WIDTH = 324;
export const TEXT_OVERLAY_WIDGET_HEIGHT = 118.1;
export const TEXT_OVERLAY_AUTO_DISMISS_MS = 10_000;
export const TEXT_OVERLAY_EVENT = "widget-text:update";

export type WidgetTextOverlayStatus =
  | "copying"
  | "dictating"
  | "inserting"
  | "translating"
  | "liveTranslation"
  | "done"
  | "error";

export function shouldAutoDismissTextOverlay(
  status: WidgetTextOverlayStatus,
): boolean {
  return status === "done" || status === "error";
}

export interface WidgetTextOverlayState {
  status: WidgetTextOverlayStatus;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  requestId?: string;
  message?: string;
  liveSegments?: LiveTranslationSegment[];
}
