import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { fieldAttributes, fieldThemeSpec, focusAtEnd, singleLine } from "./filter-field";

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

// A lista de sugestões vai para o `body` (`tooltips({ parent: document.body })`), num recipiente que o CodeMirror cria lá com as classes de tema do
// editor. Uma regra em `&` vale para ele também: com a altura de 28 px do campo, cada campo montado (uma aba de consulta com resultado, os
// Registros de uma tabela) deixava um bloco de 28 px no fim do `body`, o documento passava da janela e a área de trabalho rolava como página.
describe("o tema do campo vale só para o editor, não para o recipiente da lista de sugestões", () => {
  it("nenhuma regra em `&` sozinho: a caixa do campo é a de `&.cm-editor`", () => {
    expect(Object.keys(fieldThemeSpec)).not.toContain("&");
    expect(fieldThemeSpec["&.cm-editor"]).toMatchObject({ flex: "1 1 0%", minWidth: "0", height: "28px" });
  });

  it("toda regra que começa em `&` nomeia o editor (`&.cm-editor`, `&.cm-focused`) ou desce a um elemento dele", () => {
    for (const selector of Object.keys(fieldThemeSpec).flatMap((key) => key.split(","))) {
      const own = selector.trim();
      if (own.startsWith("&")) expect(own, own).toMatch(/^&\.cm-(editor|focused)\b/);
    }
  });
});

// RN-ABAS-019: o campo é a entrada da aba de uma tabela. O foco entra com o cursor no fim do texto, e só então o campo toma o foco: o editor de mentira guarda o
// estado e registra a ordem das duas chamadas.
describe("focusAtEnd: o foco no campo, com o cursor no fim (RN-ABAS-019)", () => {
  function fakeEditor(doc: string, anchor = 0) {
    const calls: string[] = [];
    const editor = {
      state: EditorState.create({ doc, selection: EditorSelection.cursor(anchor), extensions: [singleLine] }),
      dispatch: vi.fn((spec: { selection: EditorSelection }) => {
        calls.push("dispatch");
        editor.state = editor.state.update({ selection: spec.selection }).state;
      }),
      focus: vi.fn(() => void calls.push("focus")),
      calls,
    };
    return editor;
  }

  it("com texto no campo, o cursor vai ao fim, antes de o foco entrar", () => {
    const editor = fakeEditor("refugo > 0", 2);

    focusAtEnd(editor as never);

    expect(editor.state.selection.main.head).toBe(10);
    expect(editor.state.selection.main.empty).toBe(true);
    expect(editor.calls).toEqual(["dispatch", "focus"]);
  });

  it("com o texto selecionado, a seleção se desfaz no fim; com o campo vazio, o cursor fica no começo, que é o fim", () => {
    const selected = fakeEditor("a = 1");
    selected.state = selected.state.update({ selection: EditorSelection.range(0, 5) }).state;
    focusAtEnd(selected as never);
    expect(selected.state.selection.main).toMatchObject({ anchor: 5, head: 5 });

    const empty = fakeEditor("");
    focusAtEnd(empty as never);
    expect(empty.state.selection.main.head).toBe(0);
    expect(empty.focus).toHaveBeenCalledOnce();
  });
});
