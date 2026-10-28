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

import { forgetFailedLists } from "./catalog-fetch-failures";
import { catalogCompletion } from "./sql-catalog-completion";
import { invalidateStructure } from "./table-structure.service";
import { sqlCompletion } from "./sql-completion";

freezeParseBudget();

const postgres: Engine = 1;
const db2: Engine = 2;

const node = (kind: NavKind, label: string, detail?: string): NavNode => ({ key: `${kind}:${label}`, kind, label, depth: 0, hasChildren: kind === "table", ...(detail === undefined ? {} : { detail }) });

const columnRows = (...names: string[]) => names.map((name, index) => ({ name, type: index === 0 ? "bigint" : "text", isNullable: index !== 0, isPrimaryKey: index === 0, position: index + 1 }));
const ok = (data: unknown) => Promise.resolve({ ok: true, data });

/** Cada rota da API com o que ela responde, por tabela. */
type Catalog = {
  objectNames?: { schemas: { name: string; isSystem: boolean; tables: string[]; views: string[] }[]; truncated: boolean };
  columns?: Record<string, unknown[]>;
  foreignKeys?: Record<string, unknown[]>;
  referencedBy?: Record<string, unknown[]>;
};

const fk = (name: string, columns: string[], table: string, referencedColumns: string[]) => ({ name, columns, referencedSchema: "public", referencedTable: table, referencedColumns });
const refd = (name: string, table: string, columns: string[], referencedColumns: string[]) => ({ name, referencingSchema: "public", referencingTable: table, columns, referencedColumns });

const serve = (catalog: Catalog) => {
  api.respond = (endpoint) => {
    if (endpoint.endsWith("/object-names")) return ok(catalog.objectNames ?? { schemas: [], truncated: false });
    const [, table, kind] = /\/tables\/([^/]+)\/(columns|foreign-keys|referenced-by)$/.exec(endpoint) ?? [];
    const decoded = decodeURIComponent(table ?? "");
    if (kind === "columns") return ok(catalog.columns?.[decoded] ?? []);
    if (kind === "foreign-keys") return ok(catalog.foreignKeys?.[decoded] ?? []);
    if (kind === "referenced-by") return ok(catalog.referencedBy?.[decoded] ?? []);
    return ok([]);
  };
};

const failing = (code = "SQL_EXECUTION_FAILED") => {
  api.respond = () => Promise.resolve({ ok: false, error: { status: 422, code, title: "Falhou.", detail: "permissão negada", errors: null, extensions: {} } });
};

let queryClient: QueryClient;
let blankLines = false;
let uppercaseKeywords = true;

/** Uma árvore com `public.pedidos`, `public.clientes`, `public.itens_pedido`, `erp.produtos` carregadas (só os nomes das tabelas). */
function seedTree(client: QueryClient, connection = "c1") {
  client.setQueryData(["tree", connection, "schemas"], [node("schema", "erp"), node("schema", "public")]);
  client.setQueryData(["tree", connection, "schema", "public", "objects", "tables"], [node("table", "pedidos"), node("table", "clientes"), node("table", "itens_pedido"), node("table", "Pedidos Antigos")]);
  client.setQueryData(["tree", connection, "schema", "public", "objects", "views"], [node("view", "v_ativos")]);
  client.setQueryData(["tree", connection, "schema", "erp", "objects", "tables"], [node("table", "produtos")]);
}

const openSession = (client: QueryClient, connection = "c1") => client.setQueryData(["database-session", connection], { id: "s1", database: "erp" });

function build(engine: Engine = postgres) {
  return catalogCompletion({ queryClient, engine: () => engine, connectionId: () => "c1", database: () => undefined, userName: () => undefined, blankLines: () => blankLines, uppercaseKeywords: () => uppercaseKeywords });
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
  uppercaseKeywords = true;
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

describe("a junção (RN-SQL-025)", () => {
  beforeEach(() => {
    serve({
      foreignKeys: { pedidos: [fk("fk_pedidos_cliente", ["cliente_id"], "clientes", ["id"])], itens_pedido: [fk("fk_itens_pedido", ["pedido_id"], "pedidos", ["id"])] },
      referencedBy: { pedidos: [refd("fk_itens_pedido", "itens_pedido", ["pedido_id"], ["id"])], clientes: [refd("fk_pedidos_cliente", "pedidos", ["cliente_id"], ["id"])] },
    });
  });

  it("depois de JOIN: busca as chaves das tabelas do comando (as dela e as que a referenciam) e sugere com a condição, no topo", async () => {
    const [, join] = build().sources;
    const asked = ask(join, "select * from pedidos p join |");
    const result = await settled(asked.result);

    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([
      ["clientes c ON c.id = p.cliente_id", "fk_pedidos_cliente"],
      ["itens_pedido ip ON ip.pedido_id = p.id", "fk_itens_pedido"],
    ]);
    expect(result?.from).toBe(asked.at);
    // Mais acima na lista: o `boost` de cada uma cai na ordem.
    const boosts = result?.options.map((option) => option.boost ?? 0) ?? [];
    expect(boosts[0]).toBeGreaterThan(boosts[1]);
    expect(boosts[1]).toBeGreaterThan(0);

    // Só as tabelas do comando: uma requisição por lista, duas por tabela.
    expect(api.calls.map((call) => /tables\/([^/]+)\/([^/]+)$/.exec(call)?.slice(1).join(":"))).toEqual(expect.arrayContaining(["pedidos:foreign-keys", "pedidos:referenced-by"]));
    expect(api.calls).toHaveLength(2);
  });

  it("as listas ficam no cache da Estrutura; o segundo pedido responde na hora e sem requisição", async () => {
    const [, join] = build().sources;
    await settled(ask(join, "select * from pedidos p join |").result);

    const again = ask(join, "select * from pedidos p join cli|");
    expect(again.result).not.toBeInstanceOf(Promise);
    expect(labelsOf(again.result as CompletionResult)).toEqual(["clientes c ON c.id = p.cliente_id", "itens_pedido ip ON ip.pedido_id = p.id"]);
    expect(api.calls).toHaveLength(2);
    expect(queryClient.getQueryData(["table-structure", "c1", "public", "pedidos", "foreignKeys"])).toBeDefined();
    expect(queryClient.getQueryData(["table-structure", "c1", "public", "pedidos", "referencedBy"])).toBeDefined();
  });

  it("várias tabelas no comando: duas requisições por tabela, as da última tabela primeiro", async () => {
    const result = await settled(ask(build().sources[1], "select * from pedidos p join itens_pedido ip on ip.pedido_id = p.id join |").result);

    expect(api.calls).toHaveLength(4);
    // `itens_pedido` é a última escrita; as ligações dela vêm antes (pedidos já está no comando e não volta); a de `pedidos` com `clientes` vem depois.
    expect(labelsOf(result)).toEqual(["clientes c ON c.id = p.cliente_id"]);
  });

  it("sem apelidos no comando, a tabela entra pelo nome inteiro", async () => {
    const result = await settled(ask(build().sources[1], "select * from pedidos join |").result);

    expect(labelsOf(result)).toEqual(["clientes ON clientes.id = pedidos.cliente_id", "itens_pedido ON itens_pedido.pedido_id = pedidos.id"]);
  });

  it("a tabela que o catálogo não conhece, ou a subconsulta, não pedem nada", async () => {
    const [, join] = build().sources;

    expect(await settled(ask(join, "select * from inexistente x join |").result)).toBeNull();
    expect(await settled(ask(join, "select * from (select 1) s join |").result)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("o CROSS JOIN e o JOIN dentro de texto ou de comentário: nada", async () => {
    const [, join] = build().sources;

    for (const text of ["select * from pedidos p cross join |", "select 'join |' from pedidos p", "select * from pedidos p -- join |", "select * from pedidos p /* join | */"]) expect(await settled(ask(join, text).result), text).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("depois de JOIN tabela ON: as condições que ligam a tabela às outras, buscando só as listas dela", async () => {
    const result = await settled(ask(build().sources[1], "select * from pedidos p join clientes c on |").result);

    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([["c.id = p.cliente_id", "fk_pedidos_cliente"]]);
    expect(api.calls.map((call) => /tables\/([^/]+)\//.exec(call)?.[1])).toEqual(["clientes", "clientes"]);
  });

  it("a condição já escrita: nada depois do AND", async () => {
    expect(await settled(ask(build().sources[1], "select * from pedidos p join clientes c on c.id = p.cliente_id and |").result)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("sem a sessão da árvore aberta, só o que já está no cache; sem nada, nada, e nenhuma requisição", async () => {
    queryClient.removeQueries({ queryKey: ["database-session", "c1"] });
    const [, join] = build().sources;

    expect(await settled(ask(join, "select * from pedidos p join |").result)).toBeNull();
    expect(api.calls).toEqual([]);

    queryClient.setQueryData(["table-structure", "c1", "public", "pedidos", "foreignKeys"], [fk("fk_pedidos_cliente", ["cliente_id"], "clientes", ["id"])]);
    expect(labelsOf(await settled(ask(join, "select * from pedidos p join |").result))).toEqual(["clientes c ON c.id = p.cliente_id"]);
    expect(api.calls).toEqual([]);
  });

  it("a busca que falha não mostra nada, não avisa e não se repete; o que já veio de outra tabela vale", async () => {
    failing();
    const [, join] = build().sources;

    expect(await settled(ask(join, "select * from pedidos p join |").result)).toBeNull();
    expect(await settled(ask(join, "select * from pedidos p join |").result)).toBeNull();
    expect(api.calls).toHaveLength(2);
  });

  it("a lista que chega depois de o cursor sair dali é descartada", async () => {
    expect(await settled(ask(build().sources[1], "select * from pedidos p join |", { aborted: true }).result)).toBeNull();
  });

  it("a chave composta, em ordem, e a que o catálogo do banco escreve com aspas", async () => {
    serve({ foreignKeys: { pedidos: [{ name: "fk_empresa", columns: ["empresa", "Cliente Id"], referencedSchema: "public", referencedTable: "clientes", referencedColumns: ["empresa", "id"] }] } });
    const result = await settled(ask(build().sources[1], "select * from pedidos p join |").result);

    expect(labelsOf(result)).toEqual(['clientes c ON c.empresa = p.empresa AND c.id = p."Cliente Id"']);
  });

  it("respeita a preferência uppercaseKeywords desabilitada (on e and em minúsculas)", async () => {
    uppercaseKeywords = false;
    serve({ foreignKeys: { pedidos: [{ name: "fk_empresa", columns: ["empresa", "cliente_id"], referencedSchema: "public", referencedTable: "clientes", referencedColumns: ["empresa", "id"] }] } });
    const [, join] = build().sources;

    const joinResult = await settled(ask(join, "select * from pedidos join |").result);
    expect(labelsOf(joinResult)).toEqual(["clientes on clientes.empresa = pedidos.empresa and clientes.id = pedidos.cliente_id"]);
  });

  it("segue o padrão de qualificação do esquema que o usuário escreveu na tabela de origem", async () => {
    serve({ foreignKeys: { pedidos: [{ name: "fk_produto", columns: ["produto_id"], referencedSchema: "erp", referencedTable: "produtos", referencedColumns: ["id"] }] } });
    const [, join] = build().sources;

    // Sem esquema no FROM: sugere sem esquema no JOIN.
    const unqualified = await settled(ask(join, "select * from pedidos p join |").result);
    expect(labelsOf(unqualified)).toEqual(["produtos p2 ON p2.id = p.produto_id"]);

    // Com esquema no FROM: sugere com esquema no JOIN quando a tabela é de outro esquema.
    const qualified = await settled(ask(join, "select * from public.pedidos p join |").result);
    expect(labelsOf(qualified)).toEqual(["erp.produtos p2 ON p2.id = p.produto_id"]);
  });

  it("funciona sem a lista de tabelas aberta na barra lateral e sem informar o esquema no FROM", async () => {
    uppercaseKeywords = false;
    queryClient.removeQueries({ queryKey: ["tree", "c1"] });
    serve({
      objectNames: {
        schemas: [
          {
            name: "usr_migration_stock_manager",
            isSystem: false,
            tables: ["orders", "orders_packings"],
            views: [],
          },
        ],
        truncated: false,
      },
      columns: { orders: columnRows("id", "code") },
      foreignKeys: { orders: [] },
      referencedBy: {
        orders: [
          {
            name: "fk_orders_packings_order",
            referencingSchema: "usr_migration_stock_manager",
            referencingTable: "orders_packings",
            columns: ["order_id"],
            referencedColumns: ["id"],
          },
        ],
      },
    });

    const [columns, join] = build().sources;

    const joinResult = await settled(ask(join, "select *\n  from orders\n inner join |").result);
    expect(labelsOf(joinResult)).toEqual(["orders_packings on orders_packings.order_id = orders.id"]);

    const colsResult = await settled(ask(columns, "select orders.| from orders").result);
    expect(labelsOf(colsResult)).toEqual(["id", "code"]);
  });

  it("só as tabelas escritas antes do cursor: um JOIN mais adiante ainda não existe no ON de agora", async () => {
    const [, join] = build().sources;

    // `c` entra depois: a condição `p.cliente_id = c.id` neste ON seria SQL inválido. Só a ligação de `ip` com `p` serve.
    const on = await settled(ask(join, "select * from itens_pedido ip join pedidos p on | join clientes c on c.id = p.cliente_id").result);
    expect(labelsOf(on)).toEqual(["p.id = ip.pedido_id"]);

    // Depois de `JOIN`, as tabelas escritas adiante também não contam (nem pedem as chaves delas); só os nomes delas ficam fora dos apelidos novos.
    const after = await settled(ask(join, "select * from pedidos p join | join clientes c on 1 = 1").result);
    expect(labelsOf(after)).toEqual(["clientes c2 ON c2.id = p.cliente_id", "itens_pedido ip ON ip.pedido_id = p.id"]);
    expect(api.calls.filter((call) => call.includes("/clientes/"))).toEqual([]);
  });

  it("o alvo do INSERT INTO não está no escopo do FROM: não conta como tabela do comando, e pode ser sugerido", async () => {
    const result = await settled(ask(build().sources[1], "insert into itens_pedido select * from pedidos p join |").result);

    expect(labelsOf(result)).toEqual(["clientes c ON c.id = p.cliente_id", "itens_pedido ip ON ip.pedido_id = p.id"]);
    expect(api.calls.map((call) => /tables\/([^/]+)\//.exec(call)?.[1])).toEqual(["pedidos", "pedidos"]);
  });

  it("a quebra de linha em branco: o comando do cursor é o da preferência", async () => {
    blankLines = true;
    const result = await settled(ask(build().sources[1], "select * from clientes c\n\nselect * from pedidos p join |").result);

    expect(labelsOf(result)).toEqual(["clientes c ON c.id = p.cliente_id", "itens_pedido ip ON ip.pedido_id = p.id"]);
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

describe("o Atualizar do navegador e da Estrutura refaz o que o autocompletar buscou (RN-CONFIG-004)", () => {
  const treeColumns = ["tree", "c1", "schema", "public", "table", "pedidos", "columns"];
  const structureColumns = ["table-structure", "c1", "public", "pedidos", "columns"];
  const tablePath = { type: "table", connectionId: "c1", schema: "public", table: "pedidos" } as const;

  it("a coluna nova depois do Atualizar: as colunas buscadas pelo autocompletar (sem nó aberto na árvore) são buscadas de novo", async () => {
    const [columns] = build().sources;
    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);

    serve({ columns: { pedidos: columnRows("id", "cliente_id", "total", "obs") } });
    // O mesmo que o navegador faz no nó da tabela: a árvore e a Estrutura, sem observador nenhum.
    await queryClient.invalidateQueries({ queryKey: ["tree", "c1", "schema", "public", "table", "pedidos"] });
    invalidateStructure(queryClient, tablePath, new Set());
    expect(api.calls).toHaveLength(1);

    const asked = ask(columns, "select p.| from pedidos p");
    expect(asked.result).toBeInstanceOf(Promise);
    expect(labelsOf(await settled(asked.result))).toEqual(["id", "cliente_id", "total", "obs"]);
    expect(api.calls).toHaveLength(2);

    // E vale: o próximo pedido responde na hora, e a árvore tem a lista nova.
    expect(ask(columns, "select p.| from pedidos p").result).not.toBeInstanceOf(Promise);
    expect(queryClient.getQueryData<NavNode[]>(treeColumns)?.map((row) => row.label)).toEqual(["id", "cliente_id", "total", "obs"]);
    expect(api.calls).toHaveLength(2);
  });

  it("o Atualizar da conexão, do banco e do esquema também chega às listas da Estrutura", async () => {
    await settled(ask(build().sources[0], "select p.| from pedidos p").result);

    for (const path of [{ type: "connection", connectionId: "c1" }, { type: "database", connectionId: "c1" }, { type: "schema", connectionId: "c1", schema: "public" }] as const) {
      queryClient.setQueryData(structureColumns, queryClient.getQueryData(structureColumns));
      invalidateStructure(queryClient, path, new Set());
      expect(queryClient.getQueryState(structureColumns)?.isInvalidated, path.type).toBe(true);
    }
  });

  it("sem a sessão da árvore, a lista velha é a resposta; nada é buscado", async () => {
    const [columns] = build().sources;
    await settled(ask(columns, "select p.| from pedidos p").result);
    invalidateStructure(queryClient, tablePath, new Set());
    await queryClient.invalidateQueries({ queryKey: treeColumns });
    queryClient.removeQueries({ queryKey: ["database-session", "c1"] });

    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);
    expect(api.calls).toHaveLength(1);
  });

  it("a busca da lista velha que falha: a velha segue valendo, a árvore não fica com o erro e o Atualizar tenta de novo", async () => {
    const [columns] = build().sources;
    await settled(ask(columns, "select p.| from pedidos p").result);
    await queryClient.invalidateQueries({ queryKey: ["tree", "c1", "schema", "public", "table", "pedidos"] });
    invalidateStructure(queryClient, tablePath, new Set());

    failing();
    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);
    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);
    expect(api.calls).toHaveLength(2);
    expect(queryClient.getQueryState(structureColumns)).toMatchObject({ status: "success", isInvalidated: true });
    expect(queryClient.getQueryState(treeColumns)?.status).toBe("success");

    serve({ columns: { pedidos: columnRows("id", "obs") } });
    invalidateStructure(queryClient, tablePath, new Set());
    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "obs"]);
  });

  it("a lista que nunca veio e falhou é tentada de novo depois do Atualizar (e da Estrutura)", async () => {
    failing();
    const [columns] = build().sources;
    expect(await settled(ask(columns, "select p.| from pedidos p").result)).toBeNull();
    expect(await settled(ask(columns, "select p.| from pedidos p").result)).toBeNull();
    expect(api.calls).toHaveLength(1);

    const everything = { columns: { pedidos: columnRows("id", "cliente_id", "total"), clientes: columnRows("id", "nome") } };
    serve(everything);
    forgetFailedLists(queryClient, "c1");
    expect(labelsOf(await settled(ask(columns, "select p.| from pedidos p").result))).toEqual(["id", "cliente_id", "total"]);
    expect(api.calls).toHaveLength(2);

    failing();
    queryClient.removeQueries({ queryKey: ["tree", "c1", "schema", "public", "table", "clientes"] });
    expect(await settled(ask(columns, "select c.| from clientes c").result)).toBeNull();
    invalidateStructure(queryClient, tablePath, new Set());
    serve(everything);
    expect(labelsOf(await settled(ask(columns, "select c.| from clientes c").result))).toEqual(["id", "nome"]);
  });

  it("as chaves estrangeiras da junção: o Atualizar do nó da tabela as refaz", async () => {
    serve({ foreignKeys: { pedidos: [fk("fk_pedidos_cliente", ["cliente_id"], "clientes", ["id"])] }, referencedBy: {} });
    const [, join] = build().sources;
    expect(labelsOf(await settled(ask(join, "select * from pedidos p join |").result))).toEqual(["clientes c ON c.id = p.cliente_id"]);

    serve({ foreignKeys: { pedidos: [fk("fk_pedidos_cliente", ["cliente_id"], "clientes", ["id"]), fk("fk_pedidos_vendedor", ["vendedor_id"], "clientes", ["id"])] }, referencedBy: {} });
    invalidateStructure(queryClient, tablePath, new Set());

    const result = await settled(ask(join, "select * from pedidos p join |").result);
    expect(result?.options.map((option) => option.detail)).toEqual(["fk_pedidos_cliente", "fk_pedidos_vendedor"]);
  });

  it("o banco cuja sessão caiu fica de fora do Atualizar (o navegador o reabre)", async () => {
    await settled(ask(build().sources[0], "select p.| from pedidos p").result);
    invalidateStructure(queryClient, { type: "connection", connectionId: "c1" }, new Set([undefined]));

    expect(queryClient.getQueryState(structureColumns)?.isInvalidated).toBe(false);
  });
});

describe("as colunas dividem o cache com a Estrutura (RN-CONFIG-004)", () => {
  const treeColumns = ["tree", "c1", "schema", "public", "table", "pedidos", "columns"];
  const structureColumns = ["table-structure", "c1", "public", "pedidos", "columns"];

  it("as colunas que a Estrutura já tem respondem na hora, sem requisição, e vão para a árvore", () => {
    queryClient.setQueryData(structureColumns, columnRows("id", "total"));
    const asked = ask(build().sources[0], "select p.| from pedidos p");

    expect(asked.result).not.toBeInstanceOf(Promise);
    expect(labelsOf(asked.result as CompletionResult)).toEqual(["id", "total"]);
    expect(api.calls).toEqual([]);
    expect(queryClient.getQueryData<NavNode[]>(treeColumns)?.map((row) => row.label)).toEqual(["id", "total"]);
  });

  it("as colunas que o autocompletar busca ficam na chave da Estrutura (a vista não pergunta de novo) e na da árvore", async () => {
    await settled(ask(build().sources[0], "select p.| from pedidos p").result);

    expect(queryClient.getQueryData<{ name: string }[]>(structureColumns)?.map((row) => row.name)).toEqual(["id", "cliente_id", "total"]);
    expect(queryClient.getQueryData<NavNode[]>(treeColumns)).toHaveLength(3);
    expect(api.calls).toHaveLength(1);
  });

  it("a lista que a árvore já tem vale: nada é buscado", () => {
    queryClient.setQueryData(treeColumns, [node("column", "id", "bigint")]);
    const asked = ask(build().sources[0], "select p.| from pedidos p");

    expect(labelsOf(asked.result as CompletionResult)).toEqual(["id"]);
    expect(api.calls).toEqual([]);
  });
});

describe("o apelido de fora de uma subconsulta correlacionada (RN-CONFIG-004)", () => {
  it("busca as colunas da tabela do comando de fora", async () => {
    const asked = ask(build().sources[0], "select * from pedidos p where exists (select 1 from itens_pedido i where i.pedido_id = p.|)");
    const result = await settled(asked.result);

    expect(labelsOf(result)).toEqual(["id", "cliente_id", "total"]);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toContain("/tables/pedidos/columns");
  });

  it("o apelido de dentro esconde o de fora", async () => {
    const result = await settled(ask(build().sources[0], "select * from pedidos p where exists (select 1 from itens_pedido p where p.|)").result);

    expect(labelsOf(result)).toEqual(["id", "pedido_id"]);
  });

  it("a fonte de nomes se cala também ali", () => {
    const completion = build();
    const { doc, at } = withoutCursor("select * from pedidos p where exists (select 1 from itens_pedido i where i.pedido_id = p.|)");

    expect(completion.owns(new CompletionContext(EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] }), at, false))).toBe(true);
  });
});

describe("o OUTER do Informix e o USING do DELETE (RN-CONFIG-004)", () => {
  it("o apelido da tabela depois de OUTER busca as colunas", async () => {
    const informix: Engine = 3;
    const completion = catalogCompletion({ queryClient, engine: () => informix, connectionId: () => "c1", database: () => undefined, userName: () => undefined, blankLines: () => false });
    const result = await settled(ask(completion.sources[0], "select * from pedidos p, outer clientes c where c.|").result);

    expect(labelsOf(result)).toEqual(["id", "nome"]);
  });

  it("o apelido da tabela do USING do DELETE busca as colunas", async () => {
    const result = await settled(ask(build().sources[0], "delete from pedidos using clientes c where c.|").result);

    expect(labelsOf(result)).toEqual(["id", "nome"]);
  });
});
