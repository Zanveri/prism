import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isSessionLost } from "./database-sessions.service";
import { columnsQuery, refreshStructure, structureKey } from "./table-structure.service";

/**
 * A API trocada, sem rede: o `apiRequest` é o único ponto onde a tela fala com ela, então o serviço de verdade (as
 * rotas, a sessão da árvore, as chaves e o cache) roda inteiro. A sessão que a API "derruba" responde 404
 * `DATABASE_SESSION_NOT_FOUND`, como a de verdade.
 */
const api = vi.hoisted(() => ({ request: vi.fn(), opened: [] as string[], dead: new Set<string>(), version: { current: "v1" } }));

vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

const notFound = { ok: false as const, error: { status: 404, code: "DATABASE_SESSION_NOT_FOUND", title: "Sessão não encontrada.", detail: null, errors: null, extensions: {} } };
const column = (name: string) => [{ name, type: "bigint", isNullable: false, isPrimaryKey: true, position: 1 }];

beforeEach(() => {
  api.opened.length = 0;
  api.dead.clear();
  api.version.current = "v1";
  api.request.mockReset();
  api.request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "POST") {
      const id = `s${api.opened.length + 1}`;
      api.opened.push(id);
      return { ok: true, data: { id, database: "mes" } };
    }

    const session = /database-sessions\/([^/]+)\//.exec(path)?.[1] ?? "";
    if (api.dead.has(session)) return notFound;
    return { ok: true, data: column(`coluna_${api.version.current}_${session}`) };
  });
});

const connection = "c-1";
const table = { schema: "producao", name: "apontamento" };
const columnsOf = (queryClient: QueryClient) => queryClient.getQueryData<{ name: string }[]>(structureKey(connection, table.schema, table.name, "columns"))?.[0].name;
const errorOf = (queryClient: QueryClient) => queryClient.getQueryState(structureKey(connection, table.schema, table.name, "columns"))?.error;

describe("refreshStructure: 'Atualizar' e 'Tentar de novo' da Estrutura e do Diagrama se recuperam de uma sessão caída", () => {
  it("com a sessão da árvore em dia, atualiza e traz o dado novo, sem abrir outra sessão", async () => {
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(columnsQuery(connection, table.schema, table.name, queryClient));
    api.version.current = "v2";

    const result = await refreshStructure(queryClient, connection, [table]);

    expect(columnsOf(queryClient)).toBe("coluna_v2_s1");
    expect(api.opened).toEqual(["s1"]);
    expect(result.sessionReopened).toBe(false);
  });

  it("a sessão caiu e o dado velho está em cache: um 'Atualizar' só descobre, reabre a sessão e traz o dado novo", async () => {
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(columnsQuery(connection, table.schema, table.name, queryClient));
    expect(columnsOf(queryClient)).toBe("coluna_v1_s1");

    // A API fecha a sessão (ociosa, ou reiniciada) e o dado muda.
    api.dead.add("s1");
    api.version.current = "v2";

    const result = await refreshStructure(queryClient, connection, [table]);

    expect(api.opened).toEqual(["s1", "s2"]);
    expect(columnsOf(queryClient)).toBe("coluna_v2_s2");
    expect(errorOf(queryClient)).toBeNull();
    expect(result.sessionReopened).toBe(true);
  });

  it("o erro de sessão que ficou na tela (uma atualização anterior falhou) é o que o 'Tentar de novo' resolve: reabre e refaz", async () => {
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(columnsQuery(connection, table.schema, table.name, queryClient));
    api.dead.add("s1");

    // Uma busca que não sabe recuperar (a de antes do conserto) deixa o erro no cache, com o dado velho junto.
    await queryClient.refetchQueries({ queryKey: structureKey(connection, table.schema, table.name, "columns") });
    expect(isSessionLost(errorOf(queryClient))).toBe(true);
    expect(columnsOf(queryClient)).toBe("coluna_v1_s1");
    expect(api.opened).toEqual(["s1"]);

    api.version.current = "v3";
    const result = await refreshStructure(queryClient, connection, [table]);

    expect(api.opened).toEqual(["s1", "s2"]);
    expect(columnsOf(queryClient)).toBe("coluna_v3_s2");
    expect(result.sessionReopened).toBe(true);
  });

  it("atualiza as tabelas de uma vez (o diagrama: a do centro e as vizinhas) com uma sessão nova só", async () => {
    const queryClient = new QueryClient();
    const other = { schema: "producao", name: "maquina" };
    await Promise.all([columnsQuery(connection, table.schema, table.name, queryClient), columnsQuery(connection, other.schema, other.name, queryClient)].map((options) => queryClient.fetchQuery(options)));
    api.dead.add("s1");

    await refreshStructure(queryClient, connection, [table, other]);

    expect(api.opened).toEqual(["s1", "s2"]);
    expect(queryClient.getQueryData<{ name: string }[]>(structureKey(connection, other.schema, other.name, "columns"))?.[0].name).toBe("coluna_v1_s2");
  });

  it("se a sessão nova também falha, o erro fica no cache para a tela mostrá-lo (nada de laço)", async () => {
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(columnsQuery(connection, table.schema, table.name, queryClient));
    // Toda sessão que a API abre já nasce caída.
    api.request.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === "POST") {
        const id = `s${api.opened.length + 1}`;
        api.opened.push(id);
        return { ok: true, data: { id, database: "mes" } };
      }
      return notFound;
    });

    await refreshStructure(queryClient, connection, [table]);

    expect(api.opened.length).toBeLessThanOrEqual(2);
    expect(isSessionLost(errorOf(queryClient))).toBe(true);
  });
});
