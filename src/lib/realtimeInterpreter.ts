import { invoke } from "@tauri-apps/api/core";

export const REALTIME_INTERPRETER_STATUS_EVENT = "realtime_interpreter_status";
export const REALTIME_INTERPRETER_PARTIAL_TEXT_EVENT =
  "realtime_interpreter_partial_text";
export const REALTIME_INTERPRETER_AUDIO_LEVEL_EVENT =
  "realtime_interpreter_audio_level";
export const REALTIME_INTERPRETER_ERROR_EVENT = "realtime_interpreter_error";

export type RealtimeAudioDeviceKind =
  | "realMic"
  | "virtualMicOutput"
  | "localPlayback"
  | "systemAudio";

export interface RealtimeAudioDevice {
  id: string;
  label: string;
  kind: RealtimeAudioDeviceKind;
  platform: string;
  isDefault: boolean;
  isVirtual: boolean;
  driverHint?: string | null;
  supported: boolean;
}

export interface RealtimeAudioDevices {
  platform: string;
  virtualDriverName: string;
  realMics: RealtimeAudioDevice[];
  virtualMicOutputs: RealtimeAudioDevice[];
  localPlaybackOutputs: RealtimeAudioDevice[];
  systemAudioSources: RealtimeAudioDevice[];
  warnings: string[];
}

export type RealtimeLanguagePair = "ru_en";
export type RealtimeApiMode = "api" | "cloud";
export type RealtimeInterpreterState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "error";
export type RealtimeInterpreterDirection = "user_to_remote" | "remote_to_user";

export interface StartRealtimeInterpreterRequest {
  realMicDeviceId?: string | null;
  virtualMicOutputDeviceId: string;
  localPlaybackDeviceId?: string | null;
  languagePair: RealtimeLanguagePair;
  apiMode: RealtimeApiMode;
  apiKey?: string | null;
  deviceToken?: string | null;
  model?: string | null;
  endpoint?: string | null;
  headphonesConfirmed: boolean;
}

export interface RealtimeInterpreterDirectionStatus {
  state: RealtimeInterpreterState;
  reconnectAttempts: number;
  inputLevel: number;
  outputLevel: number;
  lastText?: string | null;
  lastError?: string | null;
}

export interface RealtimeInterpreterStatus {
  active: boolean;
  state: RealtimeInterpreterState;
  sessionId?: string | null;
  platform: string;
  startedAt?: string | null;
  languagePair: RealtimeLanguagePair;
  model: string;
  endpoint?: string | null;
  message?: string | null;
  lastError?: string | null;
  userToRemote: RealtimeInterpreterDirectionStatus;
  remoteToUser: RealtimeInterpreterDirectionStatus;
  estimatedCostUsdPerMinute: number;
  sessionRestartAt?: string | null;
}

export interface RealtimeInterpreterErrorEvent {
  sessionId?: string | null;
  code: string;
  message: string;
  recoverable: boolean;
}

export interface RealtimeInterpreterPartialTextEvent {
  sessionId?: string | null;
  direction: RealtimeInterpreterDirection;
  text: string;
  isFinal: boolean;
}

export interface RealtimeInterpreterAudioLevelEvent {
  sessionId?: string | null;
  direction: RealtimeInterpreterDirection;
  inputLevel: number;
  outputLevel: number;
}

export function listRealtimeAudioDevices(): Promise<RealtimeAudioDevices> {
  return invoke<RealtimeAudioDevices>("list_realtime_audio_devices");
}

export function getRealtimeInterpreterStatus(): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("get_realtime_interpreter_status");
}

export function startRealtimeInterpreter(
  req: StartRealtimeInterpreterRequest,
): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("start_realtime_interpreter", { req });
}

export function stopRealtimeInterpreter(): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("stop_realtime_interpreter");
}

export function testVirtualMicOutput(deviceId: string): Promise<void> {
  return invoke<void>("test_virtual_mic_output", {
    req: { deviceId },
  });
}
