import { describe, expect, it } from "vitest";
import type { BuildEngine, BuildModel } from "@/app/build/_lib/build-model.schema";
import { fixture } from "@/app/build/_lib/fixtures";
import { printModelSql, readModelSql } from "@/app/build/_lib/sql-model";
import { applyTextRead, type TextError, type TextWarning } from "@/app/build/_lib/text-merge";

type SqlOkFixture = {
  engine: BuildEngine;
  sql: string;
  before: BuildModel;
  model: BuildModel;
  warnings: TextWarning[];
};

type SqlErrorFixture = {
  engine: BuildEngine;
  sql: string;
  before: BuildModel;
  error: TextError;
};

const manutencao = fixture<BuildModel>("build/models/manutencao.json");

describe("sql-model", () => {
  it("escreve o SQL do modelo para manutencao", () => {
    const f = fixture<SqlOkFixture>("build/sql/manutencao-postgresql.json");
    expect(printModelSql(f.before)).toBe(f.sql);
  });

  it.each([
    "manutencao-postgresql",
    "serial-e-identity",
    "informix-inline-e-constraint",
    "alter-table-add-constraint",
    "avisos-create-view-grant",
  ])("lê %s e aplica ao modelo", (name) => {
    const f = fixture<SqlOkFixture>(`build/sql/${name}.json`);
    const read = readModelSql(f.sql, f.before);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual(f.warnings);
    expect(applyTextRead(f.before, read)).toEqual(f.model);
  });

  it("aponta a linha 14 quando falta a vírgula no fim da linha 13", () => {
    const f = fixture<SqlErrorFixture>("build/sql/erro-falta-virgula-linha-14.json");
    const read = readModelSql(f.sql, f.before);
    expect(read).toEqual({ ok: false, error: f.error });
  });

  it("ida e volta para manutencao, Db2 e Informix", () => {
    expect(readModelSql(printModelSql(manutencao), manutencao)).toMatchObject({
      ok: true,
      tables: manutencao.tables,
    });

    const informixFixture = fixture<SqlOkFixture>("build/sql/informix-inline-e-constraint.json");
    expect(
      readModelSql(printModelSql(informixFixture.model), informixFixture.model),
    ).toMatchObject({
      ok: true,
      tables: informixFixture.model.tables,
    });
  });
});
