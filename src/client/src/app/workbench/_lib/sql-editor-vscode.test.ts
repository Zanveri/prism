import { addCursorBelow, copyLineDown, deleteLine, moveLineDown, simplifySelection, toggleBlockComment, toggleComment } from "@codemirror/commands";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { EditorSelection, EditorState, type Extension, type SelectionRange, type StateCommand, type TransactionSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  applySearchQueryState,
  defaultFindOptions,
  findMatches,
  findNextState,
  findSelectionMatchRanges,
  goToLineOffset,
  indentationFoldRange,
  insertBlankLineAbove,
  parseGoToLine,
  replaceAllState,
  replaceNextState,
  searchState,
  selectAllOccurrencesState,
  selectFullLine,
  selectNextOccurrenceState,
  setSearchQuery,
  skipLastOccurrenceState,
} from "./sql-editor-vscode";

const multiCursorExtensions: Extension = [EditorState.allowMultipleSelections.of(true), searchState, sql({ dialect: StandardSQL })];

function runCommand(state: EditorState, command: StateCommand): EditorState {
  let next = state;
  const ran = command({
    state,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  expect(ran).toBe(true);
  return next;
}

function runViewCommand(state: EditorState, command: Command): EditorState {
  let next = state;
  const viewStub = {
    state,
    lineWrapping: false,
    moveVertically(range: SelectionRange, forward: boolean) {
      const line = state.doc.lineAt(range.head);
      const col = range.head - line.from;
      const targetNo = forward ? line.number + 1 : line.number - 1;
      if (targetNo < 1 || targetNo > state.doc.lines) return range;
      const target = state.doc.line(targetNo);
      return EditorSelection.cursor(Math.min(target.from + col, target.to));
    },
    dispatch(...specs: TransactionSpec[]) {
      next = state.update(...specs).state;
    },
  } as unknown as EditorView;
  expect(command(viewStub)).toBe(true);
  return next;
}

describe("seleção de ocorrências ao estilo VS Code (Ctrl+D, Ctrl+K Ctrl+D, Ctrl+Shift+L)", () => {
  it("Ctrl+D sem seleção seleciona a palavra sob o cursor (inclusive acentos e @variável) e a cada repetição adiciona só palavras inteiras", () => {
    const doc = "SELECT item, item_id, ITEM, @ação FROM t WHERE item = @ação;";
    let state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(9), // no meio do primeiro `item`
      extensions: multiCursorExtensions,
    });

    // 1º Ctrl+D: seleciona `item` (7..11)
    state = state.update(selectNextOccurrenceState(state)!).state;
    expect(state.selection.ranges.map((r) => doc.slice(r.from, r.to))).toEqual(["item"]);

    // 2º Ctrl+D: pula `item_id` e adiciona `ITEM` (case-insensitive por padrão)
    state = state.update(selectNextOccurrenceState(state)!).state;
    expect(state.selection.ranges.map((r) => [r.from, doc.slice(r.from, r.to)])).toEqual([
      [7, "item"],
      [22, "ITEM"],
    ]);

    // 3º Ctrl+D: adiciona o último `item` no WHERE
    state = state.update(selectNextOccurrenceState(state)!).state;
    expect(state.selection.ranges).toHaveLength(3);

    // Variável com `@` e acento também conta como palavra SQL inteira
    const varPos = doc.indexOf("@ação") + 2;
    const varState = EditorState.create({ doc, selection: EditorSelection.cursor(varPos), extensions: multiCursorExtensions });
    const selectedVar = varState.update(selectNextOccurrenceState(varState)!).state;
    expect(doc.slice(selectedVar.selection.main.from, selectedVar.selection.main.to)).toBe("@ação");
  });

  it("Ctrl+D com seleção parcial (não palavra inteira) busca substrings e dá a volta no fim do texto", () => {
    const doc = "item_a, item_b, item_c";
    let state = EditorState.create({
      doc,
      selection: EditorSelection.single(8, 12), // `item` dentro de `item_b`
      extensions: multiCursorExtensions,
    });

    state = state.update(selectNextOccurrenceState(state)!).state;
    expect(state.selection.ranges.map((r) => r.from)).toEqual([8, 16]);

    // Dá a volta para `item_a` no início
    state = state.update(selectNextOccurrenceState(state)!).state;
    expect(state.selection.ranges.map((r) => r.from)).toEqual([0, 8, 16]);
  });

  it("Ctrl+K Ctrl+D pula a ocorrência atual e Ctrl+Shift+L seleciona todas de uma vez", () => {
    const doc = "id = 1 OR id = 2 OR id = 3";
    let state = EditorState.create({
      doc,
      selection: EditorSelection.single(0, 2),
      extensions: multiCursorExtensions,
    });

    state = state.update(skipLastOccurrenceState(state)!).state;
    expect(state.selection.ranges.map((r) => [r.from, r.to])).toEqual([[10, 12]]);

    const all = state.update(selectAllOccurrencesState(state)!).state;
    expect(all.selection.ranges.map((r) => [r.from, r.to])).toEqual([
      [0, 2],
      [10, 12],
      [20, 22],
    ]);
  });
});

describe("múltiplos cursores e comandos de linha do VS Code", () => {
  it("Ctrl+Alt+Seta para baixo cria cursores verticais e Esc colapsa para o cursor principal", () => {
    let state = EditorState.create({
      doc: "  a = 1,\n  b = 2,\n  c = 3",
      selection: EditorSelection.cursor(2),
      extensions: multiCursorExtensions,
    });

    state = runViewCommand(state, addCursorBelow);
    state = runViewCommand(state, addCursorBelow);
    expect(state.selection.ranges.map((r) => r.head)).toEqual([2, 11, 20]);

    state = runCommand(state, simplifySelection);
    expect(state.selection.ranges).toHaveLength(1);
  });

  it("Ctrl+L seleciona a linha inteira e estende linha a linha; Ctrl+Shift+Enter abre linha acima mantendo o recuo", () => {
    let state = EditorState.create({
      doc: "SELECT\n    item_id,\n    language\nFROM t;",
      selection: EditorSelection.cursor(12), // na 2ª linha
      extensions: multiCursorExtensions,
    });

    const withBlankAbove = runCommand(state, insertBlankLineAbove);
    expect(withBlankAbove.doc.toString()).toBe("SELECT\n    \n    item_id,\n    language\nFROM t;");
    expect(withBlankAbove.selection.main.head).toBe(11); // após os 4 espaços de recuo

    state = runCommand(state, selectFullLine);
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("    item_id,\n");
    state = runCommand(state, selectFullLine);
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("    item_id,\n    language\n");
  });

  it("Alt+Seta, Shift+Alt+Seta, Ctrl+Shift+K, Ctrl+/ e Shift+Alt+A manipulam linhas e comentários SQL", () => {
    let state = EditorState.create({
      doc: "SELECT 1;\nSELECT 2;",
      selection: EditorSelection.cursor(2),
      extensions: multiCursorExtensions,
    });

    state = runCommand(state, moveLineDown);
    expect(state.doc.toString()).toBe("SELECT 2;\nSELECT 1;");

    state = runCommand(state, copyLineDown);
    expect(state.doc.toString()).toBe("SELECT 2;\nSELECT 1;\nSELECT 1;");

    state = runCommand(state, toggleComment);
    expect(state.doc.line(3).text).toBe("-- SELECT 1;");

    state = runViewCommand(state, deleteLine);
    expect(state.doc.toString()).toBe("SELECT 2;\nSELECT 1;");

    const blockSel = state.update({ selection: EditorSelection.single(0, 8) }).state;
    expect(runCommand(blockSel, toggleBlockComment).doc.line(1).text).toBe("/* SELECT 2 */;");
  });
});

describe("localizar e substituir (Ctrl+F / Ctrl+H / F3)", () => {
  it("respeita maiúsculas, palavra inteira, regex com grupos de captura, regex inválida e regex de tamanho zero", () => {
    const doc = "DELETE FROM scada WHERE item_id = item_id_aft AND item = 'ITEM';";

    expect(findMatches(doc, "item", defaultFindOptions).matches).toHaveLength(4);
    expect(findMatches(doc, "item", { ...defaultFindOptions, matchCase: true }).matches).toHaveLength(3);
    expect(findMatches(doc, "item", { ...defaultFindOptions, wholeWord: true }).matches).toHaveLength(2);

    // Regex inválida sinaliza erro sem lançar exceção
    expect(findMatches(doc, "[unclosed", { ...defaultFindOptions, regex: true })).toEqual({ matches: [], invalidRegex: true });

    // Regex de comprimento zero avança sem entrar em laço infinito
    expect(findMatches("abc", "^|(?=b)", { ...defaultFindOptions, regex: true }).matches).toEqual([]);

    let state = EditorState.create({ doc: "col_a = col_a_old, col_b = col_b_old", extensions: multiCursorExtensions });
    state = state.update(
      applySearchQueryState(state, "(col_[ab])_old", { matchCase: false, wholeWord: false, regex: true }, true),
    ).state;
    expect(state.field(searchState).matches).toHaveLength(2);
    expect(state.field(searchState).activeIndex).toBe(0);

    // Substituir uma ocorrência avança para a próxima
    state = state.update(replaceNextState(state, "$1_new")!).state;
    expect(state.doc.toString()).toBe("col_a = col_a_new, col_b = col_b_old");
    expect(state.field(searchState).matches).toHaveLength(1);
    expect(state.field(searchState).activeIndex).toBe(0);

    // Substituir tudo troca todas as restantes
    state = state.update(replaceAllState(state, "$1_done")!).state;
    expect(state.doc.toString()).toBe("col_a = col_a_new, col_b = col_b_done");
    expect(state.field(searchState).matches).toHaveLength(0);
  });

  it("F3 navega mesmo após fechar a barra de busca usando a última consulta como fallback", () => {
    const doc = "SELECT a FROM t WHERE a = 1;";
    let state = EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: multiCursorExtensions });
    state = state.update({ effects: setSearchQuery.of(null) }).state;

    const next = findNextState(state, 1, { query: "a", options: { ...defaultFindOptions, wholeWord: true } });
    expect(next).not.toBeNull();
    state = state.update(next!).state;
    expect([state.selection.main.from, state.selection.main.to]).toEqual([7, 8]);
  });
});

describe("ir para a linha (Ctrl+G) e dobramento por recuo de SQL", () => {
  it("lê linha e coluna em vários formatos e limita aos limites do documento", () => {
    expect(parseGoToLine("185")).toEqual({ line: 185, column: 1 });
    expect(parseGoToLine(":185:14")).toEqual({ line: 185, column: 14 });
    expect(parseGoToLine("0")).toBeNull();
    expect(parseGoToLine("abc")).toBeNull();

    const state = EditorState.create({ doc: "linha 1\nlinha 2\nEND PROCEDURE;" });
    expect(goToLineOffset(state, "2:7")).toBe(14);
    expect(goToLineOffset(state, "999:99")).toBe(state.doc.length);
  });

  it("dobra blocos IF / CASE / WHEN de uma procedure SQL mantendo o END correspondente visível, como no VS Code", () => {
    const procedure = [
      "CREATE OR REPLACE PROCEDURE spl_test (", // L1
      "  IF opType == 'D' THEN", // L2
      "    CASE company_code_aft", // L3
      "      WHEN 204 THEN", // L4
      "        DELETE FROM t1;", // L5
      "      WHEN 209 THEN", // L6
      "        DELETE FROM t2", // L7
      "          WHERE item_id = item_id_aft;", // L8
      "    END CASE;", // L9
      "  END IF", // L10
      "END PROCEDURE;", // L11
    ].join("\n");

    const state = EditorState.create({ doc: procedure });

    // Dobrar o `WHEN 204 THEN` (L4) esconde L5 e deixa `WHEN 209 THEN` (L6) à vista
    expect(indentationFoldRange(state, state.doc.line(4).from)).toEqual({
      from: state.doc.line(4).to,
      to: state.doc.line(5).to,
    });

    // Dobrar o `IF` (L2) esconde até L9 (`END CASE;`), deixando `END IF` (L10) e `END PROCEDURE;` (L11) visíveis
    expect(indentationFoldRange(state, state.doc.line(2).from)).toEqual({
      from: state.doc.line(2).to,
      to: state.doc.line(9).to,
    });

    // Dobrar o cabeçalho da procedure (L1) esconde L2..L10 e mantém `END PROCEDURE;` (L11) visível
    expect(indentationFoldRange(state, state.doc.line(1).from)).toEqual({
      from: state.doc.line(1).to,
      to: state.doc.line(10).to,
    });
  });
});

describe("destaque de textos iguais à seleção (selectionMatchHighlight)", () => {
  it("destaca todas as demais ocorrências iguais (palavra, trecho parcial, 1 caractere e multi-cursor Ctrl+D)", () => {
    const doc = "SELECT item_id, item_id_aft, ITEM_ID FROM scada WHERE x = 1 AND y = 1;";
    const fullVisible = [{ from: 0, to: doc.length }];

    // Seleção de palavra/trecho parcial ("item_id" aparece em `item_id_aft` e `ITEM_ID`)
    let state = EditorState.create({
      doc,
      selection: EditorSelection.single(7, 14),
      extensions: multiCursorExtensions,
    });
    expect(findSelectionMatchRanges(state, fullVisible)).toEqual([
      { from: 16, to: 23 },
      { from: 29, to: 36 },
    ]);

    // Com Ctrl+D adicionando a próxima palavra inteira (`ITEM_ID`), a ocorrência parcial restante continua destacada
    state = state.update(selectNextOccurrenceState(state, false)!).state;
    expect(state.selection.ranges).toHaveLength(2);
    expect(findSelectionMatchRanges(state, fullVisible)).toEqual([{ from: 16, to: 23 }]);

    // Seleção de 1 caractere ("1") destaca o outro "1"
    const firstOne = doc.indexOf("1");
    const secondOne = doc.lastIndexOf("1");
    const singleChar = EditorState.create({
      doc,
      selection: EditorSelection.single(firstOne, firstOne + 1),
      extensions: multiCursorExtensions,
    });
    expect(findSelectionMatchRanges(singleChar, fullVisible)).toEqual([{ from: secondOne, to: secondOne + 1 }]);

    // Cursor vazio, seleção só de espaços, multilinhas ou busca ativa não geram destaques duplicados
    const empty = EditorState.create({ doc, selection: EditorSelection.cursor(7), extensions: multiCursorExtensions });
    expect(findSelectionMatchRanges(empty, fullVisible)).toEqual([]);

    const spaces = EditorState.create({ doc, selection: EditorSelection.single(6, 7), extensions: multiCursorExtensions });
    expect(findSelectionMatchRanges(spaces, fullVisible)).toEqual([]);

    const withActiveFind = state.update(applySearchQueryState(state, "item_id", defaultFindOptions, false)).state;
    expect(findSelectionMatchRanges(withActiveFind, fullVisible)).toEqual([]);
  });
});
