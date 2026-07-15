import ReactDOM from "react-dom/client";
import "./index.css";
import { Widget } from "./windows/widget/Widget";
import { WidgetNoticeOverlay } from "./windows/widget/WidgetNoticeOverlay";
import { WidgetTextOverlay } from "./windows/widget/WidgetTextOverlay";
import { SettingsApp } from "./windows/settings/SettingsApp";
import { applySavedTheme, applyThemePreference } from "./lib/theme";
import { I18nProvider } from "./lib/i18n";

// Route based on Tauri window label passed via URL hash or query
// Widget window opens at "/" — Settings window opens at "/settings"
const isSettings =
  window.location.pathname.includes("settings") ||
  new URLSearchParams(window.location.search).get("window") === "settings";
const isWidgetNotice = new URLSearchParams(window.location.search).get("window") === "widget-notice";
const isWidgetText = new URLSearchParams(window.location.search).get("window") === "widget-text";

applyThemePreference("system");
void applySavedTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    {isSettings ? <SettingsApp /> : isWidgetNotice ? <WidgetNoticeOverlay /> : isWidgetText ? <WidgetTextOverlay /> : <Widget />}
  </I18nProvider>
);
