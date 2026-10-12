import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { databaseSessionKey, treeKey } from "./database-sessions.service";
import { structureKey } from "./table-structure.service";
import { dropDataAtLock, isDroppedAtLock, withoutSessions } from "./workbench-lock";
import { connectionOwnedFamilies, type QueryTab } from "./workbench-model";

const query: QueryTab = { id: "a", title: "consulta-1.sql", connectionId: "c1", sessionId: "s1", sql: "select 1\nfrom t" };
const table: QueryTab = { id: "b", title: "public.clientes", connectionId: "c2", sessionId: "s2", sql: "", table: { schema: "public", name: "clientes", view: "structure" } };

describe("withoutSessions: as abas depois do bloqueio (RN-SEG-001)", () => {
  it("mantém tudo o que o usuário abriu (as abas, a ordem, o texto de SQL, a tabela e a vista) e só perde a sessão, que a API já fechou", () => {
    expect(withoutSessions([query, table])).toEqual([
      { ...query, sessionId: null },
      { ...table, sessionId: null },
    ]);
  });

  it("devolve SEMPRE uma lista nova, de abas novas, mesmo sem nenhuma sessão: é essa mudança de identidade que os painéis veem do bloqueio, e sem ela ficam com o executor velho (o primeiro Ctrl+Enter rodaria num executor órfão)", () => {
    const idle: QueryTab = { ...query, sessionId: null };
    const tabs = [idle];

    const next = withoutSessions(tabs);

    expect(next).not.toBe(tabs);
    expect(next[0]).not.toBe(idle);
    expect(next).toEqual(tabs);
    expect(withoutSessions([])).toEqual([]);
  });

  it("não altera as abas que recebeu", () => {
    const tabs = [query];

    withoutSessions(tabs);

    expect(tabs[0].sessionId).toBe("s1");
  });
});

describe("isDroppedAtLock: o que do cache não sobrevive ao bloqueio", () => {
  it("dado de banco cai: a sessão da árvore, os níveis dela e a estrutura de cada tabela", () => {
    expect(isDroppedAtLock(["database-session", "c1"])).toBe(true);
    expect(isDroppedAtLock(["tree", "c1", "schemas"])).toBe(true);
    expect(isDroppedAtLock(["tree", "c1", "schema", "public", "table", "clientes", "columns"])).toBe(true);
    expect(isDroppedAtLock(["table-structure", "c1", "public", "clientes", "columns"])).toBe(true);
  });

  it("o que não é dado de banco fica: quem está entrando, as listas do cofre, os drivers e as preferências de atualização", () => {
    for (const root of ["session", "folders", "connections", "drivers", "update-preferences"]) expect(isDroppedAtLock([root])).toBe(false);
  });

  it("uma família que ninguém combinou cai: na dúvida, o dado não sobrevive ao bloqueio", () => {
    expect(isDroppedAtLock(["table-ddl", "c1", "public", "clientes"])).toBe(true);
    expect(isDroppedAtLock([])).toBe(true);
  });
});

describe("dropDataAtLock: nada de dado de banco em cache sobrevive ao bloqueio", () => {
  const kept = [["session"], ["folders"], ["connections"], ["drivers"], ["update-preferences"]];
  const databaseData = [
    databaseSessionKey("c1"),
    treeKey({ type: "database", connectionId: "c1" }),
    treeKey({ type: "tableLevel", connectionId: "c1", schema: "public", table: "clientes", level: "indexes" }),
    // A estrutura das tabelas que a aba de uma tabela mostra (Estrutura e Diagrama): é dado de banco, com a conexão na posição 1 da chave.
    structureKey("c1", "public", "clientes", "columns"),
    structureKey("c1", "public", "clientes", "foreignKeys"),
    structureKey("c2", "public", "pedidos", "indexes"),
  ];

  it("a sessão da árvore, os níveis e a estrutura das tabelas saem; o que não é dado de banco fica", () => {
    const queryClient = new QueryClient();
    for (const queryKey of [...kept, ...databaseData]) queryClient.setQueryData(queryKey, { dado: "de banco" });

    dropDataAtLock(queryClient);

    expect(queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey)).sort()).toEqual(kept.map((queryKey) => JSON.stringify(queryKey)).sort());
  });

  it("toda família que é de uma conexão (a lista que o esquecer da conexão excluída usa) cai no bloqueio: as duas listas não se afastam", () => {
    for (const family of connectionOwnedFamilies) expect(isDroppedAtLock([family, "c1"])).toBe(true);
    expect(connectionOwnedFamilies).toContain("table-structure");
  });
});
