import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  HANDY_HOTKEY_EVENT,
  type HandyHotkeyEventPayload,
} from "../lib/hotkeyEvents";
import {
  hotkeyPreviewKeyFromKeyboardEvent,
  hotkeyPreviewKeys,
  hotkeyPreviewMatches,
} from "../lib/hotkeyPreview";

export function useLiveHotkeyPreview({
  enabled,
  hotkeyLabel,
}: {
  enabled: boolean;
  hotkeyLabel: string;
}): ReadonlySet<string> {
  const [pressedKeys, setPressedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!enabled) {
      setPressedKeys(new Set());
      return;
    }

    const clear = (): void => setPressedKeys(new Set());
    const handleKeyDown = (event: KeyboardEvent): void => {
      const key = hotkeyPreviewKeyFromKeyboardEvent(event);
      if (!key || !hotkeyPreviewKeys(hotkeyLabel).includes(key)) return;
      setPressedKeys((current) => new Set([...current, key]));
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      const key = hotkeyPreviewKeyFromKeyboardEvent(event);
      if (!key) return;
      setPressedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== "visible") clear();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const unlistenPromise = listen<HandyHotkeyEventPayload>(
      HANDY_HOTKEY_EVENT,
      ({ payload }) => {
        if (!hotkeyPreviewMatches(payload.hotkey, hotkeyLabel)) return;
        setPressedKeys(
          payload.state === "Pressed"
            ? new Set(hotkeyPreviewKeys(hotkeyLabel))
            : new Set(),
        );
      },
    );
    void unlistenPromise.catch(() => {});

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [enabled, hotkeyLabel]);

  return pressedKeys;
}
