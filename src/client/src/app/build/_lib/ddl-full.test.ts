import { describe, expect, it } from "vitest";
import type { BuildModel } from "./build-model.schema";
import { type DdlContext, generateFullDdl } from "./ddl-full";
import { fixture, readFixtures } from "./fixtures";

type DdlFullFixture = {
  model: BuildModel;
  context: DdlContext;
  expected: string;
};

describe("generateFullDdl", () => {
  for (const [file, { model, context, expected }] of readFixtures<DdlFullFixture>("build/ddl-full")) {
    it(file, () => {
      expect(generateFullDdl(model, context).text).toBe(expected);
    });
  }

  it("diz em que linha está cada coluna", () => {
    const { model: manutencao, context, expected } = fixture<DdlFullFixture>(
      "build/ddl-full/manutencao-postgresql.json",
    );
    const line = expected.split("\n").findIndex((text) => text.includes("produto_id integer")) + 1;
    expect(generateFullDdl(manutencao, context).lineOf["manutencao.peca_trocada.produto_id"]).toBe(line);
  });
});
