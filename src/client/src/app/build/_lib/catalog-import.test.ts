import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renameColumn } from "@/app/build/_lib/build-model";
import type { BuildModel } from "@/app/build/_lib/build-model.schema";
import {
  addCatalogTables,
  type CatalogSnapshot,
  type CatalogTable,
  modelFromCatalog,
  readCatalog,
  rereadModel,
  tableFromCatalog,
} from "@/app/build/_lib/catalog-import";
import { generateChangesDdl } from "@/app/build/_lib/ddl-changes";
import { fixture } from "@/app/build/_lib/fixtures";

type RereadFixture = {
  readAt: string;
  model: BuildModel;
  catalog: CatalogSnapshot;
  expected: BuildModel;
  notes: string[];
};

const base = "http://127.0.0.1:51234";
const bridge = {
  getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }),
  onApiExit: () => () => {},
  restartApi: async () => {},
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const refusal = (status: number, type: string, detail: string) =>
  new Response(
    JSON.stringify({ type, title: `Erro ${type}`, detail, status }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("catalog-import", () => {
  it("tableFromCatalog mapeia PK, índices, serial do Informix, exactName do Db2 e nextval do PostgreSQL", () => {
    const pgCatalog: CatalogTable = {
      schema: "producao",
      name: "maquina",
      comment: "Cadastro de máquinas",
      columns: [
        {
          name: "id",
          type: "integer",
          isNullable: false,
          isPrimaryKey: true,
          defaultValue: "nextval('producao.maquina_id_seq'::regclass)",
          generated: null,
        },
        {
          name: "tag",
          type: "varchar(12)",
          isNullable: false,
          isPrimaryKey: false,
          defaultValue: null,
          generated: null,
        },
      ],
      foreignKeys: [],
      indexes: [
        { name: "maquina_pkey", columns: ["id"], isUnique: true },
        { name: "ix_maquina_tag", columns: ["tag"], isUnique: true },
      ],
      checks: [{ name: "ck_maquina_tag", expression: "tag <> ''" }],
    };

    const pgTable = tableFromCatalog("postgresql", pgCatalog);
    expect(pgTable.primaryKey).toEqual({ name: "maquina_pkey", columns: ["id"] });
    expect(pgTable.indexes).toEqual([
      { name: "ix_maquina_tag", columns: ["tag"], unique: true },
    ]);
    expect(pgTable.columns[0]).toMatchObject({
      name: "id",
      originName: "id",
      type: "integer",
      default: "nextval('producao.maquina_id_seq'::regclass)",
      identity: null,
    });
    expect(pgTable.origin).toBeDefined();

    const informixCatalog: CatalogTable = {
      schema: "informix",
      name: "ordem",
      comment: null,
      columns: [
        {
          name: "id",
          type: "serial",
          isNullable: false,
          isPrimaryKey: true,
          defaultValue: null,
          generated: null,
        },
      ],
      foreignKeys: [],
      indexes: [],
      checks: [],
    };
    const informixTable = tableFromCatalog("informix", informixCatalog);
    expect(informixTable.columns[0]).toMatchObject({
      type: "integer",
      identity: "byDefault",
      default: null,
    });

    const db2Catalog: CatalogTable = {
      schema: "ESTOQUE",
      name: "item_minusculo",
      comment: null,
      columns: [
        {
          name: "ID",
          type: "BIGINT",
          isNullable: false,
          isPrimaryKey: true,
          defaultValue: null,
          generated: "always",
        },
        {
          name: "codigoInterno",
          type: "VARCHAR(20)",
          isNullable: false,
          isPrimaryKey: false,
          defaultValue: null,
          generated: null,
        },
      ],
      foreignKeys: [],
      indexes: [],
      checks: [],
    };
    const db2Table = tableFromCatalog("db2", db2Catalog);
    expect(db2Table.exactName).toBe(true);
    expect(db2Table.columns[0].exactName).toBe(false);
    expect(db2Table.columns[1].exactName).toBe(true);
  });

  it("readCatalog lê com progresso de (0, n) a (n, n) e isola falha de uma tabela", async () => {
    const progress: [number, number][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/schemas/producao/diagram")) {
          return json({
            tables: [
              {
                name: "maquina",
                columns: [
                  { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
                ],
              },
              {
                name: "operador",
                columns: [
                  { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
                ],
              },
            ],
            foreignKeys: [],
          });
        }
        if (url.includes("/schemas/producao/objects?kind=tables")) {
          return json([
            { name: "maquina", kind: "table", comment: "Máquinas" },
            { name: "operador", kind: "table", comment: null },
            { name: "linha", kind: "table", comment: null },
          ]);
        }
        if (url.includes("/tables/operador/columns")) {
          return refusal(422, "SQL_EXECUTION_FAILED", "Permissão negada em operador");
        }
        if (url.includes("/columns")) {
          return json([
            {
              name: "id",
              type: "bigint",
              isNullable: false,
              isPrimaryKey: true,
              position: 1,
              defaultValue: null,
              generated: "always",
            },
          ]);
        }
        if (url.includes("/indexes")) {
          return json([{ name: "maquina_pkey", columns: ["id"], isUnique: true }]);
        }
        if (url.includes("/checks")) {
          return json([]);
        }
        return json([]);
      }),
    );

    const res = await readCatalog(
      "sess-1",
      [{ schema: "producao", tables: ["maquina", "operador"] }],
      { onProgress: (done, total) => progress.push([done, total]) },
    );

    expect(progress[0]).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(res.failures).toEqual([
      { table: "producao.operador", message: "Permissão negada em operador" },
    ]);
    expect(res.snapshot.knownTables).toEqual([
      "producao.maquina",
      "producao.operador",
      "producao.linha",
    ]);
    expect(res.snapshot.tables).toHaveLength(2);
    expect(res.snapshot.tables.find((t) => t.name === "maquina")?.comment).toBe("Máquinas");
    expect(res.snapshot.tables.find((t) => t.name === "operador")?.columns).toHaveLength(1);
  });

  it("modelFromCatalog e addCatalogTables criam e acrescentam tabelas existentes", () => {
    const snapshot: CatalogSnapshot = {
      schemas: ["producao"],
      knownTables: ["producao.maquina", "producao.operador"],
      tables: [
        {
          schema: "producao",
          name: "maquina",
          comment: null,
          columns: [
            {
              name: "id",
              type: "bigint",
              isNullable: false,
              isPrimaryKey: true,
              defaultValue: null,
              generated: "always",
            },
          ],
          foreignKeys: [],
          indexes: [],
          checks: [],
        },
      ],
    };

    const created = modelFromCatalog({
      engine: "postgresql",
      defaultSchema: "manutencao",
      createSchema: true,
      base: { connectionId: "0199c3a0-0000-7000-8000-000000000010", database: "mes" },
      snapshot,
      readAt: "29/10/2026 14:10",
    });

    expect(created.tables).toHaveLength(1);
    expect(created.schemas).toEqual([
      { name: "manutencao", create: true },
      { name: "producao", create: false },
    ]);

    const moreSnapshot: CatalogSnapshot = {
      schemas: ["producao"],
      knownTables: ["producao.maquina", "producao.operador"],
      tables: [
        {
          schema: "producao",
          name: "operador",
          comment: null,
          columns: [
            {
              name: "id",
              type: "bigint",
              isNullable: false,
              isPrimaryKey: true,
              defaultValue: null,
              generated: "always",
            },
          ],
          foreignKeys: [],
          indexes: [],
          checks: [],
        },
      ],
    };

    const updated = addCatalogTables(created, moreSnapshot, "29/10/2026 14:20");
    expect(updated.tables).toHaveLength(2);
    expect(updated.base?.readAt).toBe("29/10/2026 14:20");
  });

  it.each([
    "coluna-intocada-mudou-no-banco",
    "coluna-nova-no-banco",
    "coluna-sumiu-do-banco",
    "tabela-sumiu-do-banco",
  ])("rereadModel: %s", (name) => {
    const f = fixture<RereadFixture>(`build/reread/${name}.json`);
    const result = rereadModel(f.model, f.catalog, f.readAt);
    expect(result.notes).toEqual(f.notes);
    expect(result.model).toEqual(f.expected);
  });

  it("a renomeação feita no modelo sobrevive à releitura", () => {
    const manutencao = fixture<BuildModel>("build/models/manutencao.json");
    const renamed = renameColumn(manutencao, "producao.maquina", "tag", "tag_patrimonio");

    const catalogComTagIgual: CatalogSnapshot = {
      schemas: ["producao"],
      knownTables: [
        "producao.maquina",
        "producao.operador",
        "producao.produto",
        "producao.linha",
      ],
      tables: [
        {
          schema: "producao",
          name: "maquina",
          comment: null,
          columns: [
            { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, defaultValue: null, generated: "always" },
            { name: "linha_id", type: "bigint", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "tag", type: "varchar(12)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "modelo", type: "varchar(60)", isNullable: true, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "instalada_em", type: "date", isNullable: true, isPrimaryKey: false, defaultValue: null, generated: null },
          ],
          foreignKeys: [
            {
              name: "maquina_linha_id_fkey",
              columns: ["linha_id"],
              referencedSchema: "producao",
              referencedTable: "linha",
              referencedColumns: ["id"],
              onDelete: null,
              onUpdate: null,
            },
          ],
          indexes: [{ name: "maquina_pkey", columns: ["id"], isUnique: true }],
          checks: [],
        },
        {
          schema: "producao",
          name: "operador",
          comment: null,
          columns: [
            { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, defaultValue: null, generated: "always" },
            { name: "matricula", type: "varchar(12)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "nome", type: "varchar(80)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "turno", type: "char(1)", isNullable: true, isPrimaryKey: false, defaultValue: null, generated: null },
          ],
          foreignKeys: [],
          indexes: [{ name: "operador_pkey", columns: ["id"], isUnique: true }],
          checks: [],
        },
        {
          schema: "producao",
          name: "produto",
          comment: null,
          columns: [
            { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, defaultValue: null, generated: "always" },
            { name: "codigo", type: "varchar(20)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "descricao", type: "varchar(120)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "unidade", type: "char(2)", isNullable: false, isPrimaryKey: false, defaultValue: null, generated: null },
            { name: "ativo", type: "boolean", isNullable: false, isPrimaryKey: false, defaultValue: "true", generated: null },
          ],
          foreignKeys: [],
          indexes: [{ name: "produto_pkey", columns: ["id"], isUnique: true }],
          checks: [],
        },
      ],
    };

    const context = {
      modelName: "manutencao",
      baseLabel: "mes",
      prismVersion: "0.6.0",
      generatedAt: "29/10/2026 15:00",
    };

    const { model } = rereadModel(renamed, catalogComTagIgual, "29/10/2026 15:00");
    expect(generateChangesDdl(model, context).text).toContain(
      "RENAME COLUMN tag TO tag_patrimonio",
    );
    expect(generateChangesDdl(model, context).text).not.toContain("DROP COLUMN tag");
  });
});
