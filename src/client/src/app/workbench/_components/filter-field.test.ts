import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { fieldAttributes, singleLine } from "./filter-field";

// O campo de filtro (RN-TABELA-005, 010 e 011) é um CodeMirror de uma linha. O vitest não tem DOM: o que se confere é o estado do editor, que é onde a
// regra mora (a vista do CodeMirror só desenha).
describe("o campo de filtro é de uma linha só", () => {
  const typed = (doc: string, insert: string, at = doc.length) => EditorState.create({ doc, extensions: [singleLine] }).update({ changes: { from: at, insert } }).state.doc;

  it("a quebra de linha que chega (colar, Ctrl+Enter de outro mapa) vira espaço, e o resto fica", () => {
    expect(typed("a = 1", "\nAND b = 2").toString()).toBe("a = 1 AND b = 2");
    expect(typed("a = 1", "\r\nb\n\nc").toString()).toBe("a = 1 b  c");
    expect(typed("a = 1", "\n").lines).toBe(1);
  });

  it("a digitação comum não muda", () => {
    expect(typed("a = ", "1").toString()).toBe("a = 1");
    expect(typed("", "status = 'aberta'").toString()).toBe("status = 'aberta'");
  });

  it("o cursor fica no fim do que foi colado", () => {
    const state = EditorState.create({ doc: "a", extensions: [singleLine] });
    const next = state.update({ changes: { from: 1, insert: "\nb" }, selection: { anchor: 3 } }).state;

    expect(next.doc.toString()).toBe("a b");
    expect(next.selection.main.head).toBe(3);
  });
});

describe("os atributos do texto editável", () => {
  it("o nome, a descrição (a dica e a recusa), a recusa e nada de corretor", () => {
    expect(fieldAttributes({ label: "Filtro e ordem dos registros", describedBy: "h p", invalid: true })).toEqual({
      "aria-label": "Filtro e ordem dos registros",
      "aria-describedby": "h p",
      "aria-invalid": "true",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    });
    expect(fieldAttributes({ label: "x", describedBy: "h", invalid: false })["aria-invalid"]).toBe("false");
  });
});
