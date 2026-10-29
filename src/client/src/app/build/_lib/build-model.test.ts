import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  addColumn,
  addForeignKey,
  addIndex,
  addTable,
  commit,
  copyAsNewTable,
  emptyModel,
  moveColumn,
  moveTableToSchema,
  redo,
  removeColumn,
  removeForeignKey,
  removeIndex,
  removeTable,
  renameColumn,
  renameTable,
  replaceTables,
  restoreColumn,
  revertColumn,
  revertTable,
  setDropInDatabase,
  startHistory,
  tableChanges,
  tableKey,
  togglePrimaryKey,
  toggleUnique,
  undo,
  updateColumn,
  updateForeignKey,
  updateIndex,
} from "./build-model";
import { parseModelBody } from "./build-model.schema";

const repositoryRoot = new URL("../../../../../../", import.meta.url);
const canvasModel = parseModelBody(
  readFileSync(new URL("src/test-fixtures/build/models/manutencao.json", repositoryRoot), "utf8"),
)!;

describe("build-model (RN-CONSTRUIR-011, RN-CONSTRUIR-012 e RN-CONSTRUIR-014)", () => {
  it("renomeia coluna em tabela existente mantendo originName e apontando rename em tableChanges", () => {
    const updated = renameColumn(canvasModel, "producao.maquina", "tag", "tag_patrimonio");
    const maquina = updated.tables.find((t) => tableKey(t) === "producao.maquina")!;
    const tagCol = maquina.columns.find((c) => c.name === "tag_patrimonio")!;

    expect(tagCol.originName).toBe("tag");

    const withUnique = renameColumn(
      toggleUnique(canvasModel, "producao.maquina", "tag"),
      "producao.maquina",
      "tag",
      "tag_patrimonio",
    );
    expect(
      withUnique.tables.find((t) => tableKey(t) === "producao.maquina")?.uniques[0]?.columns,
    ).toEqual(["tag_patrimonio"]);

    const changes = tableChanges("postgresql", maquina);
    expect(changes.kind).toBe("changed");
    expect(changes.changedColumns).toEqual([
      {
        name: "tag_patrimonio",
        originName: "tag",
        renamed: true,
        type: false,
        nullable: false,
        default: false,
        comment: false,
      },
    ]);
  });

  it("renomeia tabela em cascata nas FKs que chegam nela e move a chave do layout", () => {
    const updated = renameTable(canvasModel, "manutencao.plano_manutencao", "plano_preventivo");
    const ordem = updated.tables.find((t) => tableKey(t) === "manutencao.ordem_manutencao")!;
    const fkPlano = ordem.foreignKeys.find((fk) => fk.columns.includes("plano_id"))!;

    expect(fkPlano.target).toEqual({
      schema: "manutencao",
      table: "plano_preventivo",
      columns: ["id"],
    });
    expect(updated.layout["manutencao.plano_preventivo"]).toEqual(
      canvasModel.layout["manutencao.plano_manutencao"],
    );
    expect(updated.layout["manutencao.plano_manutencao"]).toBeUndefined();
  });

  it("remove e restaura coluna de tabela existente", () => {
    const { model: withoutModelo } = removeColumn(canvasModel, "producao.maquina", "modelo");
    const maquinaRemovida = withoutModelo.tables.find((t) => tableKey(t) === "producao.maquina")!;
    expect(tableChanges("postgresql", maquinaRemovida).removedColumns).toEqual(["modelo"]);

    const restored = restoreColumn(withoutModelo, "producao.maquina", "modelo");
    const maquinaRestaurada = restored.tables.find((t) => tableKey(t) === "producao.maquina")!;
    const changes = tableChanges("postgresql", maquinaRestaurada);
    expect(changes.kind).toBe("changed");
    expect(changes.removedColumns).toEqual([]);
    expect(changes.addedColumns).toEqual(["ultima_revisao_em"]);
  });

  it("remove coluna que sustenta uma FK e devolve droppedForeignKeys: 1", () => {
    const { model: updated, droppedForeignKeys } = removeColumn(
      canvasModel,
      "manutencao.ordem_manutencao",
      "maquina_id",
    );
    expect(droppedForeignKeys).toBe(1);
    const ordem = updated.tables.find((t) => tableKey(t) === "manutencao.ordem_manutencao")!;
    expect(ordem.foreignKeys.some((fk) => fk.columns.includes("maquina_id"))).toBe(false);
    expect(ordem.indexes.some((ix) => ix.columns.includes("maquina_id"))).toBe(false);
  });

  it("togglePrimaryKey liga nullable: false e forma chave composta na ordem das colunas", () => {
    const updated = togglePrimaryKey(canvasModel, "manutencao.ordem_manutencao", "aberta_por");
    const ordem = updated.tables.find((t) => tableKey(t) === "manutencao.ordem_manutencao")!;
    expect(ordem.primaryKey?.columns).toEqual(["id", "aberta_por"]);

    const withNullable = updateColumn(canvasModel, "manutencao.ordem_manutencao", "fechada_em", {
      nullable: true,
    });
    const pkFechada = togglePrimaryKey(withNullable, "manutencao.ordem_manutencao", "fechada_em");
    const colFechada = pkFechada.tables
      .find((t) => tableKey(t) === "manutencao.ordem_manutencao")!
      .columns.find((c) => c.name === "fechada_em")!;
    expect(colFechada.nullable).toBe(false);
  });

  it("mesma restrição com outra definição aparece em removed e em added; PK trocada em existente marca forbidden", () => {
    const withChangedFk = updateForeignKey(canvasModel, "producao.maquina", 0, {
      name: "maquina_linha_id_fkey",
      columns: ["linha_id"],
      target: { schema: "producao", table: "linha_producao", columns: ["id"] },
      onDelete: "cascade",
      onUpdate: "noAction",
    });
    const maquina = withChangedFk.tables.find((t) => tableKey(t) === "producao.maquina")!;
    const changes = tableChanges("postgresql", maquina);
    expect(changes.removedForeignKeys).toHaveLength(1);
    expect(changes.addedForeignKeys).toHaveLength(1);

    const withChangedPk = togglePrimaryKey(canvasModel, "producao.maquina", "tag");
    const maquinaPk = withChangedPk.tables.find((t) => tableKey(t) === "producao.maquina")!;
    expect(tableChanges("postgresql", maquinaPk).forbidden).toContain("primaryKey");
  });

  it("revertTable volta existente ao estado original e setDropInDatabase marca como dropped", () => {
    const reverted = revertTable(canvasModel, "producao.maquina");
    const maquina = reverted.tables.find((t) => tableKey(t) === "producao.maquina")!;
    expect(tableChanges("postgresql", maquina).kind).toBe("same");

    const dropped = setDropInDatabase(reverted, "producao.maquina", true);
    const maquinaDropped = dropped.tables.find((t) => tableKey(t) === "producao.maquina")!;
    expect(tableChanges("postgresql", maquinaDropped).kind).toBe("dropped");
  });

  it("operações auxiliares de tabela, coluna, índice, único e cópia funcionam sem mutar o modelo", () => {
    const base = emptyModel("postgresql", "public", true);
    const { model: m1, key } = addTable(base, "public");
    expect(key).toBe("public.tabela_1");

    const m2 = addColumn(m1, key, { name: "codigo", type: "varchar(20)" });
    const m3 = toggleUnique(m2, key, "codigo");
    const m4 = addIndex(m3, key, ["codigo"]);
    const m5 = updateIndex(m4, key, 0, { name: "ix_custom", columns: ["codigo"], unique: true });
    const m6 = removeIndex(m5, key, 0);
    const m7 = moveColumn(m6, key, "codigo", 0);
    const m8 = moveTableToSchema(m7, key, "outro");
    expect(m8.tables[0]?.schema).toBe("outro");

    const copied = copyAsNewTable(canvasModel, "producao.maquina", "manutencao");
    expect(copied.tables.some((t) => t.schema === "manutencao" && t.origin === null && t.name.startsWith("maquina"))).toBe(true);

    const modifiedCol = updateColumn(canvasModel, "producao.maquina", "tag", { type: "varchar(40)" });
    const revertedCol = revertColumn(modifiedCol, "producao.maquina", "tag");
    expect(
      revertedCol.tables.find((t) => tableKey(t) === "producao.maquina")!.columns.find((c) => c.name === "tag")!.type,
    ).toBe("varchar(12)");

    const fkAdded = addForeignKey(m1, key, {
      name: "fk_t",
      columns: ["id"],
      target: { schema: "public", table: "tabela_1", columns: ["id"] },
      onDelete: "noAction",
      onUpdate: "noAction",
    });
    const fkRemoved = removeForeignKey(fkAdded, key, 0);
    expect(fkRemoved.tables[0]?.foreignKeys).toEqual([]);

    const replaced = replaceTables(canvasModel, canvasModel.tables.slice(0, 2), ["manutencao"]);
    expect(replaced.tables).toHaveLength(2);
    expect(removeTable(m1, key).tables).toEqual([]);
  });

  it("commit 101 vezes guarda 100 em past; undo e redo andam um passo", () => {
    let history = startHistory(canvasModel);
    for (let i = 1; i <= 101; i++) {
      history = commit(history, {
        ...canvasModel,
        defaultSchema: `esquema_${i}`,
      });
    }
    expect(history.past).toHaveLength(100);
    expect(history.present.defaultSchema).toBe("esquema_101");

    const undone = undo(history);
    expect(undone.present.defaultSchema).toBe("esquema_100");
    expect(undone.future).toHaveLength(1);

    const redone = redo(undone);
    expect(redone.present.defaultSchema).toBe("esquema_101");
    expect(redone.future).toHaveLength(0);
  });
});
