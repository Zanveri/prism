import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/prism-api";

import { columnsQuery, foreignKeysQuery, indexesQuery, structureKey, structurePrefix } from "./table-structure.service";

const fakes = vi.hoisted(() => ({
  openSession: vi.fn(),
  getColumns: vi.fn(),
  getIndexes: vi.fn(),
  getForeignKeys: vi.fn(),
}));

vi.mock("./database-sessions.service", async (importOriginal) => {
  const { queryOptions } = await import("@tanstack/react-query");
  return {
    // O que não é a rede nem a sessão (as constantes, as chaves) é o de verdade: o serviço da estrutura usa `keepUntilRefreshed`.
    ...(await importOriginal<typeof import("./database-sessions.service")>()),
    databaseSessionQuery: (connectionId: string) => queryOptions({ queryKey: ["database-session", connectionId], queryFn: fakes.openSession, staleTime: Infinity }),
    getColumns: fakes.getColumns,
    getIndexes: fakes.getIndexes,
    getForeignKeys: fakes.getForeignKeys,
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
});
