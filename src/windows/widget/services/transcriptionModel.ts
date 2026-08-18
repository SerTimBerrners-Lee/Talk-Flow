import { batchFallbackModel } from "../../../lib/realtimeModels";
import { isLocalSttEndpoint } from "../../../lib/store";

interface BatchTranscriptionModelSettings {
  whisperEndpoint?: string | null;
  whisperModel?: string | null;
  selectedApiAdapter: string;
  apiAdapters: Record<string, { model?: string | null } | undefined>;
}

export function resolveBatchTranscriptionModel(
  settings: BatchTranscriptionModelSettings,
): string {
  if (isLocalSttEndpoint(settings.whisperEndpoint || "")) {
    return (settings.whisperModel || "").trim();
  }

  const configuredAdapterModel =
    settings.apiAdapters[settings.selectedApiAdapter]?.model?.trim();
  return batchFallbackModel(
    settings.selectedApiAdapter,
    configuredAdapterModel || settings.whisperModel || "",
  );
}
