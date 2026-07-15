import { describe, expect, test } from "bun:test";

import { createLiveTranslationOverlayRenderer } from "./liveTranslationOverlayRenderer";
import { createLiveTranslationOverlayState } from "./liveTranslation";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("live translation overlay renderer", () => {
  test("coalesces rapid partial updates into the latest render", async () => {
    const rendered: string[] = [];
    const renderer = createLiveTranslationOverlayRenderer({
      intervalMs: 10,
      isActive: () => true,
      render: async (state) => {
        rendered.push(state.error || "empty");
      },
    });

    renderer.schedule({
      ...createLiveTranslationOverlayState("session"),
      error: "first",
    });
    renderer.schedule({
      ...createLiveTranslationOverlayState("session"),
      error: "latest",
    });
    await wait(20);

    expect(rendered).toEqual(["latest"]);
  });

  test("renders final state immediately and never replays an older partial", async () => {
    const rendered: string[] = [];
    const renderer = createLiveTranslationOverlayRenderer({
      intervalMs: 20,
      isActive: () => true,
      render: async (state) => {
        rendered.push(state.error || "empty");
      },
    });

    renderer.schedule({
      ...createLiveTranslationOverlayState("session"),
      error: "partial",
    });
    renderer.schedule(
      { ...createLiveTranslationOverlayState("session"), error: "final" },
      true,
    );
    await wait(30);

    expect(rendered).toEqual(["final"]);
  });

  test("skips queued renders after the session becomes inactive", async () => {
    let active = true;
    const rendered: string[] = [];
    const renderer = createLiveTranslationOverlayRenderer({
      isActive: () => active,
      render: async (state) => {
        rendered.push(state.sessionId);
      },
    });

    active = false;
    await renderer.renderNow(createLiveTranslationOverlayState("old"));
    await renderer.runAfterPending(async () => {
      rendered.push("hidden");
    });

    expect(rendered).toEqual(["hidden"]);
  });
});
