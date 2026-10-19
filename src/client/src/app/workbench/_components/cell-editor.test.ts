import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CellEditor } from "./cell-editor";

// O campo de edição da célula (RN-EDIT-001) com a dica de para quantas a edição vale (RN-EDIT-017), sem DOM: o que se confere é o que ele desenha.

const noop = () => {};
const render = (hint: string | null) => renderToStaticMarkup(createElement(CellEditor, { label: "preco, linha 1", draft: "10", hint, number: true, onDraft: noop, onCommit: noop, onCancel: noop }));

describe("a dica do campo de edição (RN-EDIT-017)", () => {
  it("com várias células, a dica fica logo abaixo do campo, no tom de atenção, e é a descrição dele", () => {
    const markup = render("Vale para as 37 células escolhidas da coluna preco.");
    const id = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toMatch(/data-editor-hint[^>]*class="[^"]*border-accent[^"]*top-full/);
    expect(markup).toContain("Vale para as 37 células escolhidas da coluna preco.");
  });

  it("com uma célula só, não há dica nem descrição", () => {
    const markup = render(null);
    expect(markup).not.toContain("aria-describedby");
    expect(markup).not.toContain("data-editor-hint");
  });
});
