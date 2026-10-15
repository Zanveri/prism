import { describe, expect, it } from "vitest";

import type { SavedTab, SavedWorkspace } from "../../../../electron/workspace-messages";
import { isScriptDirty } from "./saved-scripts";
import { createWorkspaceSource, holdWorkspace, restoreWorkspace, savedTabOf, toSavedWorkspace, withHeld, type RestoreContext } from "./saved-workspace";
import type { QueryTab } from "./workbench-model";

const c1 = "0199dd00-0000-7000-8000-000000000001";
const c2 = "0199dd00-0000-7000-8000-000000000002";
const s1 = "0199dd00-0000-7000-8000-0000000000a1";
const s2 = "0199dd00-0000-7000-8000-0000000000a2";

const queryTab = (id: string, sql: string, extra: Partial<QueryTab> = {}): QueryTab => ({ id, title: `consulta-${id}.sql`, connectionId: c1, sessionId: "sessao", sql, ...extra });
const tableTab = (id: string, name: string, extra: Partial<QueryTab> = {}): QueryTab => ({ id, title: `loja.${name}`, connectionId: c1, sessionId: null, sql: "", table: { schema: "loja", name, view: "data" }, ...extra });

const noLive = () => null;

describe("o que vai para o cofre (RN-ABAS-006)", () => {
  it("da aba de consulta: o texto, a conexão, o banco, o script e a mudança não salva; da de tabela: a conexão, o banco, o esquema, a tabela e a vista; nada de sessão nem de título", () => {
    const tabs = [
      queryTab("a", "SELECT 1", { database: "vendas", script: { id: s1, name: "Relatório", savedSql: "SELECT 0", dirty: true } }),
      tableTab("b", "pedidos", { database: "vendas", table: { schema: "loja", name: "pedidos", view: "structure" } }),
      queryTab("c", "SELECT 3", { connectionId: null }),
    ];

    expect(toSavedWorkspace(tabs, "b", noLive)).toEqual({
      tabs: [
        { kind: "query", connectionID: c1, database: "vendas", sql: "SELECT 1", scriptID: s1, dirty: true, sqlTooLarge: false },
        { kind: "table", connectionID: c1, database: "vendas", schema: "loja", table: "pedidos", view: "structure" },
        { kind: "query", connectionID: null, database: null, sql: "SELECT 3", scriptID: null, dirty: false, sqlTooLarge: false },
      ],
      activeIndex: 1,
    } satisfies SavedWorkspace);
  });

  it("o texto é o do editor DESTE instante, e a mudança não salva do script segue esse texto", () => {
    const tab = queryTab("a", "SELECT 1", { script: { id: s1, name: "Relatório", savedSql: "SELECT 1", dirty: false } });

    expect(savedTabOf(tab, "SELECT 12")).toMatchObject({ sql: "SELECT 12", dirty: true });
    expect(savedTabOf({ ...tab, sql: "SELECT 12", script: { ...tab.script!, dirty: true } }, "SELECT 1")).toMatchObject({ sql: "SELECT 1", dirty: false });
  });

  it("o script salvo noutro banco, na aba nesse banco e sem mexer no texto, vai sem a marca de mudança não salva; noutro banco, vai com ela (RN-ARVORE-007)", () => {
    const script = { id: s1, name: "Relatório", savedSql: "SELECT 1", savedDatabase: "vendas", dirty: false };

    expect(savedTabOf(queryTab("a", "SELECT 1", { database: "vendas", script }), null)).toMatchObject({ database: "vendas", dirty: false });
    expect(savedTabOf(queryTab("a", "SELECT 1", { database: "compras", script }), null)).toMatchObject({ dirty: true });
    expect(savedTabOf(queryTab("a", "SELECT 1", { script }), null)).toMatchObject({ dirty: true });
  });

  it("o texto acima de 1 MB não vai: a aba vai vazia, marcada", () => {
    expect(savedTabOf(queryTab("a", "é".repeat(512 * 1024 + 1)), null)).toMatchObject({ sql: "", sqlTooLarge: true });
    expect(savedTabOf(queryTab("a", "a".repeat(1024 * 1024)), null)).toMatchObject({ sqlTooLarge: false });
  });

  it("sem abas, sem aba ativa", () => {
    expect(toSavedWorkspace([], null, noLive)).toEqual({ tabs: [], activeIndex: null });
  });
});

describe("a janela que fecha (RN-ABAS-004 com a RN-ABAS-006)", () => {
  it("as abas que fecham por causa da janela continuam no que volta, com o que mudou nelas antes de fechar, e a ativa é a de quando a janela começou a fechar", () => {
    const tabs = [queryTab("a", "SELECT 1"), queryTab("b", "SELECT 2", { script: { id: s1, name: "R", savedSql: "SELECT 0", dirty: true } }), queryTab("c", "SELECT 3")];
    const held = holdWorkspace(tabs, "b", (id) => (id === "c" ? "SELECT 33" : null));

    // O script foi salvo na pergunta, e a primeira aba fechou; depois, todas.
    const saved = withHeld(held, [tabs[1], tabs[2]].map((tab) => (tab.id === "b" ? { ...tab, script: { ...tab.script!, savedSql: "SELECT 2", dirty: false } } : tab)), noLive);
    const closed = withHeld(saved.held, [], noLive);

    expect(closed.workspace.tabs.map((tab) => (tab.kind === "query" ? [tab.sql, tab.dirty] : null))).toEqual([
      ["SELECT 1", false],
      ["SELECT 2", false],
      ["SELECT 3", false],
    ]);
    expect(closed.workspace.activeIndex).toBe(1);
  });

  it("a aba que chega durante o fechamento entra no fim", () => {
    const held = holdWorkspace([queryTab("a", "SELECT 1")], "a", noLive);

    expect(withHeld(held, [queryTab("a", "SELECT 1"), queryTab("z", "SELECT 9")], noLive).workspace.tabs).toHaveLength(2);
  });
});

describe("o que volta na próxima entrada (RN-ABAS-006)", () => {
  let next = 0;
  const context = (overrides: Partial<RestoreContext> = {}): RestoreContext => ({
    connections: new Set([c1]),
    scripts: new Map([[s1, { name: "Relatório", sql: "SELECT 'salvo'" }]]),
    newId: () => `nova-${++next}`,
    nextNumber: (() => {
      let number = 7;
      return () => number++;
    })(),
    ...overrides,
  });
  const query = (sql: string, extra: Partial<Extract<SavedTab, { kind: "query" }>> = {}): SavedTab => ({ kind: "query", connectionID: c1, database: null, sql, scriptID: null, dirty: false, sqlTooLarge: false, ...extra });
  const table = (name: string, extra: Partial<Extract<SavedTab, { kind: "table" }>> = {}): SavedTab => ({ kind: "table", connectionID: c1, database: null, schema: "loja", table: name, view: "data", ...extra });

  it("voltam na ordem, desconectadas, com ids e números de consulta novos, e a ativa é a que estava", () => {
    const restored = restoreWorkspace({ tabs: [query("SELECT 1", { database: "vendas" }), table("pedidos", { view: "diagram", database: "vendas" }), query("SELECT 2")], activeIndex: 1 }, context());

    expect(restored.tabs).toEqual([
      { id: "nova-1", title: "consulta-7.sql", connectionId: c1, database: "vendas", sessionId: null, sql: "SELECT 1" },
      { id: "nova-2", title: "vendas.loja.pedidos", connectionId: c1, database: "vendas", sessionId: null, sql: "", table: { schema: "loja", name: "pedidos", view: "diagram" } },
      { id: "nova-3", title: "consulta-8.sql", connectionId: c1, sessionId: null, sql: "SELECT 2" },
    ] satisfies QueryTab[]);
    expect(restored.activeTabId).toBe("nova-2");
    expect(restored.tableConnections).toEqual(new Set([c1]));
  });

  it("a aba que veio de um script volta ligada a ele, com o nome e a marca de mudança não salva; a do script excluído volta como consulta comum", () => {
    const restored = restoreWorkspace({ tabs: [query("SELECT 'editado'", { scriptID: s1, dirty: true }), query("SELECT 'salvo'", { scriptID: s1 }), query("SELECT 'sumiu'", { scriptID: s2, dirty: true })], activeIndex: 0 }, context());

    expect(restored.tabs[0]).toMatchObject({ title: "Relatório", sql: "SELECT 'editado'", script: { id: s1, name: "Relatório", savedSql: "SELECT 'salvo'", dirty: true } });
    expect(restored.tabs[1]).toMatchObject({ title: "Relatório", script: { id: s1, savedSql: "SELECT 'salvo'", dirty: false } });
    expect(restored.tabs[2]).toMatchObject({ title: "consulta-7.sql", sql: "SELECT 'sumiu'" });
    expect(restored.tabs[2].script).toBeUndefined();
  });

  it("sem o texto salvo do script em mãos, a aba sem mudança usa o próprio texto, e a com mudança fica marcada", () => {
    const restored = restoreWorkspace({ tabs: [query("SELECT 1", { scriptID: s1 }), query("SELECT 2", { scriptID: s1, dirty: true })], activeIndex: 0 }, context({ scripts: new Map([[s1, { name: "Relatório", sql: null }]]) }));

    expect(restored.tabs[0].script).toEqual({ id: s1, name: "Relatório", savedSql: "SELECT 1", dirty: false });
    expect(restored.tabs[1].script?.dirty).toBe(true);
  });

  it("o script salvo noutro banco volta com esse banco como o salvo, e a aba nele não fica marcada (RN-ARVORE-007)", () => {
    const restored = restoreWorkspace(
      { tabs: [query("SELECT 'salvo'", { scriptID: s1, database: "vendas" })], activeIndex: 0 },
      context({ scripts: new Map([[s1, { name: "Relatório", sql: "SELECT 'salvo'", database: "vendas" }]]) }),
    );
    const tab = restored.tabs[0] as QueryTab;

    expect(tab.script).toMatchObject({ id: s1, savedDatabase: "vendas", dirty: false });
    expect(isScriptDirty(tab.script!, tab.sql, tab.database)).toBe(false);
  });

  it("a aba de consulta cuja conexão foi excluída volta sem conexão (e sem banco), e a de tabela não volta; a ativa passa à vizinha", () => {
    const restored = restoreWorkspace({ tabs: [query("SELECT 1"), table("pedidos", { connectionID: c2 }), query("SELECT 2", { connectionID: c2, database: "vendas" })], activeIndex: 1 }, context());

    expect(restored.tabs.map((tab) => [tab.sql, tab.connectionId, tab.database])).toEqual([
      ["SELECT 1", c1, undefined],
      ["SELECT 2", null, undefined],
    ]);
    expect(restored.withoutConnection).toBe(1);
    expect(restored.droppedTables).toBe(1);
    expect(restored.activeTabId).toBe(restored.tabs[1].id);
  });

  it("a aba cujo texto passava de 1 MB volta vazia, e diz qual foi", () => {
    const restored = restoreWorkspace({ tabs: [query("", { sqlTooLarge: true }), query("", { sqlTooLarge: true, scriptID: s1, dirty: true })], activeIndex: 0 }, context());

    expect(restored.tabs.map((tab) => tab.sql)).toEqual(["", ""]);
    expect(restored.emptied).toEqual(["consulta-7.sql", "Relatório"]);
  });

  it("nada gravado: nada volta", () => {
    expect(restoreWorkspace({ tabs: [], activeIndex: null }, context())).toMatchObject({ tabs: [], activeTabId: null, emptied: [], withoutConnection: 0, droppedTables: 0 });
  });
});

describe("createWorkspaceSource: o que a janela conta, deste instante", () => {
  it("conta as abas que a área de trabalho deu por último; segurando (a janela que fecha), as que fecharam ficam; soltando, saem", () => {
    const source = createWorkspaceSource(noLive);
    const tabs = [queryTab("a", "SELECT 1"), queryTab("b", "SELECT 2")];
    source.update(tabs, "b");
    expect(source.read().tabs).toHaveLength(2);

    source.hold();
    source.update([tabs[1]], "b");
    expect(source.read().tabs).toHaveLength(2);
    source.update([], null);
    expect(source.read()).toMatchObject({ tabs: [{ sql: "SELECT 1" }, { sql: "SELECT 2" }], activeIndex: 1 });

    source.release();
    expect(source.read()).toEqual({ tabs: [], activeIndex: null });
  });
});
