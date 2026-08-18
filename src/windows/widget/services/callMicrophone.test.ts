import { describe, expect, test } from "bun:test";

import {
  requestCallMicrophoneStream,
  resolveCallMicrophoneLabel,
} from "./callMicrophone";

function audioInput(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "group",
    kind: "audioinput",
    label,
    toJSON: () => ({}),
  };
}

describe("call microphone selection", () => {
  test("uses the explicitly selected microphone", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices = {
      enumerateDevices: async () => [],
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
      enumerateDevices: async () => [],
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
      enumerateDevices: async () => [],
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

  test("resolves the selected microphone label without opening it", async () => {
    let getUserMediaCalls = 0;
    const mediaDevices = {
      enumerateDevices: async () => [
        audioInput("other-mic", "Other microphone"),
        audioInput("selected-mic", "  Studio microphone  "),
      ],
      getUserMedia: async () => {
        getUserMediaCalls += 1;
        return {} as MediaStream;
      },
    };

    await expect(
      resolveCallMicrophoneLabel("selected-mic", mediaDevices),
    ).resolves.toBe("Studio microphone");
    expect(getUserMediaCalls).toBe(0);
  });

  test("rejects a missing selected microphone without opening the default", async () => {
    let getUserMediaCalls = 0;
    const mediaDevices = {
      enumerateDevices: async () => [
        audioInput("other-mic", "Other microphone"),
      ],
      getUserMedia: async () => {
        getUserMediaCalls += 1;
        return {} as MediaStream;
      },
    };

    await expect(
      resolveCallMicrophoneLabel("missing-mic", mediaDevices),
    ).rejects.toThrow("Selected microphone is unavailable");
    expect(getUserMediaCalls).toBe(0);
  });

  test("uses the native default without enumerating or opening a WebView stream", async () => {
    let enumerateCalls = 0;
    let getUserMediaCalls = 0;
    const mediaDevices = {
      enumerateDevices: async () => {
        enumerateCalls += 1;
        return [];
      },
      getUserMedia: async () => {
        getUserMediaCalls += 1;
        return {} as MediaStream;
      },
    };

    await expect(resolveCallMicrophoneLabel("", mediaDevices)).resolves.toBe(
      null,
    );
    expect(enumerateCalls).toBe(0);
    expect(getUserMediaCalls).toBe(0);
  });
});
