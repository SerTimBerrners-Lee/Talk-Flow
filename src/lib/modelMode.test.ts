import { describe, expect, it } from "bun:test";

import { talkisCloudModeSettingsPatch } from "./modelMode";
import { normalizeSavedSettings } from "./store";

describe("Talkis Cloud model mode settings", () => {
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
});
