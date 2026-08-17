import { describe, expect, it } from "bun:test";

import {
  apiModelModeSettingsPatch,
  localModelModeSettingsPatch,
  talkisCloudModeSettingsPatch,
} from "./modelMode";
import { normalizeSavedSettings } from "./store";

describe("model mode settings", () => {
  it("clears local STT state so settings normalization keeps Cloud selected", () => {
    const patch = talkisCloudModeSettingsPatch({
      deviceToken: "device-jwt",
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperApiKey: "stale-local-key",
    });

    expect(patch).toMatchObject({
      deviceToken: "device-jwt",
      useOwnKey: false,
      provider: "openai",
      whisperApiKey: "",
      whisperEndpoint: "",
      whisperModel: "gpt-4o-transcribe",
    });

    const normalized = normalizeSavedSettings(patch);
    expect(normalized.useOwnKey).toBe(false);
    expect(normalized.whisperEndpoint).toBe("");
  });

  it("commits Local mode with a managed endpoint and local model", () => {
    const patch = localModelModeSettingsPatch(
      {
        endpoint: "http://127.0.0.1:8000",
        model: "whisper-small",
      },
      {
        whisperEndpoint: "",
        whisperModel: "gpt-4o-transcribe",
      },
    );

    expect(patch).toMatchObject({
      useOwnKey: true,
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "whisper-small",
    });

    const normalized = normalizeSavedSettings(patch);
    expect(normalized.useOwnKey).toBe(true);
    expect(normalized.provider).toBe("custom");
    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
  });

  it("replaces stale Local STT fields when API mode is selected", () => {
    const patch = apiModelModeSettingsPatch(
      {
        adapterId: "openai",
        apiKey: "api-key",
        endpoint: "",
        model: "gpt-4o-mini-transcribe",
      },
      {
        whisperEndpoint: "http://127.0.0.1:8000",
        whisperModel: "whisper-small",
      },
    );

    expect(patch).toMatchObject({
      useOwnKey: true,
      provider: "openai",
      selectedApiAdapter: "openai",
      apiKey: "api-key",
      whisperApiKey: "",
      whisperEndpoint: "",
      whisperModel: "gpt-4o-mini-transcribe",
    });
  });
});
