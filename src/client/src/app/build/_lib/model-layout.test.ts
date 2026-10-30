import { describe, expect, it } from "vitest";

import { addTable } from "./build-model";
import { readCanvasModel } from "./fixtures";
import { checkModel } from "./model-check";
import {
  connectColumn,
  modelDiagram,
  moveTable,
  organize,
} from "./model-layout";

describe("model-layout", () => {
  it("monta modelDiagram do canvas com 6 caixas, producao.maquina existente alterada com ultima_revisao_em added, 6 arestas e avisos", () => {
    const model = readCanvasModel();
    const problems = checkModel(model, {
      scope: "changes",
      baseLabel: "MES Produção / mes",
      baseEnvironment: null,
      notes: [],
    });

    const layout = modelDiagram(model, problems);

    expect(layout.boxes).toHaveLength(6);

    const maquina = layout.boxes.find(
      (b) => b.ref.schema === "producao" && b.ref.name === "maquina",
    );
    expect(maquina).toBeDefined();
    expect(maquina?.variant).toBe("existing");
    expect(maquina?.badge).toBe("alterada");
    const ultimaRev = maquina?.columns?.find(
      (c) => c.name === "ultima_revisao_em",
    );
    expect(ultimaRev?.state).toBe("added");

    expect(layout.edges).toHaveLength(6);
    for (const edge of layout.edges) {
      expect(edge.fromColumn).toBeTruthy();
      expect(edge.toColumn).toBeTruthy();
    }

    const ordem = layout.boxes.find(
      (b) => b.ref.schema === "manutencao" && b.ref.name === "ordem_manutencao",
    );
    expect(ordem?.warning).toBe("warning");
  });

  it("organize reposiciona apenas as tabelas não fixadas (pinned: false)", () => {
    let model = readCanvasModel();
    model = moveTable(model, "manutencao.ordem_manutencao", 500, 600);
    expect(model.layout["manutencao.ordem_manutencao"]).toEqual({
      x: 500,
      y: 600,
      pinned: true,
    });

    const organized = organize(model);
    expect(organized.layout["manutencao.ordem_manutencao"]).toEqual({
      x: 500,
      y: 600,
      pinned: true,
    });
    expect(organized.layout["manutencao.plano_manutencao"]?.pinned).toBe(false);
  });

  it("não sobrepõe tabelas ao adicionar novas tabelas ou quando há coordenadas conflitantes", () => {
    let model = readCanvasModel();
    model = addTable(model).model;
    model = addTable(model).model;
    model = addTable(model).model;

    const layout = modelDiagram(model, []);
    for (let i = 0; i < layout.boxes.length; i++) {
      for (let j = i + 1; j < layout.boxes.length; j++) {
        const a = layout.boxes[i]!;
        const b = layout.boxes[j]!;
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("connectColumn cria FK direta para tabela com PK simples e devolve needsDialog para PK composta", () => {
    const model = readCanvasModel();

    const simpleResult = connectColumn(
      model,
      "manutencao.peca_trocada",
      "ordem_id",
      "producao.operador",
    );
    expect("model" in simpleResult).toBe(true);
    if ("model" in simpleResult) {
      const peca = simpleResult.model.tables.find(
        (t) => t.name === "peca_trocada",
      );
      expect(
        peca?.foreignKeys.some(
          (fk) =>
            fk.columns.includes("ordem_id") && fk.target.table === "operador",
        ),
      ).toBe(true);
    }

    const modelWithCompositePk = {
      ...model,
      tables: model.tables.map((t) =>
        t.name === "operador"
          ? { ...t, primaryKey: { name: null, columns: ["id", "matricula"] } }
          : t,
      ),
    };

    const compositeResult = connectColumn(
      modelWithCompositePk,
      "manutencao.peca_trocada",
      "ordem_id",
      "producao.operador",
    );
    expect("needsDialog" in compositeResult).toBe(true);
    if ("needsDialog" in compositeResult) {
      expect(compositeResult.needsDialog.target.table).toBe("operador");
      expect(compositeResult.needsDialog.target.columns).toEqual([
        "id",
        "matricula",
      ]);
    }

    const modelWithoutPk = {
      ...model,
      tables: model.tables.map((t) =>
        t.name === "operador" ? { ...t, primaryKey: null } : t,
      ),
    };
    const noPkResult = connectColumn(
      modelWithoutPk,
      "manutencao.peca_trocada",
      "ordem_id",
      "producao.operador",
    );
    expect("needsDialog" in noPkResult).toBe(true);
    if ("needsDialog" in noPkResult) {
      expect(noPkResult.needsDialog.target.table).toBe("operador");
      expect(noPkResult.needsDialog.target.columns).toEqual([]);
    }
  });
});
