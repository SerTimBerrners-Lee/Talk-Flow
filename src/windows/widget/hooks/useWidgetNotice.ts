import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import {
  IDLE_WIDGET_HEIGHT,
  IDLE_WIDGET_WIDTH,
  NOTICE_TIMEOUT_MS,
  NOTICE_WIDGET_HEIGHT,
  NOTICE_WIDGET_WIDTH,
  WidgetNoticeState,
  WidgetNoticeTone,
  WidgetState,
} from "../widgetConstants";

interface UseWidgetNoticeParams {
  stateRef: MutableRefObject<WidgetState>;
  resizeWidget: (width: number, height: number) => Promise<void>;
}

interface UseWidgetNoticeResult {
  notice: WidgetNoticeState | null;
  showNotice: (message: string, tone?: WidgetNoticeTone) => void;
}

export function useWidgetNotice({ stateRef, resizeWidget }: UseWidgetNoticeParams): UseWidgetNoticeResult {
  const [notice, setNotice] = useState<WidgetNoticeState | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback(
    (message: string, tone: WidgetNoticeTone = "error") => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }

      if (stateRef.current === "idle") {
        void resizeWidget(NOTICE_WIDGET_WIDTH, NOTICE_WIDGET_HEIGHT);
      }

      setNotice({ message, tone });
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;

        if (stateRef.current === "idle") {
          void resizeWidget(IDLE_WIDGET_WIDTH, IDLE_WIDGET_HEIGHT);
        }
      }, NOTICE_TIMEOUT_MS);
    },
    [resizeWidget, stateRef],
  );

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  return {
    notice,
    showNotice,
  };
}
