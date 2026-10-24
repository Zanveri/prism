import { describe, expect, it, vi } from "vitest";

import { selectEditorText, type EditorField } from "./cell-editing";

// A seleção do campo de edição ao abrir (RN-EDIT-001): uma função pura sobre o que o campo expõe, sem DOM.
function field(value: string, scroll = { left: 40, top: 12 }) {
  const setSelectionRange = vi.fn<EditorField["setSelectionRange"]>();
  return { value, scrollLeft: scroll.left, scrollTop: scroll.top, setSelectionRange } satisfies EditorField;
}

describe("a seleção do campo de edição ao abrir (RN-EDIT-001)", () => {
  it("aberto por F2, Enter, duplo clique ou \"Editar célula\", o texto todo vem selecionado, com o cursor no começo e a rolagem no zero", () => {
    const open = field("um texto bem comprido");

    selectEditorText(open, false);

    expect(open.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, 21, "backward");
    expect([open.scrollLeft, open.scrollTop]).toEqual([0, 0]);
  });

  it("o valor com quebra de linha é selecionado inteiro, e o campo mostra a primeira linha", () => {
    const open = field("linha 1\nlinha 2\nlinha 3");

    selectEditorText(open, false);

    expect(open.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, 23, "backward");
    expect(open.scrollTop).toBe(0);
  });

  it("o campo vazio abre com a seleção vazia, no começo", () => {
    const open = field("");

    selectEditorText(open, false);

    expect(open.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, 0, "backward");
  });

  it("aberto pelo primeiro caractere digitado, o cursor fica depois dele e a rolagem não é mexida", () => {
    const open = field("x");

    selectEditorText(open, true);

    expect(open.setSelectionRange).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect([open.scrollLeft, open.scrollTop]).toEqual([40, 12]);
  });
});
