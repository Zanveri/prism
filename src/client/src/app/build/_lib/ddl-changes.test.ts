import { describe, expect, it } from "vitest";

import type { BuildModel } from "./build-model.schema";
import { generateChangesDdl, generateDdl, tableChangesDdl } from "./ddl-changes";
import { type DdlContext, generateFullDdl } from "./ddl-full";
import { fixture, readFixtures } from "./fixtures";

type DdlChangesFixture = {
  model: BuildModel;
  context: DdlContext;
  expected: string;
};

describe("generateChangesDdl", () => {
  for (const [file, { model, context, expected }] of readFixtures<DdlChangesFixture>(
    "build/ddl-changes",
  )) {
    it(file, () => {
      const result = generateChangesDdl(model, context);
      expect(result.text).toBe(expected);
      if (file === "sem-mudanca") {
        expect(result.statements).toBe(0);
      } else {
        expect(result.statements).toBeGreaterThan(0);
      }
    });
  }

  it("generateDdl segue a escolha do modelo", () => {
    const {
      model: manutencao,
      context,
      expected: fullExpected,
    } = fixture<DdlChangesFixture>("build/ddl-full/manutencao-postgresql.json");
    const { expected: changesExpected } = fixture<DdlChangesFixture>(
      "build/ddl-changes/manutencao-postgresql.json",
    );

    expect(
      generateDdl(
        { ...manutencao, ddl: { ...manutencao.ddl, scope: "changes" } },
        context,
      ).text,
    ).toBe(changesExpected);
    expect(
      generateDdl({ ...manutencao, ddl: { ...manutencao.ddl, scope: "full" } }, context).text,
    ).toBe(fullExpected);
    expect(generateDdl({ ...manutencao, base: null }, context).text).toBe(
      generateFullDdl({ ...manutencao, base: null }, context).text,
    );
  });

  it("tableChangesDdl devolve só os comandos da tabela", () => {
    const { model, context } = fixture<DdlChangesFixture>(
      "build/ddl-changes/maquina-existente-postgresql.json",
    );
    expect(tableChangesDdl(model, "producao.maquina", context)).toBe(
      [
        "ALTER TABLE producao.maquina RENAME COLUMN tag TO tag_patrimonio;",
        "ALTER TABLE producao.maquina ALTER COLUMN tag_patrimonio TYPE varchar(20);",
        "ALTER TABLE producao.maquina DROP COLUMN modelo;",
        "ALTER TABLE producao.maquina ADD COLUMN ultima_revisao_em date;",
        "CREATE INDEX ix_maquina_revisao\n  ON producao.maquina (ultima_revisao_em);",
      ].join("\n"),
    );
  });
});
