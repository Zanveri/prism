import { describe, expect, it } from "vitest";

import { removeColumn, updateColumn } from "./build-model";
import { columnRowState, fkActionOptions, removedColumns } from "./editor-rows";
import { readCanvasModel } from "./fixtures";

describe("editor-rows", () => {
  it("calcula o estado de coluna alterada, nova e sem mudança em tabela existente e nova", () => {
    let model = readCanvasModel();
    model = updateColumn(model, "producao.maquina", "tag", {
      name: "tag_patrimonio",
      type: "varchar(20)",
    });

    const maquina = model.tables.find((t) => `${t.schema}.${t.name}` === "producao.maquina")!;
    const tagCol = maquina.columns.find((c) => c.name === "tag_patrimonio")!;
    const newCol = maquina.columns.find((c) => c.name === "ultima_revisao_em")!;
    const idCol = maquina.columns.find((c) => c.name === "id")!;

    expect(columnRowState(model.engine, maquina, tagCol)).toEqual({
      marker: "changed",
      before: "tag varchar(12)",
      locks: { primaryKey: true, identity: true },
    });

    expect(columnRowState(model.engine, maquina, newCol)).toEqual({
      marker: "new",
      before: null,
      locks: { primaryKey: true, identity: true },
    });

    expect(columnRowState(model.engine, maquina, idCol)).toEqual({
      marker: "none",
      before: null,
      locks: { primaryKey: true, identity: true },
    });

    const ordem = model.tables.find((t) => `${t.schema}.${t.name}` === "manutencao.ordem_manutencao")!;
    expect(columnRowState(model.engine, ordem, ordem.columns[0]!)).toEqual({
      marker: "none",
      before: null,
      locks: { primaryKey: false, identity: false },
    });
  });

  it("lista as colunas removidas de origin", () => {
    let model = readCanvasModel();
    model = removeColumn(model, "producao.maquina", "modelo").model;
    const maquina = model.tables.find((t) => `${t.schema}.${t.name}` === "producao.maquina")!;

    expect(removedColumns(maquina).map((c) => c.name)).toEqual(["modelo"]);

    const ordem = model.tables.find((t) => `${t.schema}.${t.name}` === "manutencao.ordem_manutencao")!;
    expect(removedColumns(ordem)).toEqual([]);
  });

  it("filtra as ações de FK aceitas por destino", () => {
    expect(fkActionOptions("informix")).toEqual({
      onDelete: ["noAction", "cascade"],
      onUpdate: ["noAction"],
    });
    expect(fkActionOptions("db2")).toEqual({
      onDelete: ["noAction", "restrict", "cascade", "setNull"],
      onUpdate: ["noAction", "restrict"],
    });
    expect(fkActionOptions("postgresql")).toEqual({
      onDelete: ["noAction", "restrict", "cascade", "setNull"],
      onUpdate: ["noAction", "restrict", "cascade", "setNull"],
    });
  });
});
