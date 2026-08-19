import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WidgetRecordButton } from "./WidgetRecordButton";

describe("widget record button", () => {
  test("renders the red manual-recording control when the widget is hovered", () => {
    const markup = renderToStaticMarkup(
      <WidgetRecordButton
        label="Start recording"
        left={10}
        visible={true}
        onActivate={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Start recording"');
    expect(markup).toContain("background:#ff4d4d");
    expect(markup).toContain("opacity:1");
    expect(markup).toContain("pointer-events:auto");
  });

  test("keeps the control non-interactive until hover reveals it", () => {
    const markup = renderToStaticMarkup(
      <WidgetRecordButton
        label="Start recording"
        left={10}
        visible={false}
        onActivate={() => {}}
      />,
    );

    expect(markup).toContain("opacity:0");
    expect(markup).toContain("pointer-events:none");
  });
});
