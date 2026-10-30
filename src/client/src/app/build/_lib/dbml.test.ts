import { describe, expect, it } from "vitest";
import type { BuildModel, ModelTable } from "@/app/build/_lib/build-model.schema";
import { tableChanges, tableKey } from "@/app/build/_lib/build-model";
import { printDbml, readDbml } from "@/app/build/_lib/dbml";
import { generateChangesDdl } from "@/app/build/_lib/ddl-changes";
import { fixture } from "@/app/build/_lib/fixtures";
import { applyTextRead, type TextError, type TextWarning } from "@/app/build/_lib/text-merge";

type DbmlOkFixture = {
  dbml: string;
  before: BuildModel;
  model: BuildModel;
  warnings: TextWarning[];
};

type DbmlErrorFixture = {
  dbml: string;
  before: BuildModel;
  error: TextError;
};

const manutencao = fixture<BuildModel>("build/models/manutencao.json");

const context = {
  modelName: "Ordens de manutenção",
  baseLabel: "MES Produção / mes",
  prismVersion: "0.1.0",
  generatedAt: "29/10/2026 14:32",
};

describe("dbml", () => {
  it("escreve o DBML igual ao canvas para manutencao", () => {
    const f = fixture<DbmlOkFixture>("build/dbml/manutencao.json");
    expect(printDbml(f.before)).toBe(f.dbml);
  });

  it.each(["manutencao", "refs-todas-as-formas", "tabela-e-coluna", "avisos-enum-tablegroup"])(
    "lê %s e mantém o que o DBML não escreve",
    (name) => {
      const f = fixture<DbmlOkFixture>(`build/dbml/${name}.json`);
      const read = readDbml(f.dbml, f.before);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.warnings).toEqual(f.warnings);
      expect(applyTextRead(f.before, read)).toEqual(f.model);
    },
  );

  it("rejeita muitos-para-muitos com linha e coluna", () => {
    const f = fixture<DbmlErrorFixture>("build/dbml/erro-muitos-para-muitos.json");
    const read = readDbml(f.dbml, f.before);
    expect(read).toEqual({ ok: false, error: f.error });
  });

  it("apagar a linha de uma coluna de existente a torna removida", () => {
    const text = printDbml(manutencao).replace("  modelo varchar(60)\n", "");
    const read = readDbml(text, manutencao);
    if (!read.ok) throw new Error(read.error.message);
    const maquina = applyTextRead(manutencao, read).tables.find(
      (t: ModelTable) => tableKey(t) === "producao.maquina",
    )!;
    expect(tableChanges("postgresql", maquina).removedColumns).toEqual(["modelo"]);
    expect(generateChangesDdl(applyTextRead(manutencao, read), context).text).toContain(
      "ALTER TABLE producao.maquina DROP COLUMN modelo;",
    );
  });

  it("ida e volta", () =>
    expect(readDbml(printDbml(manutencao), manutencao)).toMatchObject({
      ok: true,
      tables: manutencao.tables,
    }));
});
