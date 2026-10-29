import { describe, expect, it } from "vitest";

import type { BuildModel } from "./build-model.schema";
import { readCanvasModel, readFixtures } from "./fixtures";
import { applyFix, checkModel, problemCounts } from "./model-check";

type CheckFixture = {
  model: BuildModel;
  scope: "changes" | "full";
  notes?: { code: "W8" | "W13"; message: string }[];
  problems: {
    code: string;
    severity: "error" | "warning" | "info";
    table: string | null;
    column: string | null;
  }[];
};

describe("checkModel", () => {
  for (const [file, fixture] of readFixtures<CheckFixture>("build/checks")) {
    it(file, () => {
      const problems = checkModel(fixture.model, {
        scope: fixture.scope,
        baseLabel: "MES Produção / mes",
        baseEnvironment: "Produção",
        notes: fixture.notes ?? [],
      });
      expect(
        problems.map(({ code, severity, table, column }) => ({
          code,
          severity,
          table,
          column,
        })),
      ).toEqual(fixture.problems);
    });
  }

  it("valida o modelo do canvas com escopo changes (W2, W3, I1 e I2)", () => {
    const model = readCanvasModel();
    const problems = checkModel(model, {
      scope: "changes",
      baseLabel: "MES Produção / mes",
      baseEnvironment: "Produção",
      notes: [],
    });

    expect(
      problems.map(({ code, severity, table, column }) => ({
        code,
        severity,
        table,
        column,
      })),
    ).toEqual([
      {
        code: "W2",
        severity: "warning",
        table: "manutencao.peca_trocada",
        column: "produto_id",
      },
      {
        code: "W3",
        severity: "warning",
        table: null,
        column: null,
      },
      {
        code: "I1",
        severity: "info",
        table: null,
        column: null,
      },
      {
        code: "I2",
        severity: "info",
        table: null,
        column: null,
      },
    ]);

    const w3 = problems.find((p) => p.code === "W3")!;
    expect(w3.fix).toEqual({
      kind: "createIndexes",
      items: [
        { table: "manutencao.ordem_manutencao", columns: ["plano_id"] },
        { table: "manutencao.ordem_manutencao", columns: ["aberta_por"] },
        { table: "manutencao.plano_manutencao", columns: ["maquina_id"] },
        { table: "manutencao.peca_trocada", columns: ["ordem_id"] },
        { table: "manutencao.peca_trocada", columns: ["produto_id"] },
      ],
    });
    expect(problemCounts(problems)).toEqual({ errors: 0, warnings: 2 });
  });

  it("valida o modelo do canvas com escopo full (W12 e I3 aparecem)", () => {
    const model = readCanvasModel();
    const problems = checkModel(model, {
      scope: "full",
      baseLabel: "MES Produção / mes",
      baseEnvironment: "Produção",
      notes: [],
    });

    expect(problems.map((p) => p.code)).toEqual(["W2", "W3", "W12", "I2", "I3"]);
  });

  it("não emite W3 no Informix", () => {
    const model: BuildModel = {
      ...readCanvasModel(),
      engine: "informix",
    };
    const problems = checkModel(model, {
      scope: "changes",
      baseLabel: null,
      baseEnvironment: null,
      notes: [],
    });
    expect(problems.some((p) => p.code === "W3")).toBe(false);
  });

  it("filtra avisos presentes em ignoredWarnings", () => {
    const model: BuildModel = {
      ...readCanvasModel(),
      ignoredWarnings: ["W2:manutencao.peca_trocada.produto_id"],
    };
    const problems = checkModel(model, {
      scope: "changes",
      baseLabel: "MES Produção / mes",
      baseEnvironment: "Produção",
      notes: [],
    });
    expect(problems.some((p) => p.code === "W2")).toBe(false);
  });

  it("applyFix com useType corrige W2 no modelo do canvas", () => {
    const model = readCanvasModel();
    const fixed = applyFix(model, {
      kind: "useType",
      table: "manutencao.peca_trocada",
      column: "produto_id",
      type: "bigint",
    });
    const problems = checkModel(fixed, {
      scope: "changes",
      baseLabel: "MES Produção / mes",
      baseEnvironment: "Produção",
      notes: [],
    });
    expect(problems.some((p) => p.code === "W2")).toBe(false);
  });
});
