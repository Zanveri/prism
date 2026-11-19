import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { defaultFindOptions } from "../_lib/sql-editor-vscode";
import { SqlEditorFindBar, type SqlEditorFindBarProps } from "./sql-editor-find-bar";

function makeProps(overrides: Partial<SqlEditorFindBarProps> = {}): SqlEditorFindBarProps {
  return {
    mode: "find",
    showReplace: false,
    focusRequest: { target: "find", seq: 1 },
    query: "item_id",
    replacement: "",
    options: defaultFindOptions,
    totalMatches: 4,
    activeMatch: 1,
    invalidRegex: false,
    goToValue: "185",
    lineCount: 185,
    mac: false,
    onQueryChange: vi.fn(),
    onReplacementChange: vi.fn(),
    onToggleReplace: vi.fn(),
    onOptionsChange: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onReplaceOne: vi.fn(),
    onReplaceAll: vi.fn(),
    onGoToValueChange: vi.fn(),
    onSubmitGoToLine: vi.fn(),
    onSwitchMode: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("SqlEditorFindBar (barra flutuante de localizar, substituir e ir para a linha)", () => {
  it("renderiza contador de ocorrências, alerta de regex inválida e modo Ir para a linha com tokens do tema", () => {
    rt.unmount();
    const findMarkup = rt.render(() => renderToStaticMarkup(createElement(SqlEditorFindBar, makeProps({ showReplace: true }))));
    expect(findMarkup).toContain("2 de 4");
    expect(findMarkup).toContain('aria-label="Substituir"');
    expect(findMarkup).not.toMatch(/#[0-9a-fA-F]{3,8}/);

    rt.unmount();
    const invalidMarkup = rt.render(() =>
      renderToStaticMarkup(createElement(SqlEditorFindBar, makeProps({ invalidRegex: true, totalMatches: 0 }))),
    );
    expect(invalidMarkup).toContain("Expressão inválida");
    expect(invalidMarkup).toContain('aria-invalid="true"');

    rt.unmount();
    const goToMarkup = rt.render(() => renderToStaticMarkup(createElement(SqlEditorFindBar, makeProps({ mode: "goto" }))));
    expect(goToMarkup).toContain("185");
    expect(goToMarkup).toContain('aria-label="Ir para a linha"');
  });

  it("responde aos atalhos do VS Code dentro da barra (Esc, Alt+C/W/R, F3/Shift+F3, Ctrl+Alt+Enter e Ctrl+G)", () => {
    const props = makeProps({ showReplace: true });
    rt.unmount();
    const tree = rt.render(() => SqlEditorFindBar(props));
    const [region] = elementsOf(tree).filter((el) => el.props.role === "region");

    const fireKey = (init: Record<string, unknown>) => {
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      (region.props.onKeyDown as (event: unknown) => void)({
        key: "",
        code: "",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault,
        stopPropagation,
        ...init,
      });
      return { preventDefault, stopPropagation };
    };

    fireKey({ key: "c", code: "KeyC", altKey: true });
    expect(props.onOptionsChange).toHaveBeenCalledWith({ ...defaultFindOptions, matchCase: true });

    fireKey({ key: "w", code: "KeyW", altKey: true });
    expect(props.onOptionsChange).toHaveBeenCalledWith({ ...defaultFindOptions, wholeWord: true });

    fireKey({ key: "r", code: "KeyR", altKey: true });
    expect(props.onOptionsChange).toHaveBeenCalledWith({ ...defaultFindOptions, regex: true });

    fireKey({ key: "F3" });
    expect(props.onFindNext).toHaveBeenCalledOnce();

    fireKey({ key: "F3", shiftKey: true });
    expect(props.onFindPrevious).toHaveBeenCalledOnce();

    fireKey({ key: "Enter", ctrlKey: true, altKey: true });
    expect(props.onReplaceAll).toHaveBeenCalledOnce();

    fireKey({ key: "g", ctrlKey: true });
    expect(props.onSwitchMode).toHaveBeenCalledWith("goto");

    fireKey({ key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
