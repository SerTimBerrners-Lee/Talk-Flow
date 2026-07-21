import { describe, expect, test } from "bun:test";

import { requestVoiceAudioStream } from "./recordingDevice";

describe("requestVoiceAudioStream", () => {
  test("retries with the system default when selected microphone constraints fail", async () => {
    const calls: MediaStreamConstraints[] = [];
    const fallbackStream = {} as MediaStream;
    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        if (calls.length === 1) throw new TypeError("Invalid constraint");
        return fallbackStream;
      },
    } as Pick<MediaDevices, "getUserMedia">;

    const stream = await requestVoiceAudioStream(
      "stale-device-id",
      mediaDevices,
    );

    expect(stream).toBe(fallbackStream);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.audio).toMatchObject({
      deviceId: { exact: "stale-device-id" },
    });
    expect(calls[1]).toEqual({ audio: true });
  });

  test("keeps the selected microphone request when it succeeds", async () => {
    const selectedStream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        return selectedStream;
      },
    } as Pick<MediaDevices, "getUserMedia">;

    const stream = await requestVoiceAudioStream(
      "selected-device",
      mediaDevices,
    );

    expect(stream).toBe(selectedStream);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.audio).toMatchObject({
      deviceId: { exact: "selected-device" },
    });
  });
});
