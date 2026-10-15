import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { flashedRange, runFlash } from "../_lib/run-flash";
import { flashEffect, flashRangeOf, runTarget } from "./sql-editor";

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
