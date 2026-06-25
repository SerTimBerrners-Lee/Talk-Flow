import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";

import { getSettings } from "../store";
import { SETTINGS_UPDATED_EVENT } from "../hotkeyEvents";
import { MESSAGES, type MsgKey } from "./messages";

export type UiLanguage = "ru" | "en";
export type { MsgKey };

const LS_KEY = "talkis.uiLanguage";

/** Best-effort OS language guess from the webview locale (RU is the fallback). */
export function detectOsLanguage(): UiLanguage {
  const nav =
    (typeof navigator !== "undefined" && navigator.language) || "";
  return /^en/i.test(nav) ? "en" : "ru";
}

/** Resolve a stored preference (or undefined) into a concrete UI language. */
export function resolveUiLanguage(stored?: string | null): UiLanguage {
  return stored === "en" || stored === "ru" ? stored : detectOsLanguage();
}

type Vars = Record<string, string | number>;
export type TFunc = (key: MsgKey, vars?: Vars) => string;

export function translate(lang: UiLanguage, key: MsgKey, vars?: Vars): string {
  const entry = MESSAGES[key] as { ru: string; en: string } | undefined;
  let text = entry ? entry[lang] ?? entry.ru : (key as string);
  if (vars) {
    for (const name of Object.keys(vars)) {
      text = text.split(`{${name}}`).join(String(vars[name]));
    }
  }
  return text;
}

// Module-level current language so non-React code (lib/*.ts: status/error
// messages outside the component tree) can translate via `tn()`. The provider
// keeps this in sync with the active UI language.
let currentLang: UiLanguage = resolveUiLanguage(
  typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null,
);

export function getCurrentLanguage(): UiLanguage {
  return currentLang;
}

/** Translate-now: for use outside React components (no hook). */
export function tn(key: MsgKey, vars?: Vars): string {
  return translate(currentLang, key, vars);
}

interface I18nValue {
  lang: UiLanguage;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Wraps a window root. Reads the UI language from the shared settings store and
 * re-reads it on SETTINGS_UPDATED_EVENT, so switching the language in the
 * Settings window updates every open window. localStorage is only a per-window
 * cache to avoid a flash of the wrong language on first paint.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<UiLanguage>(() => currentLang);

  useEffect(() => {
    let active = true;
    const apply = async (): Promise<void> => {
      try {
        const settings = await getSettings({ reload: true });
        const next = resolveUiLanguage(settings.uiLanguage);
        if (!active) return;
        currentLang = next;
        setLang(next);
        try {
          localStorage.setItem(LS_KEY, next);
        } catch {
          /* localStorage unavailable — ignore */
        }
      } catch {
        /* keep current language on read failure */
      }
    };
    void apply();
    const unlisten = listen(SETTINGS_UPDATED_EVENT, () => {
      void apply();
    });
    return () => {
      active = false;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const t: TFunc = (key, vars) => translate(lang, key, vars);

  return (
    <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Defensive fallback so a component still renders if used outside a provider.
  return { lang: "ru", t: (key, vars) => translate("ru", key, vars) };
}
