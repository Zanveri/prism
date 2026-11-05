import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import type { Column, ForeignKey } from "./database-sessions.schema";
import { descriptionColumnOf, placesOf, restrictionOf, tablesOf, targetOf, type Place } from "./variable-inference";
import { readScript } from "./variables/script";

// RN-VAR-030: os casos de `variable-inference.cases.json` (escritos à mão, nunca regerados do código) e o que o catálogo da coluna restringe.
type Case = { name: string; engine: Engine; input: string; places: Record<string, Place[] | null> };
const cases = (JSON.parse(readFileSync(new URL("./variable-inference.cases.json", import.meta.url), "utf8")) as { cases: Case[] }).cases;

describe("os lugares que contam", () => {
  it.each(cases)("$name", (c) => {
    const model = readScript(c.input, c.engine, { blankLines: true });
    expect(Object.fromEntries(placesOf(model, c.engine))).toEqual(c.places);
  });
});

const column = (name: string, type: string, extra: Partial<Column> = {}): Column => ({ name, type, isNullable: true, isPrimaryKey: false, position: 1, defaultValue: null, generated: null, ...extra });
const key = (columns: string[], table: string, referenced: string[]): ForeignKey => ({ name: "fk", columns, referencedSchema: "public", referencedTable: table, referencedColumns: referenced });

describe("a coluna a que os lugares levam", () => {
  const resolve = (schema: string | null, table: string) => ({ schema: schema ?? "public", table });

  it("todos os lugares têm de dar a mesma coluna", () => {
    const place = (column: string, kind: Place["kind"] = "compare"): Place => ({ schema: null, table: "pedido", column, kind });
    expect(targetOf([place("cliente_id"), place("cliente_id", "insert")], resolve)).toEqual({ target: { schema: "public", table: "pedido", column: "cliente_id" }, compared: false });
    expect(targetOf([place("cliente_id"), place("loja_id")], resolve)).toBeNull();
    expect(targetOf(null, resolve)).toBeNull();
    expect(targetOf([place("cliente_id")], () => null)).toBeNull();
  });

  it("conta as tabelas diferentes, para o limite de 20", () => {
    const places = new Map([["a", [{ schema: null, table: "t1", column: "c", kind: "compare" as const }, { schema: null, table: "t2", column: "c", kind: "compare" as const }]], ["b", null]]);
    expect(tablesOf(places).size).toBe(2);
  });
});

describe("o que o catálogo restringe", () => {
  const target = { schema: "public", table: "pedido", column: "cliente_id" };
  const columns = [column("id", "integer", { isPrimaryKey: true }), column("cliente_id", "integer"), column("nota", "text")];
  const how = { compared: true, columnType: false, variable: "number" as const };

  it("a chave estrangeira de uma coluna só dá os valores da coluna referenciada", () => {
    expect(restrictionOf(target, how, columns, [key(["cliente_id"], "cliente", ["id"])], 1)).toEqual({ schema: "public", table: "cliente", column: "id", strict: true });
  });

  it("a chave de várias colunas desiste", () => {
    expect(restrictionOf(target, how, columns, [key(["cliente_id", "loja_id"], "cliente", ["id", "loja_id"])], 1)).toBeNull();
  });

  it("a chave primária sozinha dá os valores dela mesma, só nas comparações, e só como aviso", () => {
    const id = { ...target, column: "id" };
    expect(restrictionOf(id, how, columns, [], 1)).toEqual({ ...id, strict: false });
    expect(restrictionOf(id, { ...how, compared: false }, columns, [], 1)).toBeNull();
  });

  it("no tipo de coluna, a coluna que não é chave dá os valores dela mesma", () => {
    expect(restrictionOf(target, { compared: false, columnType: true, variable: null }, columns, [], 1)).toEqual({ ...target, strict: true });
    expect(restrictionOf(target, how, columns, [], 1)).toBeNull();
  });

  it("o tipo que não casa com o da variável e a coluna binária desistem", () => {
    expect(restrictionOf(target, { ...how, variable: "string" }, columns, [key(["cliente_id"], "cliente", ["id"])], 1)).toBeNull();
    expect(restrictionOf({ ...target, column: "foto" }, how, [column("foto", "bytea")], [], 1)).toBeNull();
  });
});

describe("a coluna de descrição", () => {
  it("a primeira coluna de texto fora da chave com um dos nomes, sem diferenciar maiúsculas nem acentos", () => {
    const columns = [
      column("id", "integer", { isPrimaryKey: true, position: 1 }),
      column("cpf", "varchar(11)", { position: 2 }),
      column("Descrição", "varchar(80)", { position: 4 }),
      column("razao_social", "character varying(120)", { position: 3 }),
    ];
    expect(descriptionColumnOf(columns, "id", 1)).toBe("razao_social");
    expect(descriptionColumnOf([column("id", "integer"), column("cliente_nome", "text")], "id", 1)).toBe("cliente_nome");
  });

  it("sem nenhuma, nula; o texto qualquer e o TEXT do Informix não servem", () => {
    expect(descriptionColumnOf([column("id", "integer"), column("email", "varchar(80)")], "id", 1)).toBeNull();
    expect(descriptionColumnOf([column("id", "integer"), column("nome", "text")], "id", 3)).toBeNull();
  });
});
