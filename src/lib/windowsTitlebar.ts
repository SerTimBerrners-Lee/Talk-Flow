import { invoke } from "@tauri-apps/api/core";

import type { EffectiveTheme } from "./theme";

function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;

  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  return platform.includes("win");
}

export async function syncWindowsTitlebarTheme(
  theme: EffectiveTheme,
): Promise<void> {
  if (!isWindowsPlatform()) return;

  await invoke("set_settings_titlebar_theme", { theme });
}
