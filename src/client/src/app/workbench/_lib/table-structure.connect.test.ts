import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { columnsQuery, connectTree, foreignKeysQuery, indexesQuery } from "./table-structure.service";

/**
 * A API trocada, sem rede: o `apiRequest` é o único ponto onde a tela fala com ela. As consultas de verdade, a sessão da árvore e o
 * cache rodam inteiros, com os observadores que o React usaria (`QueryObserver`), sem o React.
 */
const api = vi.hoisted(() => ({ request: vi.fn(), posts: [] as string[], gets: [] as string[] }));

vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

const refused = { ok: false as const, error: { status: 422, code: "DATABASE_CONNECTION_FAILED", title: "Falha ao conectar.", detail: "connection refused", errors: null, extensions: {} } };

beforeEach(() => {
  api.posts.length = 0;
  api.gets.length = 0;
  api.request.mockReset();
  api.request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "POST") {
      api.posts.push(path);
      return { ok: true, data: { id: `s${api.posts.length}`, database: "mes" } };
    }

    api.gets.push(path);
    return { ok: true, data: [] };
  });
});

const connection = "c-1";
const table = { schema: "producao", name: "apontamento" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Os três observadores que a vista Estrutura cria, na mesma forma: com `enabled`. */
function observe(queryClient: QueryClient, enabled: boolean) {
  const columns = new QueryObserver(queryClient, columnsQuery(connection, table.schema, table.name, queryClient, enabled));
  const foreignKeys = new QueryObserver(queryClient, foreignKeysQuery(connection, table.schema, table.name, queryClient, enabled));
  const indexes = new QueryObserver(queryClient, indexesQuery(connection, table.schema, table.name, queryClient, enabled));
  const observers = [columns, foreignKeys, indexes];
  const stops = observers.map((observer) => observer.subscribe(() => {}));

  return {
    observers,
    enable: () => {
      columns.setOptions(columnsQuery(connection, table.schema, table.name, queryClient, true));
      foreignKeys.setOptions(foreignKeysQuery(connection, table.schema, table.name, queryClient, true));
      indexes.setOptions(indexesQuery(connection, table.schema, table.name, queryClient, true));
    },
    stop: () => stops.forEach((stop) => stop()),
  };
}

describe("nada reconecta sozinho: as vistas de uma conexão desconectada esperam o clique (D1)", () => {
  it("desconectada, nenhuma consulta de catálogo sai, e a sessão da árvore tampouco é aberta", async () => {
    const queryClient = new QueryClient();
    const view = observe(queryClient, false);

    await flush();

    expect(api.request).not.toHaveBeenCalled();
    expect(view.observers.map((observer) => observer.getCurrentResult().fetchStatus)).toEqual(["idle", "idle", "idle"]);
    view.stop();
  });

  it("'Conectar' abre UMA sessão da árvore e mais nada; só depois, liberadas, as três consultas saem por essa sessão", async () => {
    const queryClient = new QueryClient();
    const view = observe(queryClient, false);

    const connected = await connectTree(queryClient, connection);
    await flush();

    expect(connected).toBe(true);
    expect(api.posts).toHaveLength(1);
    expect(api.gets).toEqual([]);

    view.enable();
    await flush();

    expect(api.posts).toHaveLength(1);
    expect(api.gets).toHaveLength(3);
    expect(api.gets.every((path) => path.includes("/s1/"))).toBe(true);
    view.stop();
  });

  it("conectar com a sessão da árvore já aberta não abre outra", async () => {
    const queryClient = new QueryClient();

    await connectTree(queryClient, connection);
    await connectTree(queryClient, connection);

    expect(api.posts).toHaveLength(1);
  });

  it("a conexão que falha ao abrir devolve falso, não deixa sessão e não libera consulta nenhuma (o aviso é o central)", async () => {
    api.request.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return refused;
      api.gets.push("get");
      return { ok: true, data: [] };
    });
    const queryClient = new QueryClient();
    const view = observe(queryClient, false);

    const connected = await connectTree(queryClient, connection);
    await flush();

    expect(connected).toBe(false);
    expect(api.gets).toEqual([]);
    view.stop();
  });

  it("habilitada (o padrão), a consulta sai como sempre: pela sessão da árvore, que ela mesma abre", async () => {
    const queryClient = new QueryClient();
    const view = observe(queryClient, true);

    await flush();

    expect(api.posts).toHaveLength(1);
    expect(api.gets).toHaveLength(3);
    view.stop();
  });

  it("o que já estava em cache continua à mão com a vista desabilitada, sem nenhuma chamada", async () => {
    const queryClient = new QueryClient();
    const first = observe(queryClient, true);
    await flush();
    first.stop();
    api.request.mockClear();

    const view = observe(queryClient, false);
    await flush();

    expect(view.observers.map((observer) => observer.getCurrentResult().isSuccess)).toEqual([true, true, true]);
    expect(api.request).not.toHaveBeenCalled();
    view.stop();
  });
});
