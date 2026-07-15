import { createSerialTaskQueue } from "../../../lib/serialTaskQueue";

import type { LiveTranslationOverlayState } from "./liveTranslation";

export interface LiveTranslationOverlayRenderer {
  schedule: (state: LiveTranslationOverlayState, immediate?: boolean) => void;
  renderNow: (state: LiveTranslationOverlayState) => Promise<void>;
  cancel: () => void;
  runAfterPending: (task: () => Promise<void>) => Promise<void>;
}

export function createLiveTranslationOverlayRenderer({
  render,
  isActive,
  onError,
  intervalMs = 100,
}: {
  render: (state: LiveTranslationOverlayState) => Promise<void>;
  isActive: (sessionId: string) => boolean;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}): LiveTranslationOverlayRenderer {
  const queue = createSerialTaskQueue();
  let pending: LiveTranslationOverlayState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const enqueueRender = (
    state: LiveTranslationOverlayState,
  ): Promise<void> =>
    queue.enqueue(async () => {
      if (!isActive(state.sessionId)) return;
      await render(state);
    }).catch((error) => {
      onError?.(error);
    });

  const flush = (): void => {
    const next = pending;
    pending = null;
    timer = null;
    if (next) void enqueueRender(next);
  };

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return {
    schedule(state, immediate = false): void {
      pending = state;
      if (immediate) {
        cancel();
        void enqueueRender(state);
        return;
      }
      if (timer === null) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    renderNow(state): Promise<void> {
      cancel();
      return enqueueRender(state);
    },
    cancel,
    runAfterPending(task): Promise<void> {
      cancel();
      return queue.enqueue(task);
    },
  };
}
