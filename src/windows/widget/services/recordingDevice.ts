import { logError } from "../../../lib/logger";
import { formatErrorMessage } from "../../../lib/utils";

export function getVoiceAudioConstraints(
  micId: string,
): MediaTrackConstraints | true {
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  const useMicProcessing =
    platform.includes("linux") || platform.includes("x11");
  const constraints: MediaTrackConstraints = {
    echoCancellation: useMicProcessing,
    noiseSuppression: useMicProcessing,
    autoGainControl: useMicProcessing,
    channelCount: { ideal: 1 },
  };

  if (micId) {
    constraints.deviceId = { exact: micId };
  }

  return constraints;
}

export async function requestVoiceAudioStream(
  micId: string,
  mediaDevices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices,
): Promise<MediaStream> {
  const constraints = getVoiceAudioConstraints(micId);

  try {
    return await mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    logError(
      "RECORDING",
      `Selected microphone constraints failed, retrying with system default: ${formatErrorMessage(error)}`,
    );
    return mediaDevices.getUserMedia({ audio: true });
  }
}

export async function resolveSelectedMicLabel(
  micId: string,
): Promise<string | null> {
  if (!micId || !navigator.mediaDevices?.enumerateDevices) {
    return null;
  }

  let permissionStream: MediaStream | null = null;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    let selected = devices.find(
      (device) => device.kind === "audioinput" && device.deviceId === micId,
    );
    const knownLabel = selected?.label?.trim();
    if (knownLabel) {
      return knownLabel;
    }

    permissionStream = await requestVoiceAudioStream(micId);
    const trackLabel = permissionStream.getAudioTracks()[0]?.label?.trim();
    if (trackLabel) {
      return trackLabel;
    }

    devices = await navigator.mediaDevices.enumerateDevices();
    selected = devices.find(
      (device) => device.kind === "audioinput" && device.deviceId === micId,
    );
    return selected?.label?.trim() || null;
  } catch (error) {
    logError(
      "RECORDING",
      `Failed to resolve selected mic label: ${formatErrorMessage(error)}`,
    );
    return null;
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
  }
}
