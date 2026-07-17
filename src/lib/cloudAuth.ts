/**
 * Talkis Cloud authentication client.
 *
 * Handles communication with talkis.ru API for:
 * - Fetching user profile and cloud balance
 * - Deep link token handling
 * - Logout
 */

import { getSettings, saveSettings } from "./store";
import { logError, logInfo } from "./logger";
import { emit } from "@tauri-apps/api/event";

import { SETTINGS_UPDATED_EVENT } from "./hotkeyEvents";

const CLOUD_API_BASE = "https://talkis.ru";

type CloudProfileListener = (profile: CloudProfile | null | undefined) => void;
export type CloudAuthFlowId = number;

let cachedCloudProfile: CloudProfile | null | undefined;
let inflightCloudProfileRequest: Promise<CloudProfile | null> | null = null;
let authRevision = 0;
let authFlowRevision = 0;
let activeAuthFlowId: CloudAuthFlowId | null = null;
const cloudProfileListeners = new Set<CloudProfileListener>();

function notifyCloudProfileListeners(profile: CloudProfile | null | undefined): void {
  cloudProfileListeners.forEach((listener) => listener(profile));
}

function setCachedCloudProfile(profile: CloudProfile | null | undefined): void {
  cachedCloudProfile = profile;
  notifyCloudProfileListeners(profile);
}

async function saveCloudSettings(settings: Parameters<typeof saveSettings>[0]): Promise<void> {
  await saveSettings(settings);
  await emit(SETTINGS_UPDATED_EVENT).catch(() => {});
}

export interface CloudUser {
  id: string;
  email: string;
  login: string | null;
  avatarUrl: string | null;
}

export interface CloudSubscription {
  active: boolean;
  status: string; // "active" | "expired" | "cancelled" | "none"
  plan: string | null;
  expiresAt: string | null;
}

export interface CloudWallet {
  balanceMilliTokens: string;
  balanceTokens: string;
  reservedMilliTokens: string;
  debtMilliTokens: string;
  lifetimeGrantedMilliTokens: string;
  lifetimeSpentMilliTokens: string;
  low: boolean;
  empty: boolean;
  cloudBlocked: boolean;
}

export interface CloudThresholds {
  lowBalanceMilliTokens: string;
  progressTargetMilliTokens: string;
}

export interface CloudProfile {
  user: CloudUser;
  subscription: CloudSubscription;
  wallet?: CloudWallet;
  thresholds?: CloudThresholds;
  topUpUrl?: string;
}

export function getCachedCloudProfile(): CloudProfile | null | undefined {
  return cachedCloudProfile;
}

export function subscribeCloudProfile(listener: CloudProfileListener): () => void {
  cloudProfileListeners.add(listener);
  return () => {
    cloudProfileListeners.delete(listener);
  };
}

export function beginCloudAuthFlow(): CloudAuthFlowId {
  authFlowRevision += 1;
  activeAuthFlowId = authFlowRevision;
  return activeAuthFlowId;
}

export function cancelCloudAuthFlow(): void {
  authFlowRevision += 1;
  activeAuthFlowId = null;
}

export function isCloudAuthFlowActive(flowId: CloudAuthFlowId | null | undefined): flowId is CloudAuthFlowId {
  return typeof flowId === "number" && activeAuthFlowId === flowId;
}

/**
 * Fetch user profile and subscription status from the cloud.
 * Returns null if token is missing or invalid.
 */
export async function fetchCloudProfile({ force = false }: { force?: boolean } = {}): Promise<CloudProfile | null> {
  if (!force && inflightCloudProfileRequest) {
    return inflightCloudProfileRequest;
  }

  const request = (async () => {
    const settings = await getSettings();
    const token = settings.deviceToken;
    const requestRevision = authRevision;

    if (!token) {
      setCachedCloudProfile(null);
      return null;
    }

    try {
      const response = await fetch(`${CLOUD_API_BASE}/api/subscription/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logInfo("CLOUD", "Device token invalid, clearing");
        await saveCloudSettings({ deviceToken: "", useOwnKey: true });
        setCachedCloudProfile(null);
        return null;
      }

      if (!response.ok) {
        logError("CLOUD", `API error: ${response.status}`);
        return cachedCloudProfile ?? null;
      }

      const data = await response.json();
      const profile = data as CloudProfile;
      const latestSettings = await getSettings();
      if (authRevision !== requestRevision || latestSettings.deviceToken !== token) {
        logInfo("CLOUD", "Ignoring stale cloud profile response");
        return cachedCloudProfile ?? null;
      }

      setCachedCloudProfile(profile);
      return profile;
    } catch (error) {
      logInfo("CLOUD", `Cloud profile refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
      return cachedCloudProfile ?? null;
    }
  })();

  inflightCloudProfileRequest = request;

  try {
    return await request;
  } finally {
    if (inflightCloudProfileRequest === request) {
      inflightCloudProfileRequest = null;
    }
  }
}

/**
 * Save device token received from deep link callback.
 */
export async function handleAuthToken(
  token: string,
  options: { authFlowId?: CloudAuthFlowId | null } = {},
): Promise<CloudProfile | null> {
  if (
    Object.prototype.hasOwnProperty.call(options, "authFlowId") &&
    !isCloudAuthFlowActive(options.authFlowId)
  ) {
    logInfo("CLOUD", "Ignoring auth token from stale or cancelled auth flow");
    return cachedCloudProfile ?? null;
  }

  logInfo("CLOUD", "Received auth token from deep link");
  activeAuthFlowId = null;
  authRevision += 1;
  await saveCloudSettings({ deviceToken: token, useOwnKey: false });
  return fetchCloudProfile({ force: true });
}

/**
 * Clear device token (logout).
 */
export async function cloudLogout(): Promise<void> {
  logInfo("CLOUD", "Logging out");
  cancelCloudAuthFlow();
  authRevision += 1;
  inflightCloudProfileRequest = null;
  setCachedCloudProfile(null);
  await saveCloudSettings({ deviceToken: "", useOwnKey: true });
  setCachedCloudProfile(null);
}

/**
 * Check if user is authenticated with cloud.
 */
export async function isCloudAuthenticated(): Promise<boolean> {
  const settings = await getSettings();
  return settings.deviceToken.length > 0;
}

/**
 * Get the auth login URL for opening in browser.
 */
export function getAuthLoginUrl(): string {
  return `${CLOUD_API_BASE}/auth/login?device=true`;
}

export function getCloudTopUpUrl(): string {
  return `${CLOUD_API_BASE}/dashboard/billing`;
}

/**
 * Generate a random exchange code for device auth.
 */
export function generateExchangeCode(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get the auth login URL with exchange code for polling support.
 */
export function getAuthLoginUrlWithCode(code: string): string {
  return `${CLOUD_API_BASE}/auth/login?device=true&code=${code}`;
}

/**
 * Poll the server for a device token using the exchange code.
 * Returns the token if found, null otherwise.
 */
export async function pollForToken(code: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${CLOUD_API_BASE}/api/auth/device-exchange?code=${code}`,
    );

    if (!response.ok) return null;

    const data = await response.json();

    if (data.token) {
      return data.token;
    }

    return null;
  } catch {
    return null;
  }
}
