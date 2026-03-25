import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import {
  NOTICE_TIMEOUT_MS,
  NOTICE_BUBBLE_HEIGHT,
  NOTICE_WIDGET_GAP,
  NOTICE_WIDGET_WIDTH,
  IDLE_WIDGET_HEIGHT,
  IDLE_WIDGET_WIDTH,
  PROCESSING_WIDGET_SIZE,
  RECORDING_WIDGET_HEIGHT,
  RECORDING_WIDGET_WIDTH,
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

function getBaseDimensionsForState(state: WidgetState): { width: number; height: number } {
  if (state === "recording") {
    return { width: RECORDING_WIDGET_WIDTH, height: RECORDING_WIDGET_HEIGHT };
  }

  if (state === "processing") {
    return { width: PROCESSING_WIDGET_SIZE, height: PROCESSING_WIDGET_SIZE };
  }

  return { width: IDLE_WIDGET_WIDTH, height: IDLE_WIDGET_HEIGHT };
}

function getNoticeDimensions(state: WidgetState): { width: number; height: number } {
  const base = getBaseDimensionsForState(state);

  return {
    width: Math.max(base.width, NOTICE_WIDGET_WIDTH),
    height: base.height + NOTICE_BUBBLE_HEIGHT + NOTICE_WIDGET_GAP,
  };
}

export function useWidgetNotice({ stateRef, resizeWidget }: UseWidgetNoticeParams): UseWidgetNoticeResult {
  const [notice, setNotice] = useState<WidgetNoticeState | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback(
    (message: string, tone: WidgetNoticeTone = "error") => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }

      const noticeDimensions = getNoticeDimensions(stateRef.current);
      void resizeWidget(noticeDimensions.width, noticeDimensions.height);

      setNotice({ message, tone });
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;

        const baseDimensions = getBaseDimensionsForState(stateRef.current);
        void resizeWidget(baseDimensions.width, baseDimensions.height);
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
