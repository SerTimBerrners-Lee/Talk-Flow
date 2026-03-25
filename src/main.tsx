import ReactDOM from "react-dom/client";
import "./index.css";
import { Widget } from "./windows/widget/Widget";
import { SettingsApp } from "./windows/settings/SettingsApp";

// Route based on Tauri window label passed via URL hash or query
// Widget window opens at "/" — Settings window opens at "/settings"
const isSettings =
  window.location.pathname.includes("settings") ||
  new URLSearchParams(window.location.search).get("window") === "settings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  isSettings ? <SettingsApp /> : <Widget />
);
