import { invoke } from "@tauri-apps/api/core";

export const REALTIME_INTERPRETER_STATUS_EVENT = "realtime_interpreter_status";
export const REALTIME_INTERPRETER_PARTIAL_TEXT_EVENT =
  "realtime_interpreter_partial_text";
export const REALTIME_INTERPRETER_AUDIO_LEVEL_EVENT =
  "realtime_interpreter_audio_level";
export const REALTIME_INTERPRETER_ERROR_EVENT = "realtime_interpreter_error";

export const REALTIME_TRANSLATE_ENDPOINT =
  "wss://proxy.talkis.ru/api/realtime-translate";
export const REALTIME_TRANSLATE_MODEL = "gemini-3.5-live-translate-preview";
export const REALTIME_TRANSLATE_INPUT_MIME_TYPE = "audio/pcm;rate=16000";
export const REALTIME_TRANSLATE_OUTPUT_MIME_TYPE = "audio/pcm;rate=24000";

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

export type RealtimeLanguagePair = "ru_en" | "ru_es" | "ru_de" | "ru_zh_hans";
export type RealtimeApiMode = "cloud";
export type RealtimeInterpreterState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "error";
export type RealtimeInterpreterDirection = "user_to_remote" | "remote_to_user";

export interface RealtimeLanguagePairDefinition {
  id: RealtimeLanguagePair;
  label: string;
  userSourceLanguage: "ru";
  userTargetLanguage: string;
  remoteSourceLanguage: string;
  remoteTargetLanguage: "ru";
}

export const REALTIME_LANGUAGE_PAIRS: RealtimeLanguagePairDefinition[] = [
  {
    id: "ru_en",
    label: "RU ↔ EN",
    userSourceLanguage: "ru",
    userTargetLanguage: "en",
    remoteSourceLanguage: "en",
    remoteTargetLanguage: "ru",
  },
  {
    id: "ru_es",
    label: "RU ↔ ES",
    userSourceLanguage: "ru",
    userTargetLanguage: "es",
    remoteSourceLanguage: "es",
    remoteTargetLanguage: "ru",
  },
  {
    id: "ru_de",
    label: "RU ↔ DE",
    userSourceLanguage: "ru",
    userTargetLanguage: "de",
    remoteSourceLanguage: "de",
    remoteTargetLanguage: "ru",
  },
  {
    id: "ru_zh_hans",
    label: "RU ↔ ZH",
    userSourceLanguage: "ru",
    userTargetLanguage: "zh-Hans",
    remoteSourceLanguage: "zh-Hans",
    remoteTargetLanguage: "ru",
  },
];

export function realtimeLanguagePairDefinition(
  pair: RealtimeLanguagePair,
): RealtimeLanguagePairDefinition {
  return (
    REALTIME_LANGUAGE_PAIRS.find((definition) => definition.id === pair) ||
    REALTIME_LANGUAGE_PAIRS[0]
  );
}

export interface StartRealtimeInterpreterRequest {
  realMicDeviceId?: string | null;
  virtualMicOutputDeviceId: string;
  localPlaybackDeviceId?: string | null;
  languagePair: RealtimeLanguagePair;
  apiMode: RealtimeApiMode;
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
  sourceText?: string | null;
  translatedText?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  isFinal: boolean;
}

export interface RealtimeInterpreterAudioLevelEvent {
  sessionId?: string | null;
  direction: RealtimeInterpreterDirection;
  inputLevel: number;
  outputLevel: number;
}

export interface RealtimeTranslateStartClientMessage {
  type: "start";
  sessionId: string;
  languagePair: RealtimeLanguagePair;
  platform: string;
}

export interface RealtimeTranslateAudioAppendClientMessage {
  type: "audio.append";
  direction: RealtimeInterpreterDirection;
  audio: string;
  mimeType: typeof REALTIME_TRANSLATE_INPUT_MIME_TYPE;
}

export interface RealtimeTranslateStopClientMessage {
  type: "stop";
}

export type RealtimeTranslateClientMessage =
  | RealtimeTranslateStartClientMessage
  | RealtimeTranslateAudioAppendClientMessage
  | RealtimeTranslateStopClientMessage;

export interface RealtimeTranslateSessionStartedServerMessage {
  type: "session.started";
  sessionId: string;
  model: string;
  languagePair: RealtimeLanguagePair;
}

export interface RealtimeTranslateTranscriptServerMessage {
  type: "transcript.partial" | "transcript.final";
  direction: RealtimeInterpreterDirection;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  startMs?: number;
  endMs?: number;
}

export interface RealtimeTranslateAudioServerMessage {
  type: "audio";
  direction: RealtimeInterpreterDirection;
  audio: string;
  mimeType: typeof REALTIME_TRANSLATE_OUTPUT_MIME_TYPE;
}

export interface RealtimeTranslateErrorServerMessage {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export interface RealtimeTranslateSessionClosedServerMessage {
  type: "session.closed";
  sessionId: string;
}

export type RealtimeTranslateServerMessage =
  | RealtimeTranslateSessionStartedServerMessage
  | RealtimeTranslateTranscriptServerMessage
  | RealtimeTranslateAudioServerMessage
  | RealtimeTranslateErrorServerMessage
  | RealtimeTranslateSessionClosedServerMessage;

export function listRealtimeAudioDevices(): Promise<RealtimeAudioDevices> {
  return invoke<RealtimeAudioDevices>("list_realtime_audio_devices");
}

export function getRealtimeInterpreterStatus(): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("get_realtime_interpreter_status");
}

export function startRealtimeInterpreter(
  req: StartRealtimeInterpreterRequest,
): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("start_realtime_interpreter", {
    req,
  });
}

export function stopRealtimeInterpreter(): Promise<RealtimeInterpreterStatus> {
  return invoke<RealtimeInterpreterStatus>("stop_realtime_interpreter");
}

export function testVirtualMicOutput(deviceId: string): Promise<void> {
  return invoke<void>("test_virtual_mic_output", {
    req: { deviceId },
  });
}
