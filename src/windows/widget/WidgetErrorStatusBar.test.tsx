import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WidgetErrorStatusBar } from "./WidgetErrorStatusBar";

describe("widget error status bar", () => {
  test("shows a danger-colored message with copy and expand actions", () => {
    const markup = renderToStaticMarkup(
      <WidgetErrorStatusBar
        message="Не удалось вставить текст автоматически"
        copied={false}
        expanded={false}
        onCopy={() => {}}
        onToggleExpanded={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("var(--danger-soft)");
    expect(markup).toContain('aria-label="Скопировать сообщение об ошибке"');
    expect(markup).toContain('aria-label="Раскрыть сообщение"');
  });

  test("exposes the expanded state and collapse action", () => {
    const markup = renderToStaticMarkup(
      <WidgetErrorStatusBar
        message="Полный текст ошибки"
        copied={true}
        expanded={true}
        onCopy={() => {}}
        onToggleExpanded={() => {}}
      />,
    );

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Свернуть сообщение"');
    expect(markup).toContain("Сообщение скопировано");
  });
});
