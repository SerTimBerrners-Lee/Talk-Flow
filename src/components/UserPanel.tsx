import { useState, useEffect, useCallback, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { IconLogout, IconUser, IconCrown } from "../lib/icons";

import {
  beginCloudAuthFlow,
  cancelCloudAuthFlow,
  CloudProfile,
  fetchCloudProfile,
  cloudLogout,
  getCloudTopUpUrl,
  handleAuthToken,
  generateExchangeCode,
  getAuthLoginUrlWithCode,
  isCloudAuthFlowActive,
  pollForToken,
  getCachedCloudProfile,
  subscribeCloudProfile,
  type CloudAuthFlowId,
} from "../lib/cloudAuth";
import { formatCloudMilliTokens } from "../lib/cloudTokenFormat";
import { logError, logInfo } from "../lib/logger";
import { SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import { useI18n } from "../lib/i18n";

/** Extract token from talkis://auth?token=... */
function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token") || null;
  } catch {
    return null;
  }
}

export function UserPanel() {
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState<CloudProfile | null | undefined>(() =>
    getCachedCloudProfile(),
  );
  const [loading, setLoading] = useState(
    () => getCachedCloudProfile() === undefined,
  );
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exchangeCodeRef = useRef<string | null>(null);
  const authFlowRef = useRef<CloudAuthFlowId | null>(null);

  const clearLocalAuthPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    exchangeCodeRef.current = null;
    authFlowRef.current = null;
    setWaitingForAuth(false);
  }, []);

  const cancelLocalAuthPolling = useCallback(() => {
    cancelCloudAuthFlow();
    clearLocalAuthPolling();
  }, [clearLocalAuthPolling]);

  const applyAuthTokenForCurrentFlow = useCallback(
    async (token: string): Promise<CloudProfile | null> => {
      const flowId = authFlowRef.current;
      if (!isCloudAuthFlowActive(flowId)) {
        logInfo(
          "USER_PANEL",
          "Ignoring auth token without an active local auth flow",
        );
        return null;
      }

      const data = await handleAuthToken(token, { authFlowId: flowId });
      clearLocalAuthPolling();
      return data;
    },
    [clearLocalAuthPolling],
  );

  const loadProfile = useCallback(async () => {
    if (getCachedCloudProfile() === undefined) {
      setLoading(true);
    }
    try {
      const data = await fetchCloudProfile({ force: true });
      if (data) {
        // Got profile — stop polling
        setWaitingForAuth(false);
      }
    } catch (error) {
      logError("USER_PANEL", `Failed to load profile: ${error}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    return subscribeCloudProfile((nextProfile) => {
      setProfile(nextProfile);
      setLoading(false);
      if (nextProfile) {
        clearLocalAuthPolling();
      }
    });
  }, [clearLocalAuthPolling]);

  useEffect(() => {
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void loadProfile();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadProfile]);

  // ── Deep link: Rust event ─────────────────────────────────
  useEffect(() => {
    const unlistenPromise = listen<string>("deep-link-auth", async (event) => {
      logInfo("USER_PANEL", "Received auth token via Tauri event");
      const data = await applyAuthTokenForCurrentFlow(event.payload);
      if (data) {
        await loadProfile();
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applyAuthTokenForCurrentFlow, loadProfile]);

  // ── Deep link: JS plugin API ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        await onOpenUrl(async (urls) => {
          if (cancelled) return;
          for (const url of urls) {
            logInfo("USER_PANEL", `Deep link (JS): ${url}`);
            const token = extractTokenFromUrl(url);
            if (token) {
              const data = await applyAuthTokenForCurrentFlow(token);
              if (data) {
                await loadProfile();
              }
            }
          }
        });
      } catch (err) {
        // Plugin may not be available in dev mode
        logInfo("USER_PANEL", `Deep link JS API unavailable: ${err}`);
      }
    };

    void setup();

    return () => {
      cancelled = true;
    };
  }, [applyAuthTokenForCurrentFlow, loadProfile]);

  // ── Polling fallback via exchange code ──────────────────────
  useEffect(() => {
    if (!waitingForAuth) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    logInfo(
      "USER_PANEL",
      `Starting auth polling with code: ${exchangeCodeRef.current?.slice(0, 8)}...`,
    );
    pollingRef.current = setInterval(async () => {
      const code = exchangeCodeRef.current;
      const flowId = authFlowRef.current;
      if (!code || !isCloudAuthFlowActive(flowId)) return;

      const token = await pollForToken(code);
      if (
        token &&
        exchangeCodeRef.current === code &&
        authFlowRef.current === flowId &&
        isCloudAuthFlowActive(flowId)
      ) {
        logInfo("USER_PANEL", "Auth polling: token received!");
        const data = await handleAuthToken(token, { authFlowId: flowId });
        if (data) {
          setProfile(data);
        }
        clearLocalAuthPolling();
      }
    }, 3000);

    // Stop polling after 2 minutes
    const timeout = setTimeout(() => {
      logInfo("USER_PANEL", "Auth polling timed out");
      cancelLocalAuthPolling();
    }, 120_000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      clearTimeout(timeout);
    };
  }, [cancelLocalAuthPolling, clearLocalAuthPolling, waitingForAuth]);

  const handleActivate = async () => {
    try {
      if (profile) {
        await openUrl(profile.topUpUrl || getCloudTopUpUrl());
        return;
      }

      const code = generateExchangeCode();
      const flowId = beginCloudAuthFlow();
      exchangeCodeRef.current = code;
      authFlowRef.current = flowId;
      setWaitingForAuth(true);

      await openUrl(getAuthLoginUrlWithCode(code));
    } catch (error) {
      cancelLocalAuthPolling();
      logError("USER_PANEL", `Failed to open auth URL: ${error}`);
    }
  };

  const handleLogout = async () => {
    cancelLocalAuthPolling();
    setProfile(null);
    await cloudLogout();
    logInfo("USER_PANEL", "IconUser logged out");
  };

  if (loading) {
    return <div style={styles.container} />;
  }

  // ── Authenticated + available cloud balance ──────────────────
  if (profile && profile.subscription.active) {
    const balance = profile.wallet
      ? formatCloudMilliTokens(
          profile.wallet.balanceMilliTokens,
          lang === "ru" ? "ru-RU" : "en-US",
        )
      : null;
    return (
      <div style={styles.container}>
        <ProfileRow profile={profile} onLogout={handleLogout} />
        <div style={styles.badgeActive}>
          <div style={styles.badgeDot} />
          {balance
            ? t("userPanel.balance", { tokens: balance })
            : t("userPanel.subscriptionActive")}
        </div>
        {profile.wallet?.low && (
          <button onClick={handleActivate} style={styles.compactCta}>
            <IconCrown size={13} stroke={2} color="var(--accent-contrast)" />
            <span style={styles.compactCtaLabel}>
              {t("userPanel.upgradeToPro")}
            </span>
          </button>
        )}
      </div>
    );
  }

  // ── Authenticated but empty cloud balance ───────────────────
  if (profile && !profile.subscription.active) {
    return (
      <div style={styles.container}>
        <ProfileRow profile={profile} onLogout={handleLogout} />
        <button onClick={handleActivate} style={styles.compactCta}>
          <IconCrown size={13} stroke={2} color="var(--accent-contrast)" />
          <span style={styles.compactCtaLabel}>
            {t("userPanel.upgradeToPro")}
          </span>
        </button>
      </div>
    );
  }

  // ── Not authenticated ───────────────────────────────────────
  return (
    <div style={styles.container}>
      <SubscriptionCTA onActivate={handleActivate} />
    </div>
  );
}

function ProfileRow({
  profile,
  onLogout,
}: {
  profile: CloudProfile;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={styles.profileRow}>
      <div style={styles.avatar}>
        {profile.user.avatarUrl ? (
          <img
            src={profile.user.avatarUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        ) : (
          <IconUser size={16} stroke={1.5} color="var(--text-low)" />
        )}
      </div>
      <div style={styles.profileInfo}>
        <div style={styles.profileName}>
          {profile.user.login || profile.user.email.split("@")[0]}
        </div>
        <div style={styles.profileEmail}>{profile.user.email}</div>
      </div>
      <button
        onClick={onLogout}
        style={styles.logoutButton}
        title={t("userPanel.logout")}
      >
        <IconLogout size={14} stroke={1.8} />
      </button>
    </div>
  );
}

function SubscriptionCTA({ onActivate }: { onActivate: () => void }) {
  const { t } = useI18n();
  return (
    <div style={styles.ctaBox}>
      <div style={styles.ctaHeader}>
        <IconCrown size={14} stroke={2} color="var(--text-hi)" />
        <span
          style={{
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "-0.02em",
            color: "var(--text-hi)",
          }}
        >
          {t("userPanel.cta.title")}
        </span>
      </div>

      <ul style={styles.ctaList}>
        <li>{t("userPanel.cta.feature.unlimited")}</li>
        <li>{t("userPanel.cta.feature.noVpn")}</li>
        <li>{t("userPanel.cta.feature.deviceSync")}</li>
      </ul>

      <button onClick={onActivate} style={styles.ctaButton}>
        {t("userPanel.upgradeToPro")}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: "auto",
    padding: "12px 0 0",
    borderTop: "1px solid var(--border-subtle)",
  },
  profileRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "4px 8px",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--avatar-bg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-hi)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profileEmail: {
    fontSize: 11,
    color: "var(--text-low)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  logoutButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 6,
    borderRadius: 6,
    color: "var(--text-low)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color 0.15s, background 0.15s",
  },
  badgeActive: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    margin: "6px 8px 0",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-hi)",
    background: "var(--control-muted)",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
  },
  compactCta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "calc(100% - 16px)",
    margin: "8px 8px 0",
    padding: "10px",
    borderRadius: 8,
    background: "var(--accent)",
    color: "var(--accent-contrast)",
    border: "none",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    lineHeight: 1,
    whiteSpace: "nowrap" as const,
    cursor: "pointer",
    transition: "opacity 0.15s",
    fontFamily: "var(--font)",
  },
  compactCtaLabel: {
    display: "flex",
    alignItems: "center",
    lineHeight: 1,
    whiteSpace: "nowrap" as const,
  },
  ctaBox: {
    padding: "14px 14px",
    borderRadius: 10,
    background: "var(--control-muted)",
    border: "1px solid var(--border-subtle)",
    margin: "0 4px",
  },
  ctaHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  ctaList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 10px",
    fontSize: 11,
    lineHeight: 1.8,
    color: "var(--text-mid)",
  },
  ctaButton: {
    width: "100%",
    padding: "10px",
    borderRadius: 8,
    background: "var(--accent)",
    color: "var(--accent-contrast)",
    border: "none",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    cursor: "pointer",
    transition: "opacity 0.15s",
    fontFamily: "var(--font)",
  },
};
