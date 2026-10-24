import { CompletionContext, type autocompletion, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";
import { freezeParseBudget } from "@/lib/testing/parse-budget";
import { withoutCursor } from "@/lib/testing/text";

import type { NavKind, NavNode } from "./navigator-model";

// A configuração que `sqlCompletion` entrega à biblioteca, anotada a cada chamada: é por ela que o teste de junção das fontes roda as DE VERDADE do editor.
type CompletionConfig = NonNullable<Parameters<typeof autocompletion>[0]>;
const configured = vi.hoisted(() => [] as CompletionConfig[]);
vi.mock("@codemirror/autocomplete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@codemirror/autocomplete")>();

  return {
    ...real,
    autocompletion: (config: CompletionConfig) => {
      configured.push(config);
      return real.autocompletion(config);
    },
  };
});

// A rede é a única coisa de mentira: o resto (as consultas da árvore e da Estrutura, a sessão) é o de verdade.
const api = vi.hoisted(() => ({ calls: [] as string[], respond: ((): Promise<unknown> => Promise.resolve({ ok: true, data: [] })) as (endpoint: string) => Promise<unknown> }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/prism-api")>()),
  apiRequest: (endpoint: string) => {
    api.calls.push(endpoint);
    return api.respond(endpoint);
  },
}));

import { catalogCompletion } from "./sql-catalog-completion";
import { sqlCompletion } from "./sql-completion";

freezeParseBudget();

const postgres: Engine = 1;
const db2: Engine = 2;

const node = (kind: NavKind, label: string, detail?: string): NavNode => ({ key: `${kind}:${label}`, kind, label, depth: 0, hasChildren: kind === "table", ...(detail === undefined ? {} : { detail }) });

const columnRows = (...names: string[]) => names.map((name, index) => ({ name, type: index === 0 ? "bigint" : "text", isNullable: index !== 0, isPrimaryKey: index === 0, position: index + 1 }));
const ok = (data: unknown) => Promise.resolve({ ok: true, data });

/** Cada rota da API com o que ela responde, por tabela. */
type Catalog = { columns?: Record<string, unknown[]> };

const serve = (catalog: Catalog) => {
  api.respond = (endpoint) => {
    const [, table] = /\/tables\/([^/]+)\/columns$/.exec(endpoint) ?? [];
    return ok(catalog.columns?.[decodeURIComponent(table ?? "")] ?? []);
  };
};

const failing = (code = "SQL_EXECUTION_FAILED") => {
  api.respond = () => Promise.resolve({ ok: false, error: { status: 422, code, title: "Falhou.", detail: "permissão negada", errors: null, extensions: {} } });
};

let queryClient: QueryClient;
let blankLines = false;

/** Uma árvore com `public.pedidos`, `public.clientes`, `public.itens_pedido`, `erp.produtos` carregadas (só os nomes das tabelas). */
function seedTree(client: QueryClient, connection = "c1") {
  client.setQueryData(["tree", connection, "schemas"], [node("schema", "erp"), node("schema", "public")]);
  client.setQueryData(["tree", connection, "schema", "public", "objects", "tables"], [node("table", "pedidos"), node("table", "clientes"), node("table", "itens_pedido"), node("table", "Pedidos Antigos")]);
  client.setQueryData(["tree", connection, "schema", "public", "objects", "views", ], [node("view", "v_ativos")]);
  client.setQueryData(["tree", connection, "schema", "erp", "objects", "tables"], [node("table", "produtos")]);
}

const openSession = (client: QueryClient, connection = "c1") => client.setQueryData(["database-session", connection], { id: "s1", database: "erp" });

function build(engine: Engine = postgres) {
  return catalogCompletion({ queryClient, engine: () => engine, connectionId: () => "c1", database: () => undefined, userName: () => undefined, blankLines: () => blankLines });
}

/** Roda uma fonte no texto, com o cursor onde está o `|`. */
function ask(source: CompletionSource, text: string, { aborted = false }: { aborted?: boolean } = {}) {
  const { doc, at } = withoutCursor(text);
  const state = EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] });
  const context = new CompletionContext(state, at, false);
  if (aborted) Object.defineProperty(context, "aborted", { value: true });

  return { doc, at, result: source(context) };
}

const settled = async (result: ReturnType<typeof ask>["result"]) => (await result) as CompletionResult | null;
const labelsOf = (result: CompletionResult | null) => (result?.options ?? []).map((option) => option.label);

beforeEach(() => {
  api.calls = [];
  blankLines = false;
  configured.length = 0;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedTree(queryClient);
  openSession(queryClient);
  serve({ columns: { pedidos: columnRows("id", "cliente_id", "total"), clientes: columnRows("id", "nome"), itens_pedido: columnRows("id", "pedido_id"), "Pedidos Antigos": columnRows("id") } });
});

describe("as colunas de nome. (RN-CONFIG-004)", () => {
  it("o apelido de uma tabela do comando: busca as colunas pela consulta da árvore e a lista abre quando chegam", async () => {
    const [columns] = build().sources;
    const asked = ask(columns, "select p.| from pedidos p");

    expect(asked.result).toBeInstanceOf(Promise);
    const result = await settled(asked.result);

    expect(labelsOf(result)).toEqual(["id", "cliente_id", "total"]);
    expect(result?.from).toBe(asked.at);
    expect(result?.options[0]).toMatchObject({ detail: "bigint", type: "property" });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toContain("/schemas/public/tables/pedidos/columns");
  });

  it("as colunas buscadas ficam na consulta da árvore (o navegador as mostra sem perguntar de novo)", async () => {
    await settled(ask(build().sources[0], "select p.| from pedidos p").result);

    const cached = queryClient.getQueryData<NavNode[]>(["tree", "c1", "schema", "public", "table", "pedidos", "columns"]);
    expect(cached?.map((row) => row.label)).toEqual(["id", "cliente_id", "total"]);
    expect(queryClient.getQueryState(["tree", "c1", "schema", "public", "table", "pedidos", "columns"])?.status).toBe("success");
  });

  it("já no cache: responde na hora, sem requisição", () => {
    queryClient.setQueryData(["tree", "c1", "schema", "public", "table", "clientes", "columns"], [node("column", "id", "bigint"), node("column", "nome", "text · nulo")]);
    const asked = ask(build().sources[0], "select c.| from clientes c");

    expect(asked.result).not.toBeInstanceOf(Promise);
    expect(labelsOf(asked.result as CompletionResult)).toEqual(["id", "nome"]);
    expect(api.calls).toEqual([]);
  });

  it("uma requisição por tabela, mesmo com vários pedidos ao mesmo tempo", async () => {
    const [columns] = build().sources;
    const pending = [ask(columns, "select p.| from pedidos p").result, ask(columns, "select p.t| from pedidos p").result, ask(columns, "select pedidos.| from pedidos").result];

    await Promise.all(pending);
    expect(api.calls).toHaveLength(1);

    // E o próximo pedido já acha o cache.
    ask(columns, "select p.| from pedidos p");
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    ["o nome da tabela escrita no comando", "select pedidos.| from pedidos", "pedidos"],
    ["a tabela do catálogo sem estar no comando", "select clientes.| from pedidos", "clientes"],
    ["o esquema e a tabela", "select public.clientes.| from pedidos", "clientes"],
    ["o apelido com AS", "select c.| from pedidos p join clientes as c on c.id = p.cliente_id", "clientes"],
    ["o apelido de UPDATE", "update clientes c set c.|", "clientes"],
    ["o apelido numa lista com vírgulas", "select c.| from pedidos p, clientes c", "clientes"],
    ["o apelido numa junção com vários", "select i.| from pedidos p join clientes c on 1=1 left outer join itens_pedido i on 1=1", "itens_pedido"],
    ["o nome entre aspas", 'select "Pedidos Antigos".| from "Pedidos Antigos"', "Pedidos%20Antigos"],
    ["o INSERT INTO", "insert into clientes (id) select c.| from clientes c", "clientes"],
  ])("%s", async (_name, text, table) => {
    const result = await settled(ask(build().sources[0], text).result);

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toContain(`/tables/${table}/columns`);
    expect(result).not.toBeNull();
  });

  it("a subconsulta e o apelido dela não são tabela: nada é buscado", async () => {
    const result = await settled(ask(build().sources[0], "select s.| from (select * from pedidos) s").result);

    expect(result).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("o apelido de uma tabela que o catálogo não tem: nada, sem requisição", async () => {
    expect(await settled(ask(build().sources[0], "select x.| from inexistente x").result)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("só com a sessão da árvore aberta: sem ela, nada é pedido (nem a sessão)", async () => {
    queryClient.removeQueries({ queryKey: ["database-session", "c1"] });
    const asked = ask(build().sources[0], "select p.| from pedidos p");

    expect(await settled(asked.result)).toBeNull();
    expect(api.calls).toEqual([]);
    expect(queryClient.getQueryData(["database-session", "c1"])).toBeUndefined();
  });

  it("a sessão de outro banco do servidor não vale para este, e as colunas vão para a árvore dele", async () => {
    const other = catalogCompletion({ queryClient, engine: () => postgres, connectionId: () => "c1", database: () => "estoque", userName: () => undefined, blankLines: () => false });
    queryClient.setQueryData(["tree", "c1", { database: "estoque" }, "schema", "public", "objects", "tables"], [node("table", "pedidos")]);

    expect(await settled(ask(other.sources[0], "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls).toEqual([]);

    queryClient.setQueryData(["database-session", "c1", { database: "estoque" }], { id: "s2", database: "estoque" });
    expect(labelsOf(await settled(ask(other.sources[0], "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);
    expect(queryClient.getQueryData(["tree", "c1", { database: "estoque" }, "schema", "public", "table", "pedidos", "columns"])).toBeDefined();
  });

  it("a busca que falha não mostra nada, não avisa e não se repete na mesma sessão; a árvore não fica com o erro", async () => {
    failing();
    const [columns] = build().sources;

    expect(await settled(ask(columns, "select p.| from pedidos p").result)).toBeNull();
    expect(await settled(ask(columns, "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls).toHaveLength(1);
    expect(queryClient.getQueryCache().find({ queryKey: ["tree", "c1", "schema", "public", "table", "pedidos", "columns"] })).toBeUndefined();
  });

  it("a sessão perdida também é só um nada (não reabre a sessão)", async () => {
    failing("DATABASE_SESSION_NOT_FOUND");

    expect(await settled(ask(build().sources[0], "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls.filter((call) => call.includes("database-sessions") && !call.includes("/tables/"))).toEqual([]);
  });

  it("a lista que chega depois de o cursor sair dali é descartada", async () => {
    expect(await settled(ask(build().sources[0], "select p.| from pedidos p", { aborted: true }).result)).toBeNull();
    // Os dados chegaram ao cache e servem ao pedido seguinte.
    expect(queryClient.getQueryData(["tree", "c1", "schema", "public", "table", "pedidos", "columns"])).toBeDefined();
  });

  it("dentro de texto, de comentário e depois de um ponto solto: nada", async () => {
    const [columns] = build().sources;

    for (const text of ["select 'p.|' from pedidos p", "select 1 -- p.|\nfrom pedidos p", "select /* p.| */ 1 from pedidos p", "select .| from pedidos p"]) expect(await settled(ask(columns, text).result), text).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("o nome entre aspas que a pessoa começou: as colunas voltam como quoteIdentifier as escreve, e as aspas que a tela fechou são trocadas", async () => {
    serve({ columns: { pedidos: columnRows("id", "Valor Total") } });
    const [columns] = build().sources;

    const open = await settled(ask(columns, 'select p."Va| from pedidos p').result);
    expect(open?.options.map((option) => option.label)).toEqual(['"id"', '"Valor Total"']);
    expect(open?.to).toBeUndefined();

    const closed = ask(columns, 'select p."|" from pedidos p');
    const result = await settled(closed.result);
    expect(result?.from).toBe(closed.at - 1);
    expect(result?.to).toBe(closed.at + 1);
  });

  it("as colunas do Db2 em maiúsculas vão cruas, as outras entre aspas", async () => {
    queryClient.setQueryData(["tree", "c1", "schema", "MARIA", "objects", "tables"], [node("table", "PEDIDOS")]);
    queryClient.setQueryData(["tree", "c1", "schema", "MARIA", "table", "PEDIDOS", "columns"], [node("column", "ID", "BIGINT"), node("column", "Valor", "DECIMAL")]);
    const asked = ask(catalogCompletion({ queryClient, engine: () => db2, connectionId: () => "c1", database: () => undefined, userName: () => "maria", blankLines: () => false }).sources[0], "select p.| from pedidos p");

    expect((asked.result as CompletionResult).options.map((option) => option.apply ?? option.label)).toEqual(["ID", '"Valor"']);
  });

  it("a aba sem conexão não completa nada", async () => {
    const none = catalogCompletion({ queryClient, engine: () => postgres, connectionId: () => null, database: () => undefined, userName: () => undefined, blankLines: () => false });

    expect(await settled(ask(none.sources[0], "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("a fonte de nomes se cala onde as colunas são das novas; o resto fica com ela", () => {
    const completion = build();
    const owns = (text: string) => {
      const { doc, at } = withoutCursor(text);
      return completion.owns(new CompletionContext(EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] }), at, false));
    };

    expect(owns("select p.| from pedidos p")).toBe(true);
    expect(owns("select public.| from pedidos p")).toBe(false);
    expect(owns("select x.| from inexistente x")).toBe(false);
    expect(owns("select | from pedidos p")).toBe(false);
  });
});

describe("dentro da extensão do editor (sqlCompletion)", () => {
  /** As fontes que a extensão entrega à biblioteca (o `override`). */
  function sources(variables?: Parameters<typeof sqlCompletion>[0]["variables"]) {
    const catalog = build();
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [], catalog, ...(variables === undefined ? {} : { variables }) });
    return configured.at(-1)?.override as CompletionSource[];
  }

  it("com as colunas no cache, cada coluna aparece uma vez só (a fonte de nomes do lang-sql cala onde a nova responde)", async () => {
    // As colunas estão no cache da árvore, de onde a fonte de nomes do lang-sql também as lê.
    queryClient.setQueryData(["tree", "c1", "schema", "public", "table", "pedidos", "columns"], [node("column", "id", "bigint"), node("column", "total", "numeric")]);
    const levels = () => [
      { key: ["tree", "c1", "schema", "public", "objects", "tables"], nodes: [node("table", "pedidos")] },
      { key: ["tree", "c1", "schema", "public", "table", "pedidos", "columns"], nodes: [node("column", "id", "bigint"), node("column", "total", "numeric")] },
    ];
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels, catalog: build() });
    const override = configured.at(-1)?.override as CompletionSource[];

    // Sem a nova, a fonte de nomes sozinha já dá as duas: é ela que não pode repeti-las.
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels });
    const before = (configured.at(-1)?.override as CompletionSource[]).map((source) => ask(source, "select p.| from pedidos p").result);
    expect((await Promise.all(before)).flatMap((answer) => labelsOf(answer as CompletionResult | null)).sort()).toEqual(["id", "total"]);

    const answers = await Promise.all(override.map((source) => settled(ask(source, "select p.| from pedidos p").result)));
    const labels = answers.flatMap(labelsOf);

    expect(labels.sort()).toEqual(["id", "total"]);
  });

  it("as fontes novas respeitam o unlessQuiet das variáveis", async () => {
    const quiet = sources({ sources: [], quietsSql: () => true });

    for (const source of quiet) expect(await settled(ask(source, "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("sem a opção catalog, a extensão é a de antes (só o que a árvore já carregou)", async () => {
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [] });
    const override = configured.at(-1)?.override as CompletionSource[];

    expect(override).toHaveLength(2);
    for (const source of override) await settled(ask(source, "select p.| from pedidos p").result);
    expect(api.calls).toEqual([]);
  });
});
