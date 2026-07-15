import { describe, expect, test } from "bun:test";

import { resolveRowActionsMenuPosition } from "./rowActionsMenuPosition";

describe("resolveRowActionsMenuPosition", () => {
  test("opens above a row near the bottom edge", () => {
    expect(
      resolveRowActionsMenuPosition({
        anchorRight: 300,
        anchorTop: 430,
        anchorBottom: 462,
        menuWidth: 168,
        menuHeight: 120,
        viewportWidth: 320,
        viewportHeight: 480,
      }),
    ).toEqual({ left: 132, top: 304 });
  });

  test("keeps a menu inside the left and top viewport edges", () => {
    expect(
      resolveRowActionsMenuPosition({
        anchorRight: 40,
        anchorTop: 4,
        anchorBottom: 36,
        menuWidth: 168,
        menuHeight: 120,
        viewportWidth: 320,
        viewportHeight: 480,
      }),
    ).toEqual({ left: 8, top: 42 });
  });
});
