import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { flashedRange, runFlash } from "../_lib/run-flash";
import { scriptMark, scriptMarkEffects, scriptMarkedRange } from "../_lib/script-mark";
import { flashEffect, flashRangeOf, runTarget, scriptTargets } from "./sql-editor";

const postgres: Engine = 1;
const informix: Engine = 3;

/** `§` marca o cursor; dois `§` marcam a seleção. */
function stateOf(marked: string, extensions: Extension = []): EditorState {
  const first = marked.indexOf("§");
  const second = marked.indexOf("§", first + 1);
  const doc = marked.replaceAll("§", "");
  const selection = second < 0 ? EditorSelection.single(first) : EditorSelection.single(first, second - 1);
  return EditorState.create({ doc, selection, extensions });
}

// O que o Ctrl+Enter e o botão "Executar" mandam ao executor (RN-SQL-001, 002 e 018). O vitest não tem DOM: o que se confere é o que sai do estado do editor.
describe("o que Executar envia (RN-SQL-001 e RN-SQL-018)", () => {
  it("sem seleção, com a linha em branco ligada, só o comando do cursor, e onde ele começa no texto", () => {
    const sql = "SELECT 1 FROM t\n\nSELECT 2 FROM t";

    expect(runTarget(stateOf("SELECT 1 FROM t\n\nSELECT §2 FROM t"), postgres, true)).toEqual({ sql: "SELECT 2 FROM t", offset: 17, engine: postgres });
    expect(runTarget(stateOf("SELECT §1 FROM t\n\nSELECT 2 FROM t"), informix, true)).toEqual({ sql: "SELECT 1 FROM t", offset: 0, engine: informix });
    // Desligada, vale só o `;`, como antes: os dois vão juntos.
    expect(runTarget(stateOf("SELECT 1 FROM t\n\nSELECT §2 FROM t"), postgres, false)).toEqual({ sql, offset: 0, engine: postgres });
  });

  it("o cursor na linha em branco que separa manda o comando de cima; sem comando acima, nada (o executor diz que não há comando)", () => {
    expect(runTarget(stateOf("SELECT 1 FROM t\n§\nSELECT 2 FROM t"), postgres, true).sql).toBe("SELECT 1 FROM t");
    expect(runTarget(stateOf("-- título\n§\nSELECT 1 FROM t"), postgres, true)).toEqual({ sql: "", offset: 10, engine: postgres });
    // No começo do texto também: nada acima, nada abaixo, nem o DELETE. Desligada, vale a resposta de antes, o comando seguinte.
    expect(runTarget(stateOf("§\n\nDELETE FROM t WHERE id = 1"), postgres, true)).toEqual({ sql: "", offset: 0, engine: postgres });
    expect(runTarget(stateOf("§\n\nDELETE FROM t WHERE id = 1"), postgres, false).sql).toBe("DELETE FROM t WHERE id = 1");
  });

  it("o cursor na linha em branco depois de um `;` manda o comando seguinte, como antes, com a preferência ligada ou desligada", () => {
    for (const blankLines of [true, false]) expect(runTarget(stateOf("DELETE FROM t WHERE id = 1;\n§\nSELECT * FROM t;"), postgres, blankLines).sql).toBe("SELECT * FROM t");
  });

  it("a seleção vai como está, com linhas em branco e tudo, com a preferência ligada ou desligada", () => {
    const selected = "SELECT 1 FROM t\n\nSELECT 2 FROM t";

    for (const blankLines of [true, false]) expect(runTarget(stateOf(`-- x\n§${selected}§\n`), postgres, blankLines)).toEqual({ sql: selected, offset: 5, engine: postgres });
  });
});

describe("o destaque do comando enviado (RN-SQL-018)", () => {
  const flashOf = (marked: string, blankLines = true) => {
    const state = stateOf(marked);
    return flashRangeOf(state, runTarget(state, postgres, blankLines));
  };

  it("sem seleção, pisca exatamente o trecho que foi enviado", () => {
    const sql = "SELECT 1 FROM t\n\nSELECT 2 FROM t";

    expect(flashOf("SELECT 1 FROM t\n\nSELECT §2 FROM t")).toEqual({ from: 17, to: 32 });
    expect(flashOf("SELECT 1 FROM t\n§\nSELECT 2 FROM t")).toEqual({ from: 0, to: 15 });
    expect(flashOf("SELECT 1 FROM t\n\nSELECT §2 FROM t", false)).toEqual({ from: 0, to: sql.length });
  });

  it("acende quando quem executa manda (o comando foi ao banco), e só se o trecho ainda é o texto enviado", () => {
    const state = stateOf("SELECT 1 FROM t\n\nSELECT §2 FROM t", runFlash);
    const target = runTarget(state, postgres, true);
    const range = flashRangeOf(state, target);

    const effect = flashEffect(state, range, target.sql);
    expect(effect).not.toBeNull();
    expect(flashedRange(state.update({ effects: effect! }).state)).toMatchObject({ from: 17, to: 32 });
    // A pergunta das alterações não salvas (RN-EDIT-007) fica entre apertar e enviar: a edição no meio desfaz o trecho, e nada pisca.
    expect(flashEffect(state.update({ changes: { from: 17, insert: "-- " } }).state, range, target.sql)).toBeNull();
    expect(flashEffect(state, null, target.sql)).toBeNull();
  });

  it("a seleção não pisca, e sem comando nada pisca", () => {
    expect(flashOf("§SELECT 1§ FROM t")).toBeNull();
    expect(flashOf("-- título\n§\nSELECT 1 FROM t")).toBeNull();
    expect(flashOf("§\n\nSELECT 1 FROM t")).toBeNull();
    expect(flashOf("-- só um comentário§")).toBeNull();
  });
});

// O que "Executar script" manda ao executor (RN-SQL-019): os comandos, com o lugar de cada um no texto do editor, por onde o erro e a marca acham o lugar.
describe("o que Executar script envia (RN-SQL-019)", () => {
  it("sem seleção, os comandos do texto inteiro, onde quer que esteja o cursor, cada um com o lugar dele no texto", () => {
    const state = stateOf("select 1;\n-- lê\nselect § 2 from t;\n\n");

    expect(scriptTargets(state, postgres, true)).toEqual([
      { sql: "select 1", offset: 0, engine: postgres },
      { sql: "-- lê\nselect  2 from t", offset: 10, engine: postgres },
    ]);
  });

  it("com seleção, só os comandos dela, com o lugar no texto inteiro", () => {
    const state = stateOf("select 0;\n§select 1;\nselect 2;§\nselect 3;");

    expect(scriptTargets(state, postgres, false)).toEqual([
      { sql: "select 1", offset: 10, engine: postgres },
      { sql: "select 2", offset: 20, engine: postgres },
    ]);
  });

  it("no script a linha em branco divide também a seleção, com a preferência ligada; desligada, só o `;`", () => {
    const selected = "SELECT 1 FROM t\n\nSELECT 2 FROM t";
    const state = stateOf(`-- x\n§${selected}§\n`);

    expect(scriptTargets(state, postgres, true).map((target) => [target.sql, target.offset])).toEqual([
      ["SELECT 1 FROM t", 5],
      ["SELECT 2 FROM t", 22],
    ]);
    expect(scriptTargets(state, postgres, false).map((target) => target.sql)).toEqual([selected]);
  });

  it("o bloco com `;` no corpo vai como um comando só, pelas regras do banco da aba", () => {
    const routine = "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE";

    expect(scriptTargets(stateOf(`§${routine};\nSELECT 1`), informix, true).map((target) => target.sql)).toEqual([routine, "SELECT 1"]);
  });

  it("sem comando nenhum (só comentários), nada", () => {
    expect(scriptTargets(stateOf("-- nada§ aqui\n/* nem aqui */"), postgres, true)).toEqual([]);
  });
});

describe("a marca do comando do script em execução (RN-SQL-019)", () => {
  const sql = "select 1;\nselect 2;";
  const second = { offset: 10, sql: "select 2" };
  const apply = (state: EditorState, running: { offset: number; sql: string } | null) => state.update({ effects: scriptMarkEffects(state, running) }).state;

  it("marca o trecho do comando e o tira quando nada roda; não muda o texto nem a seleção", () => {
    const state = EditorState.create({ doc: sql, selection: EditorSelection.single(3), extensions: scriptMark });
    const marked = apply(state, second);

    expect(scriptMarkedRange(marked)).toEqual({ from: 10, to: 18 });
    expect(marked.doc.toString()).toBe(sql);
    expect(marked.selection.main.head).toBe(3);
    expect(scriptMarkedRange(apply(marked, null))).toBeNull();
  });

  it("acompanha a edição do texto; e não marca nada quando o texto naquele lugar já não é o do comando", () => {
    const marked = apply(EditorState.create({ doc: sql, extensions: scriptMark }), second);
    const edited = marked.update({ changes: { from: 0, insert: "-- x\n" } }).state;

    expect(scriptMarkedRange(edited)).toEqual({ from: 15, to: 23 });
    // O lugar que o executor conhece é o de antes da edição: nada a marcar, e a marca de antes sai.
    expect(scriptMarkedRange(apply(edited, { offset: 0, sql: "select 1" }))).toBeNull();
    expect(scriptMarkEffects(EditorState.create({ doc: sql, extensions: scriptMark }), { offset: 0, sql: "select 9" })).toEqual([]);
  });
});
