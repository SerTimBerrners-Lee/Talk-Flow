export type WidgetState = "idle" | "recording" | "processing";
export type WidgetNoticeTone = "error" | "info";

export interface WidgetNoticeState {
  message: string;
  tone: WidgetNoticeTone;
}

export const MIN_RECORDING_DURATION_MS = 350;
export const MIN_AUDIO_BLOB_BYTES = 1024;
export const NOTICE_TIMEOUT_MS = 5000;
export const IDLE_WIDGET_WIDTH = 56;
export const IDLE_WIDGET_HEIGHT = 56;
export const RECORDING_WIDGET_WIDTH = 140;
export const RECORDING_WIDGET_HEIGHT = 48;
export const PROCESSING_WIDGET_SIZE = 40;
export const NOTICE_WIDGET_WIDTH = 228;
export const NOTICE_BUBBLE_HEIGHT = 52;
export const NOTICE_WIDGET_GAP = 10;
