import { invoke } from "@tauri-apps/api/core";

import {
  getSystemAudioPermissionVerifiedV2,
  setSystemAudioPermissionVerifiedV2,
} from "./store";

export type PermissionStatus = "unknown" | "granted" | "denied" | "prompting";

export interface PermissionsState {
  microphone: PermissionStatus;
  accessibility: PermissionStatus;
  systemAudio: PermissionStatus;
}

export async function checkMicrophonePermission(): Promise<PermissionStatus> {
  // On macOS, query AVFoundation directly. WKWebView's Permissions API can
  // lag behind TCC after the app is relaunched and may report the old process
  // state even though the checkbox is already enabled in System Settings.
  try {
    const nativeStatus = await invoke<PermissionStatus>(
      "check_microphone_permission",
    );
    if (nativeStatus !== "unknown") {
      return nativeStatus;
    }
  } catch {
    // Fall through to the cross-platform Web Permissions API.
  }

  // Prefer the Permissions API: unlike getUserMedia it does NOT open an audio
  // session, so it can't duck/silence other apps' sound (music, YouTube …) — a
  // known macOS side effect that fired every time we probed the mic at startup.
  // A permission check must also never trigger the native prompt. When the
  // WebView cannot report a definitive state, leave the explicit request to
  // requestMicrophonePermission().
  try {
    const status = await navigator.permissions.query({
      name: "microphone",
    } as unknown as PermissionDescriptor);
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

  // macOS does not expose the Core Audio tap permission through the Web
  // Permissions API. Trust only the versioned marker written after a real
  // start/stop capture probe; legacy markers are intentionally ignored.
  return (await getSystemAudioPermissionVerifiedV2()) ? "granted" : "unknown";
}

export function requiresSystemAudioPermission(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  return value.includes("mac");
}

export async function requestSystemAudioPermission(): Promise<void> {
  if (!requiresSystemAudioPermission()) {
    return;
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
    await setSystemAudioPermissionVerifiedV2(true);
  } catch (error) {
    await setSystemAudioPermissionVerifiedV2(false).catch(() => undefined);
    throw error;
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
