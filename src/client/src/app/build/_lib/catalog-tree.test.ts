import { describe, expect, it } from "vitest";

import { checkTree } from "@/app/connections/_lib/check-tree";
import { readCanvasModel } from "./fixtures";
import { catalogTreeItems, selectionOf } from "./catalog-tree";

const sampleSchemas = [
  {
    schema: "producao",
    tables: [
      "apontamento",
      "linha",
      "maquina",
      "operador",
      "ordem_producao",
      "produto",
    ],
  },
  {
    schema: "public",
    tables: ["configuracao", "usuario"],
  },
];

describe("catalog-tree", () => {
  it("selectionOf com 3 de 8 marcadas dá counts: { checked: 3, total: 8 }", () => {
    const items = catalogTreeItems(sampleSchemas);
    const tree = checkTree(items);
    const checked = new Set([
      "producao.maquina",
      "producao.operador",
      "producao.produto",
    ]);

    const res = selectionOf(tree, checked, null);
    expect(res.counts).toEqual({ checked: 3, total: 8 });
    expect(res.alreadyInModel).toEqual([]);
    expect(res.selection).toEqual([
      {
        schema: "producao",
        tables: ["maquina", "operador", "produto"],
      },
    ]);
  });

  it("tabela que já está no modelo vem em alreadyInModel e não em selection", () => {
    const items = catalogTreeItems(sampleSchemas);
    const tree = checkTree(items);
    const model = readCanvasModel();
    const checked = new Set([
      "producao.apontamento",
      "producao.maquina",
      "producao.operador",
    ]);

    const res = selectionOf(tree, checked, model);
    expect(res.counts).toEqual({ checked: 3, total: 8 });
    expect(res.alreadyInModel).toContain("producao.maquina");
    expect(res.alreadyInModel).toContain("producao.operador");
    expect(res.alreadyInModel).toContain("producao.produto");
    expect(res.selection).toEqual([
      {
        schema: "producao",
        tables: ["apontamento"],
      },
    ]);
  });
});
