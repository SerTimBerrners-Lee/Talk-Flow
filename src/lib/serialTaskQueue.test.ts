import { describe, expect, test } from "bun:test";

import { createSerialTaskQueue } from "./serialTaskQueue";

describe("createSerialTaskQueue", () => {
  test("runs tasks in enqueue order even when an earlier task is delayed", async () => {
    const queue = createSerialTaskQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.enqueue(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
    });
    const second = queue.enqueue(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("continues after a failed task", async () => {
    const queue = createSerialTaskQueue();
    const failed = queue.enqueue(async () => {
      throw new Error("save failed");
    });
    const next = queue.enqueue(async () => "saved");

    await expect(failed).rejects.toThrow("save failed");
    await expect(next).resolves.toBe("saved");
  });
});
