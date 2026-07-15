import { describe, expect, test } from "bun:test";

import {
  CALL_BUBBLE_GAP,
  CALL_BUBBLE_SIZE,
  CALL_STACK_WIDGET_HEIGHT,
  CALL_STACK_WIDGET_WIDTH,
  FILE_DROP_STACK_WIDGET_HEIGHT,
  FILE_DROP_STACK_WIDGET_WIDTH,
  shouldAutoDismissTextOverlay,
  TEXT_OVERLAY_AUTO_DISMISS_MS,
  WIDGET_STACK_EDGE_PADDING,
  widgetStackHeight,
  widgetStackWidth,
} from "./widgetConstants";

const BUTTON_SLOT_WIDTH = CALL_BUBBLE_GAP + CALL_BUBBLE_SIZE;

describe("widgetStackWidth", () => {
  test("keeps edge padding around the base widget stack", () => {
    expect(widgetStackWidth(false, false)).toBe(
      CALL_STACK_WIDGET_WIDTH + WIDGET_STACK_EDGE_PADDING * 2,
    );
  });

  test("reserves one complete slot for the live translation button", () => {
    const baseWidth = widgetStackWidth(false, false);

    expect(widgetStackWidth(false, true)).toBe(baseWidth + BUTTON_SLOT_WIDTH);
  });

  test("uses the same optional-button slot while file drop is expanded", () => {
    expect(widgetStackWidth(true, true)).toBe(
      FILE_DROP_STACK_WIDGET_WIDTH +
        WIDGET_STACK_EDGE_PADDING * 2 +
        BUTTON_SLOT_WIDTH,
    );
  });
});

describe("widgetStackHeight", () => {
  test("keeps edge padding above and below the compact widget", () => {
    expect(widgetStackHeight(false)).toBe(
      CALL_STACK_WIDGET_HEIGHT + WIDGET_STACK_EDGE_PADDING * 2,
    );
  });

  test("keeps the same edge padding around the expanded file widget", () => {
    expect(widgetStackHeight(true)).toBe(
      FILE_DROP_STACK_WIDGET_HEIGHT + WIDGET_STACK_EDGE_PADDING * 2,
    );
  });
});

describe("widget text overlay", () => {
  test("auto-dismisses terminal text after ten seconds", () => {
    expect(TEXT_OVERLAY_AUTO_DISMISS_MS).toBe(10_000);
    expect(shouldAutoDismissTextOverlay("done")).toBe(true);
    expect(shouldAutoDismissTextOverlay("error")).toBe(true);
  });

  test("stays visible while text is still being produced", () => {
    expect(shouldAutoDismissTextOverlay("copying")).toBe(false);
    expect(shouldAutoDismissTextOverlay("translating")).toBe(false);
    expect(shouldAutoDismissTextOverlay("dictating")).toBe(false);
    expect(shouldAutoDismissTextOverlay("liveTranslation")).toBe(false);
  });
});
