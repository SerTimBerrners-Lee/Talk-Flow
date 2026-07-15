export const SETTINGS_UPDATED_EVENT = "settings-updated";
export const HISTORY_UPDATED_EVENT = "history-updated";
export const HISTORY_DELETED_EVENT = "history-deleted";
export const HISTORY_CLEARED_EVENT = "history-cleared";
export const HOTKEY_CHANGE_REQUEST_EVENT = "hotkey-change-request";
export const HOTKEY_REGISTRATION_RESULT_EVENT = "hotkey-registration-result";
export const NATIVE_HOTKEY_CAPTURE_EVENT = "native-hotkey-capture";
export const HOTKEY_CAPTURE_STATE_EVENT = "hotkey-capture-state";
export const HANDY_HOTKEY_EVENT = "handy-hotkey-event";
export const SETTINGS_NAVIGATE_EVENT = "settings-navigate";
export const WIDGET_RETRY_PROCESSING_EVENT = "widget-retry-processing";
export const PROCESSING_CANCEL_REQUEST_EVENT = "processing-cancel-request";
export const SELECTION_TEXT_REQUEST_EVENT = "selection-text-request";
export const SELECTION_TEXT_RESPONSE_EVENT = "selection-text-response";
export const DICTATION_STREAM_UPDATE_EVENT = "dictation-stream:update";

export type HotkeyTarget = "dictation" | "selection";

export interface HotkeyChangeRequestPayload {
  requestId: string;
  target: HotkeyTarget;
  hotkey: string;
}

export interface HotkeyRegistrationResultPayload {
  requestId: string;
  target: HotkeyTarget;
  success: boolean;
  requestedHotkey: string;
  activeHotkey: string;
  message?: string;
}

export interface NativeHotkeyCapturePayload {
  requestId: string;
  target: HotkeyTarget;
  status: "listening" | "preview" | "completed" | "cancelled" | "stopped";
  hotkey?: string | null;
  message?: string | null;
}

export interface HotkeyCaptureStatePayload {
  requestId: string;
  target: HotkeyTarget;
  active: boolean;
}

export interface HandyHotkeyEventPayload {
  hotkey: string;
  state: "Pressed" | "Released";
}

export interface SettingsNavigatePayload {
  tab: "main" | "file" | "interpreter" | "settings" | "model" | "style";
  resultId?: string | null;
}

export interface WidgetRetryProcessingPayload {
  active: boolean;
  source: "voice" | "call";
  entryId?: string;
}

export interface ProcessingCancelRequestPayload {
  entryId: string;
}

export interface SelectionTextRequestPayload {
  requestId: string;
}

export interface SelectionTextResponsePayload {
  requestId: string;
  text: string;
  sourceWindow: string;
}

export interface DictationStreamUpdatePayload {
  requestId: string;
  status: "started" | "partial" | "final" | "error";
  text: string;
  message?: string;
}
