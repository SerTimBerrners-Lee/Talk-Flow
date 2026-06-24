import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

import { DEFAULT_WIDGET_SCALE, normalizeWidgetScale } from "./widgetScale";
import { recordTranscriptionStats } from "./stats";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  duration: number;
  raw: string;
  cleaned: string;
  source?: "voice" | "file" | "call";
  fileName?: string;
  fileSize?: number;
  callSessionId?: string;
  callTracks?: {
    kind: "mic" | "system";
    label: string;
    path: string;
  }[];
  status?: "processing" | "completed" | "failed" | "interrupted";
  errorMessage?: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioFileName?: string;
  /** Source file path kept for re-processing interrupted/failed file transcriptions. */
  filePath?: string;
  language?: string;
  style?: AppSettings["style"];
  /** Total processing time in milliseconds (STT + LLM) */
  processingTime?: number;
  mode?: "plain" | "speakers";
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
  translation?: RealtimeTranslationHistory;
}

export interface Speaker {
  id: string;
  label: string;
}

export interface SpeakerTranscriptSegment {
  start: number;
  end: number;
  speakerId: string;
  speakerLabel: string;
  text: string;
}

export type ApiProvider = "openai" | "custom";
export type ThemePreference = "system" | "light" | "dark";

export interface ApiAdapterSettings {
  apiKey: string;
  model: string;
  endpoint?: string;
  connectionStatus?: "saved" | "verified";
  lastConnectedAt?: string;
  lastTestedApiKey?: string;
  lastTestedModel?: string;
  lastTestedEndpoint?: string;
}

export interface LocalModelSettings {
  status: "not_downloaded" | "downloading" | "downloaded" | "error";
  message?: string;
  downloadedAt?: string;
  lastCheckedAt?: string;
}

/** Kind of text processing a prompt performs. */
export type PromptKind = "cleanup" | "summary";

/**
 * A reusable prompt preset. Built-in presets ship with the app; user presets
 * are stored in settings. Both are merged at runtime via {@link getAllPrompts}.
 */
export interface PromptPreset {
  id: string;
  name: string;
  kind: PromptKind;
  /** Instruction applied to the transcript text. */
  prompt: string;
  /** Built-in presets cannot be deleted (only duplicated). */
  builtin?: boolean;
  /** Optional sampling temperature for this preset. */
  temperature?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type RealtimeInterpreterApiMode = "cloud";
export type RealtimeInterpreterLanguagePair =
  | "ru_en"
  | "ru_es"
  | "ru_de"
  | "ru_zh_hans";

export interface RealtimeTranslationSegment {
  direction: "user_to_remote" | "remote_to_user";
  startMs?: number;
  endMs?: number;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface RealtimeTranslationHistory {
  provider: "talkis-cloud";
  model: string;
  languagePair: RealtimeInterpreterLanguagePair;
  segments: RealtimeTranslationSegment[];
}

export interface RealtimeInterpreterSettings {
  realMicDeviceId: string;
  virtualMicOutputDeviceId: string;
  localPlaybackDeviceId: string;
  languagePair: RealtimeInterpreterLanguagePair;
  apiMode: RealtimeInterpreterApiMode;
  headphonesConfirmed: boolean;
}

export interface AppSettings {
  apiKey: string;
  /** Saved API adapter credentials keyed by adapter id */
  apiAdapters: Record<string, ApiAdapterSettings>;
  /** API adapter selected for active API transcription mode */
  selectedApiAdapter: string;
  /** Cached local model states keyed by local catalog id */
  localModels: Record<string, LocalModelSettings>;
  /** Optional custom directory for downloaded local STT models; empty means default app data path */
  localModelsDir: string;
  /** Optional custom directory for transcript history and call recordings; empty means default app storage */
  transcriptionStorageDir: string;
  /** Separate API key for Whisper/STT endpoint (used in custom mode) */
  whisperApiKey: string;
  /** Separate API key for LLM endpoint (used in custom mode; empty = skip LLM) */
  llmApiKey: string;
  /** API provider preset: 'openai' uses default endpoints, 'custom' lets user configure everything */
  provider: ApiProvider;
  /** Model name for STT (e.g. "whisper-1", "whisper-large-v3-turbo") */
  whisperModel: string;
  /** Model name for LLM cleanup (e.g. "gpt-4o-mini", "deepseek-chat") */
  llmModel: string;
  hotkey: string;
  /** Floating widget visual scale. 1 = 100%. */
  widgetScale: number;
  theme: ThemePreference;
  language: string;
  doubleTapTimeout: number;
  style: "classic" | "business" | "tech";
  /** User-defined prompt presets (built-in presets are merged in at runtime). */
  prompts: PromptPreset[];
  /** Id of the cleanup preset that drives transcription text style. */
  selectedCleanupPromptId: string;
  /** Id of the summary preset offered by default in the summary panel. */
  defaultSummaryPromptId: string;
  micId: string;
  /** Custom Whisper-compatible endpoint URL (leave empty for OpenAI) */
  whisperEndpoint: string;
  /** Custom LLM endpoint URL (leave empty for OpenAI) */
  llmEndpoint: string;
  /** If true, user provides their own API key. If false, uses subscription */
  useOwnKey: boolean;
  /** Device auth token for Talkis Cloud */
  deviceToken: string;
  /** Default file transcription mode: split uploaded files by speakers */
  fileSpeakerDiarization: boolean;
  /** Beta realtime interpreter device and mode choices */
  realtimeInterpreter: RealtimeInterpreterSettings;
}

export interface WidgetPosition {
  x: number;
  y: number;
}

const HISTORY_MAX_VOICE_ENTRIES = 1000;
const HISTORY_MAX_FILE_ENTRIES = 200;
const HISTORY_MAX_CALL_ENTRIES = 200;
const HISTORY_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Command"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  cmd: "Command",
  command: "Command",
  meta: "Command",
};
const MAIN_KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  tab: "Tab",
  space: "Space",
  spacebar: "Space",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "Up",
  up: "Up",
  arrowdown: "Down",
  down: "Down",
  arrowleft: "Left",
  left: "Left",
  arrowright: "Right",
  right: "Right",
};
const FUNCTION_KEY_PATTERN = /^F(?:[1-9]|1[0-2])$/;
const DEFAULT_MAC_HOTKEY = "Command+Shift+Space";
const DEFAULT_DESKTOP_HOTKEY = "Control+Alt+Space";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function getDefaultHotkey(): string {
  return isMacPlatform() ? DEFAULT_MAC_HOTKEY : DEFAULT_DESKTOP_HOTKEY;
}

export const DEFAULT_HOTKEY = getDefaultHotkey();

export function formatHotkeyLabel(hotkey: string): string {
  const parts = hotkey.split("+").map((part) => part.trim());
  const isMac = isMacPlatform();

  const formatted = parts.map((part) => {
    const lower = part.toLowerCase();

    if (lower === "ctrl" || lower === "control") {
      return isMac ? "Control" : "Ctrl";
    }

    if (lower === "alt" || lower === "option") {
      return isMac ? "Option" : "Alt";
    }

    if (lower === "cmd" || lower === "command" || lower === "meta") {
      return isMac ? "Command" : "Cmd";
    }

    return part;
  });

  return formatted.join(" + ");
}

function normalizeHotkeyPart(part: string): string | null {
  const trimmed = part.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  const modifier = MODIFIER_ALIASES[lower];
  if (modifier) {
    return modifier;
  }

  const aliasedMainKey = MAIN_KEY_ALIASES[lower];
  if (aliasedMainKey) {
    return aliasedMainKey;
  }

  const upper = trimmed.toUpperCase();
  if (FUNCTION_KEY_PATTERN.test(upper)) {
    return upper;
  }

  if (/^[A-Z0-9]$/i.test(trimmed)) {
    return upper;
  }

  return null;
}

function isModifier(part: string): part is (typeof MODIFIER_ORDER)[number] {
  return MODIFIER_ORDER.includes(part as (typeof MODIFIER_ORDER)[number]);
}

function isFunctionKey(part: string): boolean {
  return FUNCTION_KEY_PATTERN.test(part);
}

export function validateHotkey(hotkey: string): {
  valid: boolean;
  error?: string;
} {
  const parts = hotkey.split("+").map((part) => normalizeHotkeyPart(part));
  if (parts.some((part) => part === null)) {
    return {
      valid: false,
      error:
        "Поддерживаются буквы, цифры, Space, F-клавиши и стандартные модификаторы",
    };
  }

  const normalizedParts = parts.filter((part): part is string => part !== null);
  const modifiers = normalizedParts.filter(isModifier);
  const mainKeys = normalizedParts.filter((part) => !isModifier(part));

  if (normalizedParts.length === 0) {
    return {
      valid: false,
      error: "Нажмите хотя бы одну клавишу",
    };
  }

  if (mainKeys.length === 0) {
    return {
      valid: false,
      error: "Добавьте основную клавишу: Space, букву, цифру или F-клавишу",
    };
  }

  if (mainKeys.length > 1) {
    return {
      valid: false,
      error: "Только одна основная клавиша",
    };
  }

  if (new Set(modifiers).size !== modifiers.length) {
    return {
      valid: false,
      error: "Один и тот же модификатор нельзя использовать дважды",
    };
  }

  if (
    isMacPlatform() &&
    modifiers.includes("Control") &&
    modifiers.includes("Alt")
  ) {
    return {
      valid: false,
      error:
        "На macOS сочетания Control + Option часто перехватываются VoiceOver. Выберите другое сочетание.",
    };
  }

  if (modifiers.length === 0 && !isFunctionKey(mainKeys[0])) {
    return {
      valid: false,
      error: "Без модификатора разрешены только F-клавиши",
    };
  }

  return { valid: true };
}

export function normalizeHotkey(hotkey: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  const validation = validateHotkey(hotkey);
  if (!validation.valid) {
    return validation;
  }

  const parts = hotkey
    .split("+")
    .map((part) => normalizeHotkeyPart(part))
    .filter((part): part is string => part !== null);
  const modifiers = MODIFIER_ORDER.filter((modifier) =>
    parts.includes(modifier),
  );
  const mainKey = parts.find((part) => !isModifier(part));

  if (!mainKey) {
    return {
      valid: false,
      error: "Добавьте основную клавишу: Space, букву, цифру или F-клавишу",
    };
  }

  return {
    valid: true,
    normalized: [...modifiers, mainKey].join("+"),
  };
}

export const DEFAULT_CLEANUP_PROMPT_ID = "classic";
export const DEFAULT_SUMMARY_PROMPT_ID = "summary-short";

/**
 * Built-in prompt presets shipped with the app. Cleanup ids match the legacy
 * `style` values (classic/business/tech) so migration is a straight mapping.
 * These are merged with user presets at runtime and never written to storage.
 */
export const BUILTIN_PROMPTS: PromptPreset[] = [
  {
    id: "classic",
    name: "Классический",
    kind: "cleanup",
    builtin: true,
    temperature: 0,
    prompt:
      "Исправь ошибки и пунктуацию, убери словесный мусор. Сохрани текст максимально близким к оригиналу. Не добавляй новых фактов.",
  },
  {
    id: "business",
    name: "Деловой",
    kind: "cleanup",
    builtin: true,
    temperature: 0.1,
    prompt:
      "Сделай речь чище и формальнее, сгладь явные запинки. Подходит для писем, задач и рабочих переписок. Не добавляй новых фактов.",
  },
  {
    id: "tech",
    name: "Разработка",
    kind: "cleanup",
    builtin: true,
    temperature: 0.15,
    prompt:
      "Обрабатывай текст с упором на терминологию и код: команды, пути, API и фразы вроде «консоль лог» превращай в канонический код.",
  },
  {
    id: "summary-short",
    name: "Краткое саммари",
    kind: "summary",
    builtin: true,
    temperature: 0.3,
    prompt:
      "Сделай краткое саммари разговора на русском: несколько предложений о сути, без воды. Не выдумывай детали, которых нет в тексте.",
  },
  {
    id: "summary-bullets",
    name: "Саммари по пунктам",
    kind: "summary",
    builtin: true,
    temperature: 0.3,
    prompt:
      "Сделай структурированное саммари разговора на русском: основные темы, ключевые решения и важные детали. Используй маркированные списки. Не добавляй то, чего нет в тексте.",
  },
  {
    id: "summary-actions",
    name: "Задачи и решения",
    kind: "summary",
    builtin: true,
    temperature: 0.2,
    prompt:
      "Из разговора выдели на русском три раздела: 1) Принятые решения; 2) Задачи и поручения (кто, что, срок, если есть); 3) Открытые вопросы. Если раздел пустой, пропусти его.",
  },
];

const BUILTIN_PROMPT_ID_SET = new Set(BUILTIN_PROMPTS.map((preset) => preset.id));

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  apiAdapters: {},
  selectedApiAdapter: "openai",
  localModels: {},
  localModelsDir: "",
  transcriptionStorageDir: "",
  whisperApiKey: "",
  llmApiKey: "",
  provider: "openai",
  whisperModel: "whisper-1",
  llmModel: "gpt-4o-mini",
  hotkey: DEFAULT_HOTKEY,
  widgetScale: DEFAULT_WIDGET_SCALE,
  theme: "system",
  language: "ru",
  doubleTapTimeout: 400,
  style: "classic",
  prompts: [],
  selectedCleanupPromptId: DEFAULT_CLEANUP_PROMPT_ID,
  defaultSummaryPromptId: DEFAULT_SUMMARY_PROMPT_ID,
  micId: "",
  whisperEndpoint: "",
  llmEndpoint: "",
  useOwnKey: true,
  deviceToken: "",
  fileSpeakerDiarization: false,
  realtimeInterpreter: {
    realMicDeviceId: "",
    virtualMicOutputDeviceId: "",
    localPlaybackDeviceId: "",
    languagePair: "ru_en",
    apiMode: "cloud",
    headphonesConfirmed: false,
  },
};

function parseStyle(value: unknown): AppSettings["style"] | undefined {
  if (value === "classic" || value === "business" || value === "tech") {
    return value;
  }

  return undefined;
}

function parsePromptKind(value: unknown): PromptKind | undefined {
  return value === "cleanup" || value === "summary" ? value : undefined;
}

/**
 * Parse stored user prompt presets. Built-in ids are reserved and merged at
 * runtime, so any stored preset reusing a built-in id is dropped.
 */
function parsePrompts(value: unknown): PromptPreset[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const presets: PromptPreset[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const kind = parsePromptKind(raw.kind);
    const prompt = typeof raw.prompt === "string" ? raw.prompt : "";

    if (!id || !name || !kind || BUILTIN_PROMPT_ID_SET.has(id)) {
      continue;
    }

    presets.push({
      id,
      name,
      kind,
      prompt,
      builtin: false,
      temperature:
        typeof raw.temperature === "number" ? raw.temperature : undefined,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    });
  }

  return presets;
}

function parseTheme(value: unknown): ThemePreference | undefined {
  if (value === "black") {
    return "dark";
  }

  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }

  return undefined;
}

function parseProvider(value: unknown): ApiProvider | undefined {
  if (value === "openai" || value === "custom") {
    return value;
  }
  return undefined;
}

function parseRealtimeInterpreterSettings(
  value: unknown,
): RealtimeInterpreterSettings | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  return {
    realMicDeviceId:
      typeof raw.realMicDeviceId === "string" ? raw.realMicDeviceId : "",
    virtualMicOutputDeviceId:
      typeof raw.virtualMicOutputDeviceId === "string"
        ? raw.virtualMicOutputDeviceId
        : "",
    localPlaybackDeviceId:
      typeof raw.localPlaybackDeviceId === "string"
        ? raw.localPlaybackDeviceId
        : "",
    languagePair:
      raw.languagePair === "ru_es" ||
      raw.languagePair === "ru_de" ||
      raw.languagePair === "ru_zh_hans"
        ? raw.languagePair
        : "ru_en",
    apiMode: "cloud",
    headphonesConfirmed:
      typeof raw.headphonesConfirmed === "boolean"
        ? raw.headphonesConfirmed
        : false,
  };
}

function normalizeSavedSettings(saved: unknown): Partial<AppSettings> {
  if (!saved || typeof saved !== "object") {
    return {};
  }

  const raw = saved as Record<string, unknown>;
  const rawApiAdapters =
    raw.apiAdapters && typeof raw.apiAdapters === "object"
      ? Object.entries(raw.apiAdapters as Record<string, unknown>).reduce<
          Record<string, ApiAdapterSettings>
        >((acc, [key, value]) => {
          if (!value || typeof value !== "object") return acc;

          const adapter = value as Record<string, unknown>;
          acc[key] = {
            apiKey: typeof adapter.apiKey === "string" ? adapter.apiKey : "",
            model: typeof adapter.model === "string" ? adapter.model : "",
            endpoint:
              typeof adapter.endpoint === "string"
                ? adapter.endpoint
                : undefined,
            connectionStatus:
              adapter.connectionStatus === "saved" ||
              adapter.connectionStatus === "verified"
                ? adapter.connectionStatus
                : undefined,
            lastConnectedAt:
              typeof adapter.lastConnectedAt === "string"
                ? adapter.lastConnectedAt
                : undefined,
            lastTestedApiKey:
              typeof adapter.lastTestedApiKey === "string"
                ? adapter.lastTestedApiKey
                : undefined,
            lastTestedModel:
              typeof adapter.lastTestedModel === "string"
                ? adapter.lastTestedModel
                : undefined,
            lastTestedEndpoint:
              typeof adapter.lastTestedEndpoint === "string"
                ? adapter.lastTestedEndpoint
                : undefined,
          };
          return acc;
        }, {})
      : undefined;

  const rawLocalModels =
    raw.localModels && typeof raw.localModels === "object"
      ? Object.entries(raw.localModels as Record<string, unknown>).reduce<
          Record<string, LocalModelSettings>
        >((acc, [key, value]) => {
          if (!value || typeof value !== "object") return acc;

          const model = value as Record<string, unknown>;
          const status =
            model.status === "downloading" ||
            model.status === "downloaded" ||
            model.status === "error"
              ? model.status
              : "not_downloaded";
          acc[key] = {
            status,
            message:
              typeof model.message === "string" ? model.message : undefined,
            downloadedAt:
              typeof model.downloadedAt === "string"
                ? model.downloadedAt
                : undefined,
            lastCheckedAt:
              typeof model.lastCheckedAt === "string"
                ? model.lastCheckedAt
                : undefined,
          };
          return acc;
        }, {})
      : undefined;
  const normalizedHotkey =
    typeof raw.hotkey === "string"
      ? normalizeHotkey(raw.hotkey).normalized
      : undefined;
  const hotkey =
    !isMacPlatform() && normalizedHotkey === DEFAULT_MAC_HOTKEY
      ? DEFAULT_DESKTOP_HOTKEY
      : normalizedHotkey;

  return {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
    apiAdapters: rawApiAdapters,
    selectedApiAdapter:
      typeof raw.selectedApiAdapter === "string"
        ? raw.selectedApiAdapter
        : undefined,
    localModels: rawLocalModels,
    localModelsDir:
      typeof raw.localModelsDir === "string" ? raw.localModelsDir : undefined,
    transcriptionStorageDir:
      typeof raw.transcriptionStorageDir === "string"
        ? raw.transcriptionStorageDir
        : undefined,
    whisperApiKey:
      typeof raw.whisperApiKey === "string" ? raw.whisperApiKey : undefined,
    llmApiKey: typeof raw.llmApiKey === "string" ? raw.llmApiKey : undefined,
    provider: parseProvider(raw.provider),
    whisperModel:
      typeof raw.whisperModel === "string" ? raw.whisperModel : undefined,
    llmModel: typeof raw.llmModel === "string" ? raw.llmModel : undefined,
    hotkey,
    widgetScale:
      raw.widgetScale === undefined
        ? undefined
        : normalizeWidgetScale(raw.widgetScale),
    theme: parseTheme(raw.theme),
    language: typeof raw.language === "string" ? raw.language : undefined,
    doubleTapTimeout:
      typeof raw.doubleTapTimeout === "number"
        ? raw.doubleTapTimeout
        : undefined,
    style: parseStyle(raw.style),
    prompts: parsePrompts(raw.prompts),
    selectedCleanupPromptId:
      typeof raw.selectedCleanupPromptId === "string" &&
      raw.selectedCleanupPromptId.trim()
        ? raw.selectedCleanupPromptId.trim()
        : // Migration: fall back to the legacy `style` value, whose ids match
          // the built-in cleanup presets one-to-one.
          parseStyle(raw.style),
    defaultSummaryPromptId:
      typeof raw.defaultSummaryPromptId === "string" &&
      raw.defaultSummaryPromptId.trim()
        ? raw.defaultSummaryPromptId.trim()
        : undefined,
    micId: typeof raw.micId === "string" ? raw.micId : undefined,
    whisperEndpoint:
      typeof raw.whisperEndpoint === "string" ? raw.whisperEndpoint : undefined,
    llmEndpoint:
      typeof raw.llmEndpoint === "string" ? raw.llmEndpoint : undefined,
    useOwnKey: typeof raw.useOwnKey === "boolean" ? raw.useOwnKey : undefined,
    deviceToken:
      typeof raw.deviceToken === "string" ? raw.deviceToken : undefined,
    fileSpeakerDiarization:
      typeof raw.fileSpeakerDiarization === "boolean"
        ? raw.fileSpeakerDiarization
        : undefined,
    realtimeInterpreter: parseRealtimeInterpreterSettings(
      raw.realtimeInterpreter,
    ),
  };
}

let _store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!_store) {
    _store = await load("talkis.json");
  }
  return _store;
}

function getHistoryEntrySource(
  entry: HistoryEntry,
): NonNullable<HistoryEntry["source"]> {
  if (entry.source === "file" || entry.source === "call") {
    return entry.source;
  }

  return "voice";
}

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function pruneHistory(history: HistoryEntry[]): HistoryEntry[] {
  // History is ordered newest first. Keep the newest entries per source and
  // trim from the bottom so old voice recordings cannot evict recent file
  // transcriptions, and large file transcripts cannot grow storage forever.
  //
  // Limits:
  // - voice: 1000 entries
  // - file: 200 entries
  // - call: 200 entries
  // - combined JSON payload: 50 MB
  const limitedByType: HistoryEntry[] = [];
  let voiceCount = 0;
  let fileCount = 0;
  let callCount = 0;

  for (const entry of history) {
    const source = getHistoryEntrySource(entry);

    if (source === "file") {
      if (fileCount >= HISTORY_MAX_FILE_ENTRIES) {
        continue;
      }
      fileCount += 1;
    } else if (source === "call") {
      if (callCount >= HISTORY_MAX_CALL_ENTRIES) {
        continue;
      }
      callCount += 1;
    } else {
      if (voiceCount >= HISTORY_MAX_VOICE_ENTRIES) {
        continue;
      }
      voiceCount += 1;
    }

    limitedByType.push(entry);
  }

  while (
    limitedByType.length > 1 &&
    estimateJsonBytes(limitedByType) > HISTORY_MAX_TOTAL_BYTES
  ) {
    limitedByType.pop();
  }

  return limitedByType;
}

interface GetSettingsOptions {
  reload?: boolean;
}

export async function getSettings(
  options: GetSettingsOptions = {},
): Promise<AppSettings> {
  const store = await getStore();
  if (options.reload) {
    try {
      await store.reload();
    } catch (error) {
      console.warn(
        "Failed to reload settings store, using in-memory store",
        error,
      );
    }
  }
  const saved = await store.get<unknown>("settings");
  const normalized = normalizeSavedSettings(saved);
  // Remove undefined keys so they don't overwrite defaults
  const defined = Object.fromEntries(
    Object.entries(normalized).filter(([, v]) => v !== undefined),
  );
  const result = { ...DEFAULT_SETTINGS, ...defined } as AppSettings;
  return result;
}

export async function saveSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const store = await getStore();
  const current = await getSettings({ reload: true });
  const nextSettings = { ...current, ...settings };

  if (typeof settings.hotkey === "string") {
    const normalized = normalizeHotkey(settings.hotkey);
    if (!normalized.valid || !normalized.normalized) {
      throw new Error(normalized.error || "Неверный формат горячей клавиши");
    }

    nextSettings.hotkey = normalized.normalized;
  }

  if (settings.widgetScale !== undefined) {
    nextSettings.widgetScale = normalizeWidgetScale(settings.widgetScale);
  }

  await store.set("settings", nextSettings);
  await store.save();
}

export function makePromptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `prompt-${crypto.randomUUID()}`;
  }

  return `prompt-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Built-in presets merged with the user's stored presets. */
export function getAllPrompts(
  settings: Pick<AppSettings, "prompts">,
): PromptPreset[] {
  return [...BUILTIN_PROMPTS, ...settings.prompts];
}

export function listPromptsByKind(
  settings: Pick<AppSettings, "prompts">,
  kind: PromptKind,
): PromptPreset[] {
  return getAllPrompts(settings).filter((preset) => preset.kind === kind);
}

export function findPrompt(
  settings: Pick<AppSettings, "prompts">,
  id: string,
): PromptPreset | undefined {
  return getAllPrompts(settings).find((preset) => preset.id === id);
}

export function getSelectedCleanupPrompt(settings: AppSettings): PromptPreset {
  return (
    findPrompt(settings, settings.selectedCleanupPromptId) ??
    BUILTIN_PROMPTS.find((preset) => preset.id === DEFAULT_CLEANUP_PROMPT_ID)!
  );
}

export function getDefaultSummaryPrompt(settings: AppSettings): PromptPreset {
  return (
    findPrompt(settings, settings.defaultSummaryPromptId) ??
    BUILTIN_PROMPTS.find((preset) => preset.id === DEFAULT_SUMMARY_PROMPT_ID)!
  );
}

export interface PromptPresetInput {
  id?: string;
  name: string;
  kind: PromptKind;
  prompt: string;
  temperature?: number;
}

/** Create or update a user prompt preset. Built-in presets are immutable. */
export async function upsertPrompt(
  input: PromptPresetInput,
): Promise<PromptPreset> {
  const name = input.name.trim();
  const prompt = input.prompt.trim();

  if (!name) {
    throw new Error("Название промпта не может быть пустым");
  }
  if (!prompt) {
    throw new Error("Текст промпта не может быть пустым");
  }

  const id = input.id?.trim() || makePromptId();
  if (BUILTIN_PROMPT_ID_SET.has(id)) {
    throw new Error("Встроенный промпт нельзя изменить — создайте копию");
  }

  const now = new Date().toISOString();
  const current = await getSettings({ reload: true });
  const existing = current.prompts.find((preset) => preset.id === id);
  const saved: PromptPreset = {
    id,
    name,
    kind: input.kind,
    prompt,
    builtin: false,
    temperature: input.temperature,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const prompts = existing
    ? current.prompts.map((preset) => (preset.id === id ? saved : preset))
    : [...current.prompts, saved];

  await saveSettings({ prompts });
  return saved;
}

/** Delete a user prompt preset and reset references that pointed at it. */
export async function deletePrompt(id: string): Promise<void> {
  if (BUILTIN_PROMPT_ID_SET.has(id)) {
    throw new Error("Встроенный промпт нельзя удалить");
  }

  const current = await getSettings({ reload: true });
  const prompts = current.prompts.filter((preset) => preset.id !== id);
  if (prompts.length === current.prompts.length) {
    return;
  }

  const patch: Partial<AppSettings> = { prompts };
  if (current.selectedCleanupPromptId === id) {
    patch.selectedCleanupPromptId = DEFAULT_CLEANUP_PROMPT_ID;
  }
  if (current.defaultSummaryPromptId === id) {
    patch.defaultSummaryPromptId = DEFAULT_SUMMARY_PROMPT_ID;
  }

  await saveSettings(patch);
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const storageDir = await getHistoryStorageDir();
  if (storageDir) {
    return readHistoryFromStorageDir(storageDir);
  }

  return readHistoryFromDefaultStorage();
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const history = await getHistory();
  const updated = pruneHistory([entry, ...history]);
  await writeHistory(updated);
  // Accumulate words statistics once per transcription; de-dupes by entry id
  // and never throws, so it cannot affect history persistence.
  await recordTranscriptionStats(entry);
}

export async function updateHistoryEntry(entry: HistoryEntry): Promise<void> {
  const history = await getHistory();
  const updated = pruneHistory(
    history.map((item) => (item.id === entry.id ? entry : item)),
  );
  await writeHistory(updated);
  // Counts a retried entry that only now succeeded; duplicates are ignored.
  await recordTranscriptionStats(entry);
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await getHistory();
  await writeHistory(history.filter((e) => e.id !== id));
}

/**
 * Any entry still marked "processing" when the app starts is an orphan — its
 * in-flight job died with the previous process (crash, quit, freeze). Mark such
 * entries "interrupted" so the user can re-run them. Idempotent and safe to call
 * from multiple windows. Returns true when at least one entry was reconciled.
 */
export async function reconcileInterruptedProcessing(): Promise<boolean> {
  const history = await getHistory();
  let changed = false;
  const reconciled = history.map((entry) => {
    if (entry.status !== "processing") {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      status: "interrupted" as const,
      errorMessage:
        entry.errorMessage ||
        "Обработка прервана: приложение было закрыто. Можно запустить повторно.",
    };
  });

  if (changed) {
    await writeHistory(reconciled);
  }

  return changed;
}

export async function clearHistory(): Promise<void> {
  await writeHistory([]);
}

async function getHistoryStorageDir(): Promise<string> {
  const settings = await getSettings({ reload: true });
  return settings.transcriptionStorageDir.trim();
}

async function readHistoryFromDefaultStorage(): Promise<HistoryEntry[]> {
  const store = await getStore();
  return (await store.get<HistoryEntry[]>("history")) || [];
}

export async function writeHistoryToDefaultStorage(
  history: HistoryEntry[],
): Promise<void> {
  const store = await getStore();
  await store.set("history", pruneHistory(history));
  await store.save();
}

async function readHistoryFromStorageDir(
  storageDir: string,
): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("read_history_file", { storageDir });
}

export async function writeHistoryToStorageDir(
  storageDir: string,
  history: HistoryEntry[],
): Promise<void> {
  await invoke("write_history_file", {
    storageDir,
    history: pruneHistory(history),
  });
}

async function writeHistory(history: HistoryEntry[]): Promise<void> {
  const storageDir = await getHistoryStorageDir();
  if (storageDir) {
    await writeHistoryToStorageDir(storageDir, history);
    return;
  }

  await writeHistoryToDefaultStorage(history);
}

const PERMISSIONS_PASSED_KEY = "permissions_passed";
const PERMISSIONS_VERSION_KEY = "permissions_version";
const CURRENT_PERMISSIONS_VERSION = 3;
const WIDGET_POSITION_KEY = "widget_position";

export async function getPermissionsPassed(): Promise<boolean> {
  const store = await getStore();
  const passed = (await store.get<boolean>(PERMISSIONS_PASSED_KEY)) ?? false;
  const version = (await store.get<number>(PERMISSIONS_VERSION_KEY)) ?? 1;
  return passed && version >= CURRENT_PERMISSIONS_VERSION;
}

export async function setPermissionsPassed(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(PERMISSIONS_PASSED_KEY, value);
  await store.set(
    PERMISSIONS_VERSION_KEY,
    value ? CURRENT_PERMISSIONS_VERSION : 0,
  );
  await store.save();
}

export async function getWidgetPosition(): Promise<WidgetPosition | null> {
  const store = await getStore();
  const saved = await store.get<unknown>(WIDGET_POSITION_KEY);

  if (!saved || typeof saved !== "object") {
    return null;
  }

  const raw = saved as Record<string, unknown>;
  if (typeof raw.x !== "number" || typeof raw.y !== "number") {
    return null;
  }

  return { x: raw.x, y: raw.y };
}

export async function saveWidgetPosition(
  position: WidgetPosition,
): Promise<void> {
  const store = await getStore();
  await store.set(WIDGET_POSITION_KEY, position);
  await store.save();
}
