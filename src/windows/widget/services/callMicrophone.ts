interface CallMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
}

export async function resolveCallMicrophoneLabel(
  micId: string,
  mediaDevices: CallMediaDevices = navigator.mediaDevices,
): Promise<string | null> {
  if (!micId) {
    return null;
  }

  const devices = await mediaDevices.enumerateDevices();
  const selected = devices.find(
    (device) => device.kind === "audioinput" && device.deviceId === micId,
  );
  const label = selected?.label.trim();

  if (!label) {
    throw new Error("Selected microphone is unavailable");
  }

  return label;
}

export async function requestCallMicrophoneStream(
  micId: string,
  mediaDevices: CallMediaDevices = navigator.mediaDevices,
): Promise<MediaStream> {
  if (!micId) {
    return mediaDevices.getUserMedia({ audio: true });
  }

  // Call transcription relies on the microphone and system tracks representing
  // different sources. If an explicitly selected microphone disappeared, do
  // not silently fall back to a virtual/default input that may mirror system
  // audio and produce the same transcript in both channels.
  return mediaDevices.getUserMedia({
    audio: { deviceId: { exact: micId } },
  });
}
