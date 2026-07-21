import type { MsgKey } from "../lib/i18n";

export interface OnboardingSttModel {
  id: string;
  name: string;
  model: string;
  descriptionKey: MsgKey;
  sizeLabel: string;
  languageLabel: string;
  downloadBytes: number;
  initials: string;
  engineLabel: string;
  speedLabel: MsgKey;
  accuracyLabel: MsgKey;
  supportsStreaming?: boolean;
  recommended?: boolean;
}

export const DEFAULT_ONBOARDING_STT_MODEL_ID = "nemotron-35-asr-streaming-06b";

export const ONBOARDING_STT_MODELS: OnboardingSttModel[] = [
  {
    id: "nemotron-35-asr-streaming-06b",
    name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B",
    model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
    descriptionKey: "models.local.nemotron-35-asr-streaming-06b.description",
    sizeLabel: "716 MB",
    languageLabel: "40",
    downloadBytes: 716_000_000,
    initials: "N3",
    engineLabel: "Nemotron",
    speedLabel: "onboarding.model.speedVeryFast",
    accuracyLabel: "onboarding.model.accuracyHigh",
    supportsStreaming: true,
    recommended: true,
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large V3 Turbo",
    model: "whisper-large-v3-turbo",
    descriptionKey: "models.local.whisper-large-v3-turbo.description",
    sizeLabel: "474 MB",
    languageLabel: "99+",
    downloadBytes: 473_992_235,
    initials: "WT",
    engineLabel: "Whisper",
    speedLabel: "onboarding.model.speedFast",
    accuracyLabel: "onboarding.model.accuracyHigh",
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    model: "whisper-small",
    descriptionKey: "models.local.whisper-small.description",
    sizeLabel: "145 MB",
    languageLabel: "99+",
    downloadBytes: 145_458_032,
    initials: "WS",
    engineLabel: "Whisper",
    speedLabel: "onboarding.model.speedFast",
    accuracyLabel: "onboarding.model.accuracyMedium",
  },
  {
    id: "gigaam-v3-e2e-rnnt",
    name: "GigaAM v3 E2E RNNT",
    model: "ai-sage/GigaAM-v3",
    descriptionKey: "models.local.gigaam-v3-e2e-rnnt.description",
    sizeLabel: "184 MB",
    languageLabel: "RU",
    downloadBytes: 183_948_704,
    initials: "GA",
    engineLabel: "GigaAM",
    speedLabel: "onboarding.model.speedVeryFast",
    accuracyLabel: "onboarding.model.accuracyHigh",
  },
  {
    id: "qwen3-asr-06b",
    name: "Qwen3-ASR 0.6B",
    model: "Qwen/Qwen3-ASR-0.6B",
    descriptionKey: "models.local.qwen3-asr-06b.description",
    sizeLabel: "811 MB",
    languageLabel: "52",
    downloadBytes: 811_000_000,
    initials: "Q3",
    engineLabel: "Qwen3-ASR",
    speedLabel: "onboarding.model.speedFast",
    accuracyLabel: "onboarding.model.accuracyHigh",
  },
];
