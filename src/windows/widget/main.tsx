import ReactDOM from "react-dom/client";
import "../../index.css";
import { Widget } from "./Widget";
import { I18nProvider } from "../../lib/i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Widget />
  </I18nProvider>
);
