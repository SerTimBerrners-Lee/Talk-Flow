import { invoke } from "@tauri-apps/api/core";

import { logError } from "../../../lib/logger";
import { createWidgetErrorOverlayState } from "../widgetConstants";

let errorOverlaySequence = 0;

function createErrorOverlayRequestId(): string {
  errorOverlaySequence += 1;
  return `widget-error-${Date.now()}-${errorOverlaySequence}`;
}

export function showWidgetErrorOverlay(message: string): void {
  const requestId = createErrorOverlayRequestId();
  const requestSequence = errorOverlaySequence;

  void (async () => {
    // Clear either legacy surface first so the new request cannot be rejected
    // as a stale update of an older text overlay.
    await invoke("hide_widget_notice").catch(() => {});
    await invoke("hide_widget_text_overlay").catch(() => {});
    if (requestSequence !== errorOverlaySequence) {
      return;
    }
    await invoke("show_widget_text_overlay", {
      payload: createWidgetErrorOverlayState(message, requestId),
    });
  })().catch((error) => {
    logError("WIDGET", `Failed to show error status bar: ${error}`);
  });
}
