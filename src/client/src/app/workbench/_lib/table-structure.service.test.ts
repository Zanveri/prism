import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/prism-api";

import {
  columnsQuery,
  databasePropertiesQuery,
  databaseSchemasQuery,
  foreignKeysQuery,
  indexesQuery,
  invalidateStructure,
  referencedByQuery,
  refreshDatabase,
  refreshSchema,
  schemaDiagramKey,
  schemaDiagramQuery,
  schemaObjectsKey,
  schemaObjectsQuery,
  structureKey,
  structurePrefix,
  structureScopes,
} from "./table-structure.service";

const fakes = vi.hoisted(() => ({
  openSession: vi.fn(),
  getColumns: vi.fn(),
  getIndexes: vi.fn(),
  getForeignKeys: vi.fn(),
  getReferencedBy: vi.fn(),
  getSchemaDiagram: vi.fn(),
  getObjects: vi.fn(),
  getSchemas: vi.fn(),
  getDatabaseProperties: vi.fn(),
}));

vi.mock("./database-sessions.service", async (importOriginal) => {
  const { queryOptions } = await import("@tanstack/react-query");
  return {
    // O que não é a rede nem a sessão (as constantes, as chaves) é o de verdade: o serviço da estrutura usa `keepUntilRefreshed`.
    ...(await importOriginal<typeof import("./database-sessions.service")>()),
    databaseSessionQuery: (connectionId: string, database?: string) =>
      queryOptions({
        queryKey: database === undefined ? ["database-session", connectionId] : ["database-session", connectionId, { database }],
        queryFn: () => fakes.openSession(connectionId, database),
        staleTime: Infinity,
      }),
    getColumns: fakes.getColumns,
    getIndexes: fakes.getIndexes,
    getForeignKeys: fakes.getForeignKeys,
    getReferencedBy: fakes.getReferencedBy,
    getSchemaDiagram: fakes.getSchemaDiagram,
    getObjects: fakes.getObjects,
    getSchemas: fakes.getSchemas,
    getDatabaseProperties: fakes.getDatabaseProperties,
  };
});

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data });
const connection = "c-1";

let queryClient: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fakes.openSession.mockResolvedValue({ id: "sessao-1", database: "mes" });
  fakes.getColumns.mockImplementation(() => ok([{ name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, position: 1 }]));
  fakes.getIndexes.mockImplementation(() => ok([{ name: "pk", columns: ["id"], isUnique: true }]));
  fakes.getForeignKeys.mockImplementation(() => ok([]));
  fakes.getReferencedBy.mockImplementation(() => ok([]));
  fakes.getSchemaDiagram.mockImplementation(() =>
    ok({
      tables: [{ name: "pedidos", columns: [{ name: "id", type: "bigint", isNullable: false, isPrimaryKey: true }] }],
      foreignKeys: [],
    }),
  );
  fakes.getObjects.mockImplementation(() => ok([{ name: "pedidos", kind: "table", estimatedRows: 42, comment: "Pedidos" }]));
  fakes.getSchemas.mockImplementation(() => ok([{ name: "loja", isSystem: false, tables: 3, views: 1, routines: 2 }]));
  fakes.getDatabaseProperties.mockImplementation(() => ok([{ name: "server_version", value: "16.4" }]));
});

describe("as consultas de catálogo da Estrutura e do Diagrama (RN-TABELA-003 e 004)", () => {
  it("pedem as colunas, os índices e as chaves estrangeiras pelas mesmas funções da árvore, com a sessão da árvore", async () => {
    await Promise.all([queryClient.fetchQuery(columnsQuery(connection, "producao", "apontamento", queryClient)), queryClient.fetchQuery(indexesQuery(connection, "producao", "apontamento", queryClient)), queryClient.fetchQuery(foreignKeysQuery(connection, "producao", "apontamento", queryClient))]);

    expect(fakes.getColumns).toHaveBeenCalledWith("sessao-1", "producao", "apontamento");
    expect(fakes.getIndexes).toHaveBeenCalledWith("sessao-1", "producao", "apontamento");
    expect(fakes.getForeignKeys).toHaveBeenCalledWith("sessao-1", "producao", "apontamento");
  });

  it("as três em paralelo abrem uma sessão só: duas sessões deixariam uma órfã na API", async () => {
    await Promise.all([queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient)), queryClient.fetchQuery(indexesQuery(connection, "s", "t", queryClient)), queryClient.fetchQuery(foreignKeysQuery(connection, "s", "t", queryClient))]);

    expect(fakes.openSession).toHaveBeenCalledTimes(1);
  });

  it("devolvem o dado cru que o esquema validou, e não as linhas da árvore", async () => {
    const columns = await queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient));

    expect(columns).toEqual([{ name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, position: 1 }]);
  });

  it("a recusa da API lança, para o aviso central dizer o que houve (RN-AVISO-004)", async () => {
    fakes.getColumns.mockResolvedValue({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "A consulta falhou.", detail: "permission denied", errors: null, extensions: {} } });

    await expect(queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient))).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("ficam guardadas: pedir de novo não vai à API (só o 'Atualizar' refaz)", async () => {
    await queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient));
    await queryClient.ensureQueryData(columnsQuery(connection, "s", "t", queryClient));
    await queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient));

    expect(fakes.getColumns).toHaveBeenCalledTimes(1);
  });

  it("'Atualizar' (invalidar o prefixo da tabela) refaz as três e deixa as outras tabelas como estão", async () => {
    await Promise.all([queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient)), queryClient.fetchQuery(columnsQuery(connection, "s", "outra", queryClient))]);

    await queryClient.invalidateQueries({ queryKey: structurePrefix(connection, "s", "t") });

    expect(queryClient.getQueryState(structureKey(connection, "s", "t", "columns"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(structureKey(connection, "s", "outra", "columns"))?.isInvalidated).toBe(false);
  });

  it("'Desconectar' (que remove as consultas da árvore) não leva o que a Estrutura guardou", async () => {
    await queryClient.fetchQuery(columnsQuery(connection, "s", "t", queryClient));

    queryClient.removeQueries({ queryKey: ["tree", connection] });
    queryClient.removeQueries({ queryKey: ["database-session", connection] });

    expect(queryClient.getQueryData(structureKey(connection, "s", "t", "columns"))).toBeDefined();
  });

  it("nome com barra, aspas e ponto não colide com outro: a chave guarda os nomes inteiros", () => {
    expect(structureKey(connection, "a.b", "c", "columns")).not.toEqual(structureKey(connection, "a", "b.c", "columns"));
  });

  it("as chaves que apontam para a tabela (RN-CAT-004): a rota referenced-by pela sessão da árvore, no cache da Estrutura", async () => {
    const referencing = [{ name: "fk_item", referencingSchema: "s", referencingTable: "itens", columns: ["t_id"], referencedColumns: ["id"] }];
    fakes.getReferencedBy.mockImplementation(() => ok(referencing));

    expect(await queryClient.fetchQuery(referencedByQuery(connection, "s", "t", queryClient))).toEqual(referencing);
    expect(fakes.getReferencedBy).toHaveBeenCalledWith("sessao-1", "s", "t");
    expect(queryClient.getQueryData(structureKey(connection, "s", "t", "referencedBy"))).toEqual(referencing);
  });

  it("'Atualizar' a tabela refaz também as chaves que apontam para ela, e uma lista guardada não vai à API de novo", async () => {
    await queryClient.fetchQuery(referencedByQuery(connection, "s", "t", queryClient));
    await queryClient.fetchQuery(referencedByQuery(connection, "s", "t", queryClient));
    expect(fakes.getReferencedBy).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: structurePrefix(connection, "s", "t") });
    expect(queryClient.getQueryState(structureKey(connection, "s", "t", "referencedBy"))?.isInvalidated).toBe(true);
  });
});

describe("as consultas de catálogo do Esquema e do Banco (RN-ESQUEMA-001..003 e RN-BANCO-001)", () => {
  it("buscam o diagrama e os objetos do esquema pela sessão da conexão e os mantêm no cache do esquema", async () => {
    const [diagram, tables] = await Promise.all([
      queryClient.fetchQuery(schemaDiagramQuery(connection, "loja", queryClient)),
      queryClient.fetchQuery(schemaObjectsQuery(connection, "loja", "tables", queryClient)),
    ]);

    expect(fakes.getSchemaDiagram).toHaveBeenCalledWith("sessao-1", "loja");
    expect(fakes.getObjects).toHaveBeenCalledWith("sessao-1", "loja", "tables");
    expect(diagram.tables).toHaveLength(1);
    expect(tables).toEqual([{ name: "pedidos", kind: "table", estimatedRows: 42, comment: "Pedidos" }]);
  });

  it("refreshSchema invalida o diagrama, os objetos e as tabelas do esquema sem tocar em outro esquema", async () => {
    await Promise.all([
      queryClient.fetchQuery(schemaDiagramQuery(connection, "loja", queryClient)),
      queryClient.fetchQuery(schemaObjectsQuery(connection, "loja", "tables", queryClient)),
      queryClient.fetchQuery(schemaDiagramQuery(connection, "estoque", queryClient)),
    ]);

    await refreshSchema(queryClient, connection, "loja");

    expect(queryClient.getQueryState(schemaDiagramKey(connection, "loja"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(schemaObjectsKey(connection, "loja", "tables"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(schemaDiagramKey(connection, "estoque"))?.isInvalidated).toBe(false);
  });

  it("buscam os esquemas e as propriedades do banco e refreshDatabase invalida só o banco alvo", async () => {
    const [schemas, properties] = await Promise.all([
      queryClient.fetchQuery(databaseSchemasQuery(connection, queryClient, "alfa")),
      queryClient.fetchQuery(databasePropertiesQuery(connection, queryClient, "alfa")),
      queryClient.fetchQuery(databaseSchemasQuery(connection, queryClient)),
    ]);

    expect(fakes.getSchemas).toHaveBeenCalledWith("sessao-1");
    expect(fakes.getDatabaseProperties).toHaveBeenCalledWith("sessao-1");
    expect(schemas).toEqual([{ name: "loja", isSystem: false, tables: 3, views: 1, routines: 2 }]);
    expect(properties).toEqual([{ name: "server_version", value: "16.4" }]);

    await refreshDatabase(queryClient, connection, "alfa");

    expect(queryClient.getQueryState(databaseSchemasQuery(connection, queryClient, "alfa").queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(databasePropertiesQuery(connection, queryClient, "alfa").queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(databaseSchemasQuery(connection, queryClient).queryKey)?.isInvalidated).toBe(false);
  });
});

describe("o Atualizar do navegador nas listas da Estrutura (RN-CONFIG-004)", () => {
  const keys = (path: Parameters<typeof structureScopes>[0]) => structureScopes(path).map((scope) => scope.queryKey);

  it("cada nó invalida o prefixo do que está abaixo dele; pasta e objetos, nada", () => {
    expect(keys({ type: "folder", id: "f1" })).toEqual([]);
    expect(keys({ type: "objects", connectionId: "c1", schema: "s", objects: "tables" })).toEqual([]);
    expect(keys({ type: "connection", connectionId: "c1" })).toEqual([["table-structure", "c1"]]);
    expect(keys({ type: "database", connectionId: "c1", database: "alfa" })).toEqual([["table-structure", "c1", { database: "alfa" }]]);
    expect(keys({ type: "schema", connectionId: "c1", schema: "loja" })).toEqual([["table-structure", "c1", "loja"]]);
    expect(keys({ type: "schema", connectionId: "c1", database: "alfa", schema: "loja" })).toEqual([["table-structure", "c1", { database: "alfa" }, "loja"]]);
    expect(keys({ type: "table", connectionId: "c1", schema: "loja", table: "pedidos" })).toEqual([structurePrefix("c1", "loja", "pedidos")]);
    expect(keys({ type: "tableLevel", connectionId: "c1", schema: "loja", table: "pedidos", level: "columns" })).toEqual([structureKey("c1", "loja", "pedidos", "columns")]);
    expect(keys({ type: "tableLevel", connectionId: "c1", schema: "loja", table: "pedidos", level: "foreignKeys" })).toEqual([structureKey("c1", "loja", "pedidos", "foreignKeys"), structureKey("c1", "loja", "pedidos", "referencedBy")]);
  });

  it("o banco da conexão não pega as listas dos outros bancos do servidor, e o banco dado pega só as dele", async () => {
    queryClient.setQueryData(structureKey("c1", "s", "t", "columns"), []);
    queryClient.setQueryData(structureKey("c1", "s", "t", "columns", "alfa"), []);
    queryClient.setQueryData(structureKey("c2", "s", "t", "columns"), []);

    invalidateStructure(queryClient, { type: "database", connectionId: "c1" }, new Set());
    const invalidated = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;
    expect(invalidated(structureKey("c1", "s", "t", "columns"))).toBe(true);
    expect(invalidated(structureKey("c1", "s", "t", "columns", "alfa"))).toBe(false);
    expect(invalidated(structureKey("c2", "s", "t", "columns"))).toBe(false);

    invalidateStructure(queryClient, { type: "database", connectionId: "c1", database: "alfa" }, new Set());
    expect(invalidated(structureKey("c1", "s", "t", "columns", "alfa"))).toBe(true);
    expect(invalidated(structureKey("c2", "s", "t", "columns"))).toBe(false);
  });

  it("a conexão toda pega todos os bancos, menos os de sessão caída", () => {
    queryClient.setQueryData(structureKey("c1", "s", "t", "columns"), []);
    queryClient.setQueryData(structureKey("c1", "s", "t", "columns", "alfa"), []);
    queryClient.setQueryData(structureKey("c1", "s", "t", "columns", "beta"), []);

    invalidateStructure(queryClient, { type: "connection", connectionId: "c1" }, new Set(["beta"]));

    expect(queryClient.getQueryState(structureKey("c1", "s", "t", "columns"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(structureKey("c1", "s", "t", "columns", "alfa"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(structureKey("c1", "s", "t", "columns", "beta"))?.isInvalidated).toBe(false);
  });
});
