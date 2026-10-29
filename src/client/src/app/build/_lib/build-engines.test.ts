import { describe, expect, it } from "vitest";

import {
  closestType,
  engineRules,
  exactNameFromCatalog,
  needsQuotes,
  normalizeType,
  quoteName,
  sameName,
  typeNarrows,
} from "./build-engines";

describe("build-engines (RN-CONSTRUIR-077 e RN-CONSTRUIR-078)", () => {
  it("limites e ações de FK por destino", () => {
    expect(engineRules.postgresql.identifierLimit).toBe(63);
    expect([engineRules.db2.identifierLimit, engineRules.informix.identifierLimit]).toEqual([128, 128]);
    expect(engineRules.informix.deleteActions).toEqual(["noAction", "cascade"]);
    expect(engineRules.db2.updateActions).toEqual(["noAction", "restrict"]);
  });

  it("aspas, exactName e comparação de nomes", () => {
    expect(quoteName("postgresql", "OrdemX", false)).toBe('"OrdemX"');
    expect(quoteName("db2", "ordem_manutencao", false)).toBe("ordem_manutencao");
    expect(exactNameFromCatalog("db2", "ordem")).toBe(true);
    expect(exactNameFromCatalog("db2", "ORDEM")).toBe(false);
    expect(exactNameFromCatalog("postgresql", "Ordem")).toBe(true);
    expect(exactNameFromCatalog("postgresql", "ordem")).toBe(false);
    expect(quoteName("db2", "ordem", true)).toBe('"ordem"');
    expect(needsQuotes("postgresql", "select", false)).toBe(true);
    expect(sameName("db2", { name: "ORDEM", exactName: false }, { name: "ordem", exactName: false })).toBe(true);
    expect(sameName("db2", { name: "ordem", exactName: true }, { name: "ordem", exactName: false })).toBe(false);
  });

  it("normalização, estreitamento e sugestão de tipos", () => {
    expect(normalizeType("postgresql", "int8")).toEqual({ family: "integer", base: "bigint", args: [] });
    expect(normalizeType("postgresql", "varchar(20)")).toEqual({
      family: "text",
      base: "varchar",
      args: [20],
    });
    expect(normalizeType("postgresql", "numeric(12,3)")).toEqual({
      family: "decimal",
      base: "numeric",
      args: [12, 3],
    });
    expect(typeNarrows("postgresql", "varchar(20)", "varchar(12)")).toBe(true);
    expect(typeNarrows("postgresql", "varchar(12)", "varchar(20)")).toBe(false);
    expect(typeNarrows("postgresql", "bigint", "integer")).toBe(true);
    expect(typeNarrows("postgresql", "integer", "bigint")).toBe(false);
    expect(typeNarrows("informix", "integer", "varchar(10)")).toBe(true);
    expect(closestType("postgresql", "timestampz")).toBe("timestamptz");
    expect(closestType("postgresql", "varcahr")).toBe("varchar");
  });
});
