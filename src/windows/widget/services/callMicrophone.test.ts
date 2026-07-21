import { describe, expect, test } from "bun:test";

import { requestCallMicrophoneStream } from "./callMicrophone";

describe("call microphone selection", () => {
  test("uses the explicitly selected microphone", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        return stream;
      },
    };

    await expect(
      requestCallMicrophoneStream("selected-mic", mediaDevices),
    ).resolves.toBe(stream);
    expect(calls).toEqual([{ audio: { deviceId: { exact: "selected-mic" } } }]);
  });

  test("does not replace a missing selected microphone with the default", async () => {
    const unavailable = new Error("selected microphone is unavailable");
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        throw unavailable;
      },
    };

    await expect(
      requestCallMicrophoneStream("missing-mic", mediaDevices),
    ).rejects.toBe(unavailable);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      audio: { deviceId: { exact: "missing-mic" } },
    });
  });

  test("uses the system default only when no microphone was selected", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        return stream;
      },
    };

    await expect(requestCallMicrophoneStream("", mediaDevices)).resolves.toBe(
      stream,
    );
    expect(calls).toEqual([{ audio: true }]);
  });
});
