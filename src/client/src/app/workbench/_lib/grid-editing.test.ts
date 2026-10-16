import { describe, expect, it } from "vitest";

import { copiesCell, editShortcuts, filterKey, gridRowOf, gridRowsOf, refreshKey, rowMarksOf, rowShortcut, savesEdits } from "./grid-editing";
import { addRow, deleteRow, editCell, editNewCell, noEdits } from "./record-edits";

const rows = [
  ["1", "aberta"],
  ["2", "aberta"],
];

describe("o que a grade desenha das pendências (RN-EDIT-004)", () => {
  it("as linhas novas vêm depois das lidas, com o que foi preenchido; o resto fica vazio para o padrão da tabela", () => {
    const added = addRow(noEdits);
    const edits = editNewCell(added.edits, added.id, 1, "nova");

    expect(gridRowsOf(rows, edits, 2)).toEqual([...rows, [null, "nova"]]);
  });

  it("cada linha com pendência tem a marca: as células alteradas, a exclusão, a linha nova e a que falhou no Salvar", () => {
    let edits = editCell(noEdits, 0, 1, "paga", "aberta");
    edits = deleteRow(edits, 1);
    const added = addRow(edits);

    const marks = rowMarksOf(added.edits, rows.length, 2);

    expect(marks.get(0)).toEqual({ kind: "read", deleted: false, pending: new Map([[1, "paga"]]), failed: false });
    expect(marks.get(1)).toEqual({ kind: "read", deleted: true, pending: new Map(), failed: false });
    expect(marks.get(2)).toEqual({ kind: "new", deleted: false, pending: new Map(), failed: true });
    expect(marks.has(3)).toBe(false);
  });

  it("a alteração que falhou é achada na grade: a linha lida pela posição, a nova depois das lidas", () => {
    const first = addRow(noEdits);
    const second = addRow(first.edits);

    expect(gridRowOf({ kind: "row", row: 1 }, second.edits, rows.length)).toBe(1);
    expect(gridRowOf({ kind: "new", id: second.id }, second.edits, rows.length)).toBe(3);
    expect(gridRowOf({ kind: "new", id: 99 }, second.edits, rows.length)).toBeNull();
  });
});

describe("Ctrl+S com o foco na grade (RN-EDIT-004)", () => {
  const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ key: "s", ctrlKey: true, metaKey: false, shiftKey: false, ...over });

  it("com alterações não salvas, Ctrl+S (ou Cmd+S) salva as alterações", () => {
    expect(savesEdits(key(), 2)).toBe(true);
    expect(savesEdits(key({ key: "S" }), 1)).toBe(true);
    expect(savesEdits(key({ ctrlKey: false, metaKey: true }), 1)).toBe(true);
  });

  it("sem nada pendente, ou com Shift, a tecla segue para quem a trata (na aba de consulta, salvar o script, RN-SCRIPT-001)", () => {
    expect(savesEdits(key(), 0)).toBe(false);
    expect(savesEdits(key({ shiftKey: true }), 1)).toBe(false);
    expect(savesEdits(key({ ctrlKey: false }), 1)).toBe(false);
  });
});

describe("Ctrl+C com o foco na grade (RN-GRADE-002, RN-SQL-017)", () => {
  const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: "c", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...over });

  it("Ctrl+C (ou Cmd+C) copia a célula ativa", () => {
    expect(copiesCell(key())).toBe(true);
    expect(copiesCell(key({ key: "C" }))).toBe(true);
    expect(copiesCell(key({ ctrlKey: false, metaKey: true }))).toBe(true);
  });

  it("com Shift (o copiar avançado) ou Alt, ou sem Ctrl, não é a cópia simples", () => {
    expect(copiesCell(key({ shiftKey: true }))).toBe(false);
    expect(copiesCell(key({ altKey: true }))).toBe(false);
    expect(copiesCell(key({ ctrlKey: false }))).toBe(false);
    expect(copiesCell(key({ key: "v" }))).toBe(false);
  });
});

describe("as teclas do Filtrar e do Atualizar (RN-GRADE-013 e RN-GRADE-012)", () => {
  const key = (name: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

  it("F11 abre o submenu Filtrar; Ctrl+F11 (Cmd+F11) abre o Filtrar por valor; com Shift ou Alt, nada", () => {
    expect(filterKey(key("F11"))).toBe("menu");
    expect(filterKey(key("F11", { ctrlKey: true }))).toBe("values");
    expect(filterKey(key("F11", { metaKey: true }))).toBe("values");
    expect(filterKey(key("F11", { shiftKey: true }))).toBeNull();
    expect(filterKey(key("F11", { altKey: true }))).toBeNull();
    expect(filterKey(key("F10"))).toBeNull();
  });

  it("F5 sozinha atualiza; com Ctrl, Cmd, Shift ou Alt, não", () => {
    expect(refreshKey(key("F5"))).toBe(true);
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) expect(refreshKey(key("F5", over)), JSON.stringify(over)).toBe(false);
    expect(refreshKey(key("r", { ctrlKey: true }))).toBe(false);
  });
});

describe("os atalhos da linha com o foco na grade (RN-EDIT-015)", () => {
  const key = (name: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: true, ...over });
  const windows = "Win32";
  const mac = "MacIntel";

  it("Alt+Insert adiciona, Ctrl+Alt+Insert duplica e Alt+Delete exclui a linha da célula ativa", () => {
    expect(rowShortcut(key("Insert"), windows)).toBe("newRow");
    expect(rowShortcut(key("Insert", { ctrlKey: true }), windows)).toBe("duplicateRow");
    expect(rowShortcut(key("Delete"), windows)).toBe("deleteRow");
    expect(rowShortcut(key("Insert"), "Linux x86_64")).toBe("newRow");
  });

  it("os modificadores são exatos: o Ctrl+Alt+Insert não cria linha (é o duplicar, conferido antes), e com Shift ou Cmd nada acontece", () => {
    expect(rowShortcut(key("Insert", { shiftKey: true }), windows)).toBeNull();
    expect(rowShortcut(key("Insert", { ctrlKey: true, shiftKey: true }), windows)).toBeNull();
    expect(rowShortcut(key("Insert", { metaKey: true }), windows)).toBeNull();
    expect(rowShortcut(key("Insert", { ctrlKey: true, metaKey: true }), windows)).toBeNull();
    expect(rowShortcut(key("Delete", { shiftKey: true }), windows)).toBeNull();
    expect(rowShortcut(key("Delete", { metaKey: true }), windows)).toBeNull();
  });

  it("o AltGr do ABNT2 chega como Ctrl+Alt: com ele o Insert duplica, e o Delete não faz nada", () => {
    expect(rowShortcut(key("Insert", { ctrlKey: true }), windows)).toBe("duplicateRow");
    expect(rowShortcut(key("Delete", { ctrlKey: true }), windows)).toBeNull();
  });

  it("sem Alt não é atalho da linha: o Insert e o Delete sozinhos (o Delete espera a seleção de linhas) e o Backspace fora do macOS", () => {
    expect(rowShortcut(key("Insert", { altKey: false }), windows)).toBeNull();
    expect(rowShortcut(key("Delete", { altKey: false }), windows)).toBeNull();
    expect(rowShortcut(key("Backspace"), windows)).toBeNull();
    expect(rowShortcut(key("x"), windows)).toBeNull();
  });

  it("no macOS o Option faz o papel do Alt e o Cmd o do Ctrl; o Control+Option+Insert do DBeaver também duplica, e o delete do Mac (o Backspace) exclui", () => {
    expect(rowShortcut(key("Insert"), mac)).toBe("newRow");
    expect(rowShortcut(key("Insert", { metaKey: true }), mac)).toBe("duplicateRow");
    expect(rowShortcut(key("Insert", { ctrlKey: true }), mac)).toBe("duplicateRow");
    expect(rowShortcut(key("Insert", { ctrlKey: true, metaKey: true }), mac)).toBeNull();
    expect(rowShortcut(key("Insert", { metaKey: true, shiftKey: true }), mac)).toBeNull();
    expect(rowShortcut(key("Backspace"), mac)).toBe("deleteRow");
    expect(rowShortcut(key("Delete"), mac)).toBe("deleteRow");
    expect(rowShortcut(key("Backspace", { metaKey: true }), mac)).toBeNull();
  });

  it("o menu e a barra escrevem os atalhos da plataforma, e o leitor de tela recebe os nomes das teclas da web", () => {
    expect(editShortcuts(windows)).toEqual({
      edit: { label: "F2", aria: "F2" },
      newRow: { label: "Alt+Insert", aria: "Alt+Insert" },
      duplicateRow: { label: "Ctrl+Alt+Insert", aria: "Control+Alt+Insert" },
      deleteRow: { label: "Alt+Delete", aria: "Alt+Delete" },
    });
    expect(editShortcuts(mac)).toEqual({
      edit: { label: "F2", aria: "F2" },
      newRow: { label: "Option+Insert", aria: "Alt+Insert" },
      duplicateRow: { label: "Cmd+Option+Insert", aria: "Meta+Alt+Insert Control+Alt+Insert" },
      deleteRow: { label: "Option+Delete", aria: "Alt+Backspace Alt+Delete" },
    });
  });
});
