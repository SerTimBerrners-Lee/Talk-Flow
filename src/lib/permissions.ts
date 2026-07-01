import { invoke } from "@tauri-apps/api/core";

import {
  getSystemAudioPermissionPassed,
  setSystemAudioPermissionPassed,
} from "./store";

export type PermissionStatus = "unknown" | "granted" | "denied" | "prompting";

export interface PermissionsState {
  microphone: PermissionStatus;
  accessibility: PermissionStatus;
  systemAudio: PermissionStatus;
}

export async function checkMicrophonePermission(): Promise<PermissionStatus> {
  // Prefer the Permissions API: unlike getUserMedia it does NOT open an audio
  // session, so it can't duck/silence other apps' sound (music, YouTube …) — a
  // known macOS side effect that fired every time we probed the mic at startup.
  // A permission check must also never trigger the native prompt. When the
  // WebView cannot report a definitive state, leave the explicit request to
  // requestMicrophonePermission().
  try {
    const status = await navigator.permissions.query(
      { name: "microphone" } as unknown as PermissionDescriptor,
    );
    if (status.state === "granted") {
      return "granted";
    }
    if (status.state === "denied") {
      return "denied";
    }
    return "unknown";
  } catch {
    // Permissions API doesn't support "microphone" in this WebView.
    return "unknown";
  }
}

export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function checkAccessibilityPermission(): Promise<PermissionStatus> {
  try {
    const trusted = await invoke<boolean>("check_accessibility_permission");
    return trusted ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

export async function checkSystemAudioPermission(): Promise<PermissionStatus> {
  if (!requiresSystemAudioPermission()) {
    return "granted";
  }

  return (await getSystemAudioPermissionPassed()) ? "granted" : "unknown";
}

export function requiresSystemAudioPermission(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  return value.includes("mac");
}

export async function requestSystemAudioPermission(): Promise<boolean> {
  if (!requiresSystemAudioPermission()) {
    return true;
  }

  let session: { id: string } | null = null;

  try {
    session = await invoke<{ id: string }>("start_call_capture", {
      req: {
        targetId: "system-output",
        includeMic: false,
        includeSystem: true,
      },
    });
    await setSystemAudioPermissionPassed(true).catch(() => undefined);
    return true;
  } catch {
    await setSystemAudioPermissionPassed(false).catch(() => undefined);
    return false;
  } finally {
    if (session) {
      await invoke("stop_call_capture", { sessionId: session.id }).catch(
        () => undefined,
      );
    }
  }
}

export async function checkAllPermissions(): Promise<PermissionsState> {
  return {
    microphone: await checkMicrophonePermission(),
    accessibility: await checkAccessibilityPermission(),
    systemAudio: await checkSystemAudioPermission(),
  };
}
