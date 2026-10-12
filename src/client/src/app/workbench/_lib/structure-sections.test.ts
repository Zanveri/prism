import { describe, expect, it } from "vitest";

import { breakableParts, entryMark, firstSection, orientationOf, structureSections } from "./structure-sections";
import type { LevelView } from "./table-structure";

const failed: LevelView = { kind: "error", message: "permission denied", sessionLost: false };

describe("structureSections: as seções da Estrutura, na ordem da lista lateral (RN-TABELA-009)", () => {
  it("Colunas, Chaves estrangeiras, Índices e DDL, nessa ordem", () => {
    expect([...structureSections]).toEqual(["columns", "foreignKeys", "indexes", "ddl"]);
  });

  it("a Estrutura abre em Colunas", () => {
    expect(firstSection).toBe("columns");
    expect(firstSection).toBe(structureSections[0]);
  });
});

describe("orientationOf: a lista de seções é uma fileira ou uma coluna conforme a direção que o CSS deu a ela", () => {
  it("row e row-reverse são a fileira (horizontal); column, column-reverse e o que não se reconhece são a coluna (vertical)", () => {
    expect(orientationOf("row")).toBe("horizontal");
    expect(orientationOf("row-reverse")).toBe("horizontal");
    expect(orientationOf("column")).toBe("vertical");
    expect(orientationOf("column-reverse")).toBe("vertical");
    expect(orientationOf("")).toBe("vertical");
    expect(orientationOf("nada")).toBe("vertical");
  });
});

describe("breakableParts: onde o nome de uma coluna, de uma restrição ou de um índice pode quebrar a linha", () => {
  it("depois de cada `_` e de cada `.`: a linha cai entre as palavras do nome", () => {
    expect(breakableParts("fk_users_academic_period_systems")).toEqual(["fk_", "users_", "academic_", "period_", "systems"]);
    expect(breakableParts("catalog.countries (id)")).toEqual(["catalog.", "countries (id)"]);
    expect(breakableParts("public.institution_campuses")).toEqual(["public.", "institution_", "campuses"]);
  });

  it("as partes juntas são o texto, sem nada a mais nem a menos", () => {
    for (const text of ["fk_users_academic_period_systems", "catalog.countries (institution_id, campus_id)", "__a__b.", "_", ".", "id", ""]) expect(breakableParts(text).join(""), text).toBe(text);
  });

  it("um nome sem `_` nem `.` é uma parte só, e o texto vazio também", () => {
    expect(breakableParts("observacao")).toEqual(["observacao"]);
    expect(breakableParts("timestamp with time zone")).toEqual(["timestamp with time zone"]);
    expect(breakableParts("")).toEqual([""]);
  });

  it("vários separadores seguidos viram uma parte cada: nenhuma fica vazia, salvo o texto vazio", () => {
    expect(breakableParts("a__b")).toEqual(["a_", "_", "b"]);
    expect(breakableParts("_a")).toEqual(["_", "a"]);
  });
});

describe("entryMark: o que a entrada da lista mostra à direita do nome", () => {
  it("a lista que chegou mostra quantos itens tem", () => {
    expect(entryMark({ kind: "ready" }, 16)).toEqual({ kind: "count", count: 16 });
    expect(entryMark({ kind: "ready" }, 1)).toEqual({ kind: "count", count: 1 });
  });

  it("a lista que chegou vazia mostra zero: é uma contagem, e não a falta dela", () => {
    expect(entryMark({ kind: "empty" }, 0)).toEqual({ kind: "count", count: 0 });
    // `empty` quer dizer que a lista chegou sem itens: as linhas que sobraram de antes não contam.
    expect(entryMark({ kind: "empty" }, 3)).toEqual({ kind: "count", count: 0 });
  });

  it("enquanto a lista carrega a entrada não mostra número, nem zero (também ao buscar de novo, com a lista velha ainda na mão)", () => {
    expect(entryMark({ kind: "loading" }, 0)).toEqual({ kind: "none" });
    expect(entryMark({ kind: "loading" }, 16)).toEqual({ kind: "none" });
  });

  it("a lista que falhou mostra a marca de aviso no lugar do número, mesmo com a lista de antes ainda na mão", () => {
    expect(entryMark(failed, 0)).toEqual({ kind: "failed" });
    expect(entryMark(failed, 16)).toEqual({ kind: "failed" });
  });
});
