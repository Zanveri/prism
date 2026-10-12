import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { databaseSessionKey, treeKey } from "./database-sessions.service";
import { navKey, type NavPath } from "./navigator-model";
import { structureKey } from "./table-structure.service";
import { forgetMissingConnections, isConnected, nextActiveTab, ownedByMissingConnection, pruneWorkbench, type QueryTab } from "./workbench-model";

function tab(id: string, connectionId: string): QueryTab {
  return { id, title: `consulta-${id}.sql`, connectionId, sessionId: `sessao-${id}`, sql: `select '${id}'` };
}

const key = (path: NavPath) => navKey(path);

describe("pruneWorkbench (conexão que some)", () => {
  const tabs = [tab("a", "c1"), tab("b", "c2"), tab("c", "c2"), tab("d", "c1")];
  const expanded = new Set([
    key({ type: "connection", connectionId: "c1" }),
    key({ type: "database", connectionId: "c1" }),
    key({ type: "connection", connectionId: "c2" }),
    key({ type: "schema", connectionId: "c2", schema: "public" }),
    key({ type: "table", connectionId: "c2", schema: "public", table: "t" }),
  ]);

  it("com todas as conexões na lista, não há o que podar", () => {
    expect(pruneWorkbench({ tabs, activeTabId: "b", expanded }, new Set(["c1", "c2"]))).toBeNull();
  });

  it("com a lista ainda sem chegar (nula), não poda nada: lista vazia seria outra coisa", () => {
    expect(pruneWorkbench({ tabs, activeTabId: "b", expanded }, null)).toBeNull();
  });

  it("tira as abas da conexão que sumiu e deixa as outras como estavam, texto incluído", () => {
    const pruned = pruneWorkbench({ tabs, activeTabId: "a", expanded }, new Set(["c1"]));

    expect(pruned?.tabs.map((remaining) => remaining.id)).toEqual(["a", "d"]);
    expect(pruned?.tabs[0]).toBe(tabs[0]);
    expect(pruned?.activeTabId).toBe("a");
  });

  it("a aba ativa que sumiu passa para a vizinha da direita entre as que ficam", () => {
    expect(pruneWorkbench({ tabs, activeTabId: "b", expanded }, new Set(["c1"]))?.activeTabId).toBe("d");
  });

  it("sem vizinha à direita, passa para a da esquerda", () => {
    expect(pruneWorkbench({ tabs: [tab("a", "c1"), tab("b", "c2")], activeTabId: "b", expanded: new Set() }, new Set(["c1"]))?.activeTabId).toBe("a");
  });

  it("sem nenhuma aba que reste, nenhuma fica ativa", () => {
    const pruned = pruneWorkbench({ tabs: [tab("a", "c1")], activeTabId: "a", expanded: new Set() }, new Set(["c9"]));

    expect(pruned?.tabs).toEqual([]);
    expect(pruned?.activeTabId).toBeNull();
  });

  it("os nós abertos da conexão que sumiu saem, e os das outras ficam", () => {
    const pruned = pruneWorkbench({ tabs, activeTabId: "a", expanded }, new Set(["c1"]));

    expect([...(pruned?.expanded ?? [])]).toEqual([key({ type: "connection", connectionId: "c1" }), key({ type: "database", connectionId: "c1" })]);
  });

  it("só nós abertos de uma conexão que sumiu, sem aba nenhuma: ainda há o que podar", () => {
    const pruned = pruneWorkbench({ tabs: [], activeTabId: null, expanded }, new Set(["c1"]));

    expect(pruned?.expanded.size).toBe(2);
    expect(pruned?.tabs).toEqual([]);
  });
});

describe("nextActiveTab (fechar aba)", () => {
  const tabs = [tab("a", "c1"), tab("b", "c1"), tab("c", "c1")];

  it("fechou uma que não era a ativa: a ativa continua", () => {
    expect(nextActiveTab(tabs, "a", [tabs[0], tabs[2]])).toBe("a");
  });

  it("fechou a ativa do meio: vai para a da direita", () => {
    expect(nextActiveTab(tabs, "b", [tabs[0], tabs[2]])).toBe("c");
  });

  it("fechou a última ativa: vai para a da esquerda", () => {
    expect(nextActiveTab(tabs, "c", [tabs[0], tabs[1]])).toBe("b");
  });
});

describe("ownedByMissingConnection (cache da árvore)", () => {
  const existing = new Set(["c1"]);

  it("a sessão e os níveis de uma conexão que não está na lista são dela", () => {
    expect(ownedByMissingConnection(["database-session", "c9"], existing)).toBe(true);
    expect(ownedByMissingConnection(["tree", "c9", "schemas"], existing)).toBe(true);
  });

  it("os de uma conexão que continua na lista não são", () => {
    expect(ownedByMissingConnection(["database-session", "c1"], existing)).toBe(false);
    expect(ownedByMissingConnection(["tree", "c1", "schema", "public", "objects", "tables"], existing)).toBe(false);
  });
});

describe("forgetMissingConnections (o cache de uma conexão que some da lista)", () => {
  /** Uma consulta de cada família de dado de conexão, com as chaves de verdade (se a forma de uma mudar, o teste enxerga). */
  const familiesOf = (connectionId: string) => [
    databaseSessionKey(connectionId),
    treeKey({ type: "database", connectionId }),
    treeKey({ type: "tableLevel", connectionId, schema: "public", table: "clientes", level: "columns" }),
    structureKey(connectionId, "public", "clientes", "columns"),
    structureKey(connectionId, "public", "clientes", "foreignKeys"),
  ];

  function cacheWith(keys: (readonly unknown[])[]) {
    const queryClient = new QueryClient();
    for (const queryKey of keys) queryClient.setQueryData(queryKey, { dado: "de banco" });
    return queryClient;
  }

  const keysIn = (queryClient: QueryClient) => queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey)).sort();

  it("a sessão da árvore, os níveis dela e a estrutura das tabelas (as vistas da aba) de uma conexão excluída saem do cache, e as das que ficam não", () => {
    const queryClient = cacheWith([...familiesOf("excluida"), ...familiesOf("fica")]);

    forgetMissingConnections(queryClient, new Set(["fica"]));

    expect(keysIn(queryClient)).toEqual(familiesOf("fica").map((queryKey) => JSON.stringify(queryKey)).sort());
  });

  it("o id da conexão está na posição 1 da chave das três famílias: é o que o esquecer procura", () => {
    for (const queryKey of familiesOf("c7")) expect(queryKey[1]).toBe("c7");
  });

  it("o que não é de uma conexão (as listas do cofre, a sessão do usuário, os drivers) não é tocado", () => {
    const others = [["connections"], ["folders"], ["session"], ["drivers"]];
    const queryClient = cacheWith([...others, ...familiesOf("excluida")]);

    forgetMissingConnections(queryClient, new Set());

    expect(keysIn(queryClient)).toEqual(others.map((queryKey) => JSON.stringify(queryKey)).sort());
  });

  it("sem conexão nenhuma na lista, todas saem; com todas na lista, nada sai", () => {
    const keys = [...familiesOf("a"), ...familiesOf("b")];
    const all = cacheWith(keys);
    const none = cacheWith(keys);

    forgetMissingConnections(all, new Set(["a", "b"]));
    forgetMissingConnections(none, new Set());

    expect(all.getQueryCache().getAll()).toHaveLength(keys.length);
    expect(none.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("isConnected (a definição única de conexão conectada)", () => {
  const open = tab("a", "c1");
  const closed: QueryTab = { ...tab("b", "c2"), sessionId: null };

  it("com a sessão da árvore aberta, está conectada, com ou sem aba", () => {
    expect(isConnected("c1", [], true)).toBe(true);
    expect(isConnected("c2", [closed], true)).toBe(true);
  });

  it("com a árvore fechada e uma aba com sessão, está conectada: há o que desconectar", () => {
    expect(isConnected("c1", [open, closed], false)).toBe(true);
  });

  it("aba sem sessão, ou aba com sessão de outra conexão, não conecta", () => {
    expect(isConnected("c2", [open, closed], false)).toBe(false);
    expect(isConnected("c3", [open], false)).toBe(false);
  });
});
