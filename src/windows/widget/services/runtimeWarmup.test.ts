import { describe, expect, test } from "bun:test";

import { waitForRuntimeWarmUpWithinBudget } from "./runtimeWarmup";

describe("waitForRuntimeWarmUpWithinBudget", () => {
  test("returns a ready endpoint without timing out", async () => {
    await expect(
      waitForRuntimeWarmUpWithinBudget(
        Promise.resolve("http://127.0.0.1:8000"),
        50,
      ),
    ).resolves.toEqual({
      value: "http://127.0.0.1:8000",
      timedOut: false,
    });
  });

  test("preserves an explicit warm-up failure", async () => {
    await expect(
      waitForRuntimeWarmUpWithinBudget(Promise.resolve(false), 50),
    ).resolves.toEqual({ value: false, timedOut: false });
  });

  test("releases recording startup when warm-up exceeds the budget", async () => {
    const pending = new Promise<string>(() => {});

    await expect(
      waitForRuntimeWarmUpWithinBudget(pending, 5),
    ).resolves.toEqual({ value: null, timedOut: true });
  });
});
