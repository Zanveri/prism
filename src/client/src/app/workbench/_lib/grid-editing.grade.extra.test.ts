import { describe, expect, it } from "vitest";

import { deleteRowsAccess, type RowContext, type SelectedRow } from "./cell-editing";
import { deletesRows, rowShortcut } from "./grid-editing";
import { collapse, deleteKeyRows, emptySelection, extend, extendRows, select, selectAll, selectColumn, selectNewRows, selectRow, toggleRow, wholeColumns, wholeRows, type GridLayout, type GridSelection } from "./grid-selection";
import type { EditTarget } from "./record-edits.schema";

// Casos extra do Delete sozinho (RN-EDIT-015, como o Delete que marca na hora, sem pergunta, e o Alt+Delete, RN-EDIT-014). Os valores esperados vêm das decisões
// (`reports/navegacao-grade-completar-mac-decisoes.md`, frente B) e da especificação, e não do código. O que o teste de `grid-editing.test.ts` e o de
// `grid-selection.test.ts` já cobrem não se repete aqui.

/** Cinco linhas lidas (posições 0 a 4), duas novas (ids 7 e 9, posições 5 e 6) e quatro colunas: a grade dos testes da seleção. */
const layout: GridLayout = { read: 5, added: [7, 9], columns: 4 };
/** Grade sem linha nenhuma. */
const none: GridLayout = { read: 0, added: [], columns: 2 };

const at = (row: number, column: number) => ({ row, column });
const clicked = (row: number, column: number, base: GridSelection = emptySelection, grid: GridLayout = layout) => select(base, at(row, column), grid);

describe("quais linhas o Delete cobre: as da seleção, as mesmas do Alt+Delete (RN-EDIT-014 e 015)", () => {
  it.each<[string, GridSelection, GridLayout, number[]]>([
    ["a célula ativa só, numa linha lida", clicked(3, 2), layout, [3]],
    ["a célula ativa só, numa linha nova (a segunda, posição 6)", clicked(6, 1), layout, [6]],
    ["a célula ativa numa coluna qualquer: a coluna não muda a linha", clicked(0, 3), layout, [0]],
    ["nada escolhido, sem célula ativa", emptySelection, layout, []],
    ["grade sem linha nenhuma", select(emptySelection, at(0, 0), none), none, []],
    ["um retângulo que fica numa linha só, de uma coluna a outra", extend(clicked(1, 0), at(1, 2), layout), layout, [1]],
    ["um retângulo de uma linha a outra", extend(clicked(1, 0), at(3, 2), layout), layout, [1, 2, 3]],
    ["um retângulo de baixo para cima", extend(clicked(4, 1), at(2, 3), layout), layout, [2, 3, 4]],
    ["um retângulo da linha lida até a linha nova", extend(clicked(3, 1), at(6, 2), layout), layout, [3, 4, 5, 6]],
    ["um retângulo que cobre todas as colunas continua valendo pelas linhas dele", extend(clicked(1, 0), at(2, 3), layout), layout, [1, 2]],
    ["linhas inteiras pela célula ativa (Shift+Espaço)", wholeRows(clicked(2, 1)), layout, [2]],
    ["linhas inteiras de um retângulo", wholeRows(extend(clicked(0, 1), at(2, 2), layout)), layout, [0, 1, 2]],
    ["uma linha pelo número dela (clique no número)", selectRow(emptySelection, 4, layout), layout, [4]],
    ["linhas em três faixas separadas (Ctrl+clique no número)", toggleRow(toggleRow(selectRow(emptySelection, 0, layout), 2, layout), 4, layout), layout, [0, 2, 4]],
    ["faixas separadas com uma linha nova no meio", toggleRow(toggleRow(toggleRow(selectRow(emptySelection, 0, layout), 1, layout), 3, layout), 6, layout), layout, [0, 1, 3, 6]],
    ["Ctrl+clique tira a linha do meio de uma faixa", toggleRow(extendRows(selectRow(emptySelection, 0, layout), 4, layout), 2, layout), layout, [0, 1, 3, 4]],
    ["Ctrl+A: todas as linhas, lidas e novas", selectAll(clicked(0, 0), layout), layout, [0, 1, 2, 3, 4, 5, 6]],
    ["linhas novas na ordem da grade, não na ordem em que foram escolhidas", selectNewRows([9, 7], 0), layout, [5, 6]],
    ["o Esc deixa só a célula ativa da linha", collapse(selectRow(emptySelection, 2, layout)), layout, [2]],
    ["colunas inteiras: o Delete não faz nada", selectColumn(emptySelection, 2, layout), layout, []],
    ["colunas inteiras de um retângulo: o Delete não faz nada", wholeColumns(extend(clicked(0, 0), at(2, 1), layout), layout), layout, []],
  ])("%s", (_name, selection, grid, rows) => {
    expect(deleteKeyRows(selection, grid)).toEqual(rows);
  });
});

// Sem o 1.000 (que é do duplicar, RN-EDIT-016): a spec não dá número ao Excluir, e as decisões dizem só "o mesmo limite" que o Alt+Delete.
// Este bloco fixa o que a spec diz (nenhum teto numérico para o Excluir); se o arquiteto quiser um teto, é este bloco que muda (ver o relatório).
const liveRow: RowContext = { kind: "read", truncated: undefined, deleted: false, values: ["1", "x"] };
const rowsOf = (count: number): SelectedRow[] => Array.from({ length: count }, (_, index) => ({ number: index + 1, row: liveRow }));

describe("o limite do Delete: nenhum teto numérico na spec para o Excluir (decidir; RN-EDIT-016 só dá 1.000 ao duplicar)", () => {
  it.each([1000, 1001])("%i linhas lidas escolhidas com Ctrl+A: todas cobertas, e a ação não recusa pelo tamanho", (count) => {
    const big: GridLayout = { read: count, added: [], columns: 1 };
    const chosen = selectAll(select(emptySelection, at(0, 0), big), big);

    expect(deleteKeyRows(chosen, big)).toEqual(Array.from({ length: count }, (_, index) => index));
    expect(deleteRowsAccess(rowsOf(count), null, one, false)).toEqual({ editable: true });
  });
});

// As ações de linha com o motivo que a faixa e a barra mostram (RN-EDIT-014). Singular e plural: "a linha já está…" e "as linhas já estão…"; o motivo é o da
// primeira linha que não se exclui, com o número dela na grade, e nada é excluído quando alguma não se exclui.
const markedRow: RowContext = { kind: "read", truncated: undefined, deleted: true, values: ["2", "y"] };
const cutRow: RowContext = { kind: "read", truncated: new Set([0]), deleted: false };
const generatedRow: RowContext = { kind: "read", truncated: undefined, deleted: false, generated: new Set([0]) };
const newRow: RowContext = { kind: "new" };
const row = (number: number, context: RowContext): SelectedRow => ({ number, row: context });

const column = (baseColumn: string, over: Partial<EditTarget["columns"][number]> = {}): EditTarget["columns"][number] => ({
  table: 0,
  baseColumn,
  editable: true,
  reason: null,
  nullable: true,
  generated: null,
  ...over,
});
const pedidos = { schema: "loja", name: "pedidos", key: [0], editable: true, reason: null };
const one: EditTarget = { tables: [pedidos], columns: [column("id"), column("valor")], rowOperations: true, oneAtATime: false };
const joined: EditTarget = {
  tables: [pedidos, { schema: "loja", name: "clientes", key: [0], editable: true, reason: null }],
  columns: [column("id"), column("nome", { table: 1 })],
  rowOperations: true,
  oneAtATime: false,
};
const noRowOps: EditTarget = { ...one, rowOperations: false };
const view: EditTarget = {
  tables: [{ schema: "loja", name: "v_pedidos", key: [], editable: false, reason: "v_pedidos é uma visão" }],
  columns: [column("id")],
  rowOperations: false,
  oneAtATime: false,
};

const ONE_MARKED = "Somente leitura: a linha já está marcada para exclusão; Desfazer alteração a devolve.";
const MANY_MARKED = "Somente leitura: as linhas já estão marcadas para exclusão; Desfazer alteração as devolve.";
const KEY_CUT = "Somente leitura: a chave desta linha chegou cortada.";
const keyCutAt = (number: number) => `Somente leitura: a chave da linha ${number} chegou cortada.`;
const KEY_GENERATED = "Somente leitura: a chave desta linha foi gerada pelo banco; execute de novo para editá-la.";
const keyGeneratedAt = (number: number) => `Somente leitura: a chave da linha ${number} foi gerada pelo banco; execute de novo para editá-la.`;
const NO_ROW_OPERATIONS = "Somente leitura: este resultado não aceita linha nova nem exclusão.";
const JOIN = "Somente leitura: num resultado de junção só se alteram células.";
const BUSY = "Somente leitura: há um comando em andamento na aba.";
const REFRESHING = "Somente leitura: a atualização automática está lendo as linhas de novo; tente outra vez em um instante.";
const VIEW = "Somente leitura: v_pedidos é uma visão.";
const CONNECTION = "Somente leitura: a conexão é somente leitura.";

type Access = { editable: true } | { editable: false; reason: string };

describe("a ação Excluir linha(s) com o Delete: quando vale e por que não vale (RN-EDIT-014, o Delete = Alt+Delete)", () => {
  it.each<[string, SelectedRow[], { readOnly?: string | null; target?: EditTarget | null; busy?: boolean | "refresh" }, Access]>([
    ["uma linha lida, viva: vale", [row(1, liveRow)], { target: one }, { editable: true }],
    ["uma linha lida já marcada: o motivo no singular", [row(1, markedRow)], { target: one }, { editable: false, reason: ONE_MARKED }],
    ["duas linhas já marcadas: o motivo no plural", [row(1, markedRow), row(2, markedRow)], { target: one }, { editable: false, reason: MANY_MARKED }],
    ["uma marcada e uma viva: a marcada não impede", [row(1, markedRow), row(2, liveRow)], { target: one }, { editable: true }],
    ["já marcada, com o alvo ainda não perguntado: sabe-se sem a consulta", [row(1, markedRow)], { target: null }, { editable: false, reason: ONE_MARKED }],
    ["uma linha nova: sai da grade, vale", [row(1, newRow)], { target: one }, { editable: true }],
    ["novas e lidas vivas misturadas: vale", [row(1, newRow), row(2, liveRow), row(3, newRow)], { target: one }, { editable: true }],
    ["uma nova e uma lida já marcada: vale, a nova sai", [row(1, newRow), row(2, markedRow)], { target: one }, { editable: true }],
    ["a chave da segunda cortada: nada se exclui, e o número é o dela", [row(1, liveRow), row(2, cutRow), row(3, liveRow)], { target: one }, { editable: false, reason: keyCutAt(2) }],
    ["uma nova antes e a chave cortada depois: o número é o da cortada", [row(1, newRow), row(2, cutRow)], { target: one }, { editable: false, reason: keyCutAt(2) }],
    ["a marcada não impede a chave cortada da linha seguinte", [row(1, markedRow), row(2, cutRow)], { target: one }, { editable: false, reason: keyCutAt(2) }],
    ["uma linha só com a chave cortada: o motivo sem número", [row(4, cutRow)], { target: one }, { editable: false, reason: KEY_CUT }],
    ["uma linha só com a chave gerada pelo banco: o motivo sem número", [row(1, generatedRow)], { target: one }, { editable: false, reason: KEY_GENERATED }],
    ["com mais de uma, a chave gerada pelo banco leva o número da linha", [row(1, liveRow), row(3, generatedRow)], { target: one }, { editable: false, reason: keyGeneratedAt(3) }],
    ["resultado só de leitura (a conexão): a faixa de só leitura, uma linha", [row(1, liveRow)], { readOnly: "a conexão é somente leitura", target: one }, { editable: false, reason: CONNECTION }],
    ["resultado só de leitura, com linhas: a mesma faixa", [row(1, liveRow), row(2, liveRow)], { readOnly: "a conexão é somente leitura", target: one }, { editable: false, reason: CONNECTION }],
    ["só de leitura vale antes da marcada: o motivo é o de só leitura", [row(1, markedRow)], { readOnly: "a conexão é somente leitura", target: one }, { editable: false, reason: CONNECTION }],
    ["aba ocupada por um comando: a faixa da aba", [row(1, liveRow)], { target: one, busy: true }, { editable: false, reason: BUSY }],
    ["aba ocupada antes da chave cortada", [row(1, cutRow)], { target: one, busy: true }, { editable: false, reason: BUSY }],
    ["atualização automática lendo as linhas de novo", [row(1, liveRow)], { target: one, busy: "refresh" }, { editable: false, reason: REFRESHING }],
    ["resultado que não aceita linha nova nem exclusão, com uma nova", [row(1, liveRow), row(2, newRow)], { target: noRowOps }, { editable: false, reason: NO_ROW_OPERATIONS }],
    ["numa junção, uma linha: só se alteram células", [row(1, liveRow)], { target: joined }, { editable: false, reason: JOIN }],
    ["numa junção, várias linhas: o mesmo motivo", [row(1, liveRow), row(2, liveRow)], { target: joined }, { editable: false, reason: JOIN }],
    ["tabela que é visão: o motivo da tabela", [row(1, liveRow), row(2, liveRow)], { target: view }, { editable: false, reason: VIEW }],
    ["alvo ainda não perguntado: vale, a primeira tentativa pergunta", [row(1, liveRow), row(2, liveRow)], { target: null }, { editable: true }],
  ])("%s", (_name, rows, options, expected) => {
    expect(deleteRowsAccess(rows, options.readOnly ?? null, options.target === undefined ? one : options.target, options.busy ?? false)).toEqual(expected);
  });
});

// O Delete é a tecla; o atalho do Alt+Delete é o mesmo gesto para a mesma seleção. Aqui: quando a tecla age (`deletesRows`) e quando o atalho da linha
// (`rowShortcut`) age, nos três sistemas, com cada modificador, e o Backspace só no macOS (a tecla "delete" do Mac).
type Press = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
const press = (key: string, mods: Partial<Press> = {}): Press => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const windows = "Win32";
const linux = "Linux x86_64";
const mac = "MacIntel";
const modifiers: [string, Partial<Press>][] = [
  ["Ctrl", { ctrlKey: true }],
  ["Alt", { altKey: true }],
  ["Shift", { shiftKey: true }],
  ["Cmd (Meta)", { metaKey: true }],
  ["AltGr (Ctrl+Alt)", { ctrlKey: true, altKey: true }],
  ["Ctrl+Shift", { ctrlKey: true, shiftKey: true }],
];

describe("quando o Delete age: o Delete sozinho nos três sistemas, e o Backspace só no macOS (RN-EDIT-015)", () => {
  it.each<[string, Press, string, boolean]>([
    ["Delete sozinho no Windows", press("Delete"), windows, true],
    ["Delete sozinho no Linux", press("Delete"), linux, true],
    ["Delete sozinho no macOS (o fn+delete)", press("Delete"), mac, true],
    ["Backspace sozinho no Windows: é só apagar o texto, não o Delete", press("Backspace"), windows, false],
    ["Backspace sozinho no Linux: é só apagar o texto", press("Backspace"), linux, false],
    ["Backspace sozinho no macOS (a tecla delete do Mac)", press("Backspace"), mac, true],
    ["Insert não é o Delete", press("Insert"), windows, false],
    ["F2 não é o Delete (edita a célula)", press("F2"), mac, false],
    ["Enter não é o Delete", press("Enter"), linux, false],
    ["o espaço não é o Delete", press(" "), mac, false],
  ])("%s", (_name, event, platform, expected) => {
    expect(deletesRows(event, platform)).toBe(expected);
  });

  it.each(modifiers)("Delete com %s não age, em nenhum dos três sistemas", (_name, mods) => {
    for (const platform of [windows, linux, mac]) expect(deletesRows(press("Delete", mods), platform)).toBe(false);
  });

  it.each(modifiers)("Backspace com %s no macOS não age", (_name, mods) => {
    expect(deletesRows(press("Backspace", mods), mac)).toBe(false);
  });

  it.each<[string, Press, string, "deleteRow" | null]>([
    ["Alt+Delete no Windows: exclui as linhas da seleção pelo atalho", press("Delete", { altKey: true }), windows, "deleteRow"],
    ["Alt+Delete no Linux", press("Delete", { altKey: true }), linux, "deleteRow"],
    ["Option+Delete no macOS", press("Delete", { altKey: true }), mac, "deleteRow"],
    ["Option+Backspace no macOS (a tecla delete do Mac)", press("Backspace", { altKey: true }), mac, "deleteRow"],
    ["Alt+Backspace no Windows não é atalho", press("Backspace", { altKey: true }), windows, null],
    ["Alt+Shift+Delete não é atalho", press("Delete", { altKey: true, shiftKey: true }), linux, null],
    ["Ctrl+Alt+Delete no Windows (o AltGr) não é atalho", press("Delete", { altKey: true, ctrlKey: true }), windows, null],
    ["Cmd+Option+Delete no macOS não é atalho", press("Delete", { altKey: true, metaKey: true }), mac, null],
    ["o Delete sozinho não é atalho de linha (é a tecla que marca, `deletesRows`)", press("Delete"), windows, null],
  ])("%s", (_name, event, platform, expected) => {
    expect(rowShortcut(event, platform)).toBe(expected);
  });
});
