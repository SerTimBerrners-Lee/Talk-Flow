interface CallMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
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
