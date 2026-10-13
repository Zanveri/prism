import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import { backgroundMenu, ignoresContextMenu, menuFor, type MenuItem, type MenuState } from "./navigator-menu";
import { selectAllSql } from "./table-sql";
import { columnNodes, databaseNodes, flattenVisible, foreignKeyNodes, indexNodes, navKey, objectNodes, schemaNodes, tableGroupNodes, treeNodes, type NavNode, type TableLevelPath } from "./navigator-model";

const now = "2026-10-09T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Fábrica", createdAt: now, updatedAt: now };
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 1, host: "srv", port: 5432, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };
const { roots } = treeNodes(buildConnectionTree([folder], [mes]));
const [folderNode] = roots;
const connectionNode: NavNode = { key: JSON.stringify({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES Produção", depth: 1, hasChildren: true };
const [databaseNode] = databaseNodes("c1", [{ name: "mes", isCurrent: true }]);
const [schemaNode] = schemaNodes("c1", [{ name: "vendas", isSystem: false }]);
const [table] = objectNodes("c1", "vendas", "tables", [{ name: "pedido", kind: "table" }]);
const [view] = objectNodes("c1", "vendas", "views", [{ name: "v_pedido", kind: "view" }]);
const [routine] = objectNodes("c1", "vendas", "routines", [{ name: "calcula", kind: "function" }]);
const columns: TableLevelPath = { type: "tableLevel", connectionId: "c1", schema: "vendas", table: "pedido", level: "columns" };
const [column] = columnNodes(columns, [{ name: "id", type: "uuid", isNullable: false, isPrimaryKey: true, position: 1 }]);
const [index] = indexNodes({ ...columns, level: "indexes" }, [{ name: "pk_pedido", columns: ["id"], isUnique: true }]);
const [foreignKey] = foreignKeyNodes({ ...columns, level: "foreignKeys" }, [{ name: "fk_cliente", columns: ["cliente_id"], referencedSchema: "vendas", referencedTable: "cliente", referencedColumns: ["id"] }]);
const [group] = tableGroupNodes("c1", "vendas", "pedido");

const state = (status: MenuState["status"], busy = false): MenuState => ({ status, busy });
const idle = state("disconnected");
const ids = (groups: MenuItem[][]) => groups.map((items) => items.map((item) => item.id));
const flat = (groups: MenuItem[][]) => groups.flat();
const byId = (groups: MenuItem[][], id: string) => flat(groups).find((item) => item.id === id);

describe("menuFor: conexão (RN-MENU-001)", () => {
  it("desconectada: Conectar, Nova consulta, Atualizar (desabilitado, não há o que atualizar), Editar conexão, Mover, Excluir e Copiar nome", () => {
    const groups = menuFor(connectionNode, state("disconnected"));

    // Mover e Excluir vieram da tela de Conexões (RN-NAV-003): lá, mover era trocar a pasta no formulário, e excluir era o botão dele.
    expect(ids(groups)).toEqual([["connect", "newQuery"], ["refresh", "editConnection"], ["moveConnection", "deleteConnection"], ["copyName"]]);
    expect(flat(groups).filter((item) => item.disabled).map((item) => item.id)).toEqual(["refresh"]);
  });

  it("conectada: Desconectar no lugar de Conectar, e Atualizar habilitado", () => {
    const groups = menuFor(connectionNode, state("connected"));

    expect(ids(groups)[0]).toEqual(["disconnect", "newQuery"]);
    expect(byId(groups, "connect")).toBeUndefined();
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("Desconectar fica desabilitado enquanto a desconexão está em andamento", () => {
    expect(byId(menuFor(connectionNode, state("connected", true)), "disconnect")?.disabled).toBe(true);
  });

  it("conectando: Conectar desabilitado, para não pedir uma segunda sessão", () => {
    expect(byId(menuFor(connectionNode, state("connecting")), "connect")?.disabled).toBe(true);
  });

  it("com falha ao conectar, Conectar está habilitado: tenta de novo", () => {
    expect(byId(menuFor(connectionNode, state("failed")), "connect")?.disabled).toBeFalsy();
  });

  it("as ações dizem o que a tela deve fazer, e Copiar nome leva o nome da conexão", () => {
    const groups = menuFor(connectionNode, state("connected"));

    expect(flat(groups).map((item) => item.action)).toEqual([{ type: "disconnect" }, { type: "newQuery" }, { type: "refresh" }, { type: "editConnection" }, { type: "moveConnection" }, { type: "deleteConnection" }, { type: "copy", text: "MES Produção" }]);
  });

  it("Mover e Excluir valem em qualquer estado: excluir uma conexão conectada encerra as sessões dela (RN-CONN-014)", () => {
    for (const status of ["disconnected", "connecting", "connected", "failed"] as const) {
      expect(byId(menuFor(connectionNode, state(status, true)), "moveConnection")?.disabled).toBeFalsy();
      expect(byId(menuFor(connectionNode, state(status, true)), "deleteConnection")?.disabled).toBeFalsy();
    }
    expect([byId(menuFor(connectionNode, idle), "moveConnection")?.label, byId(menuFor(connectionNode, idle), "deleteConnection")?.label]).toEqual(["Mover", "Excluir"]);
  });
});

describe("menuFor: esquema, banco e grupo", () => {
  it("esquema: Nova consulta, Atualizar e Copiar nome", () => {
    const groups = menuFor(schemaNode, idle);

    expect(ids(groups)).toEqual([["newQuery", "refresh"], ["copyName"]]);
    expect(byId(groups, "copyName")?.action).toEqual({ type: "copy", text: "vendas" });
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("banco: Atualizar e Copiar nome (o 'Atualizar' que a linha já tem ao passar o mouse)", () => {
    expect(ids(menuFor(databaseNode, idle))).toEqual([["refresh"], ["copyName"]]);
  });

  it("grupo (Tabelas, Colunas…): só Atualizar; copiar o nome de um rótulo fixo não serve a ninguém", () => {
    expect(ids(menuFor(group, idle))).toEqual([["refresh"]]);
  });
});

describe("menuFor: tabela e visão (RN-MENU-001 e RN-TABELA-001)", () => {
  it.each([
    ["tabela", table, "pedido"],
    ["visão", view, "v_pedido"],
  ])("%s: as três vistas, Gerar SELECT e as duas cópias", (_name, node, name) => {
    const groups = menuFor(node, idle);

    expect(ids(groups)).toEqual([["openRecords", "openStructure", "openDiagram"], ["generateSelect"], ["copyName", "copyQualifiedName"]]);
    expect(flat(groups).map((item) => item.action)).toEqual([
      { type: "openTable", view: "data" },
      { type: "openTable", view: "structure" },
      { type: "openTable", view: "diagram" },
      { type: "generateSelect" },
      { type: "copy", text: name },
      { type: "copy", text: `"vendas"."${name}"` },
    ]);
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("só Abrir registros mostra atalho, e é o Enter que a árvore já trata (nenhum atalho de mentira)", () => {
    const withShortcut = flat(menuFor(table, idle)).filter((item) => item.shortcut !== undefined);

    expect(withShortcut.map((item) => [item.id, item.shortcut])).toEqual([["openRecords", "Enter"]]);
    for (const node of [connectionNode, schemaNode, folderNode, column]) expect(flat(menuFor(node, idle)).some((item) => item.shortcut !== undefined)).toBe(false);
  });

  it("o nome qualificado leva o esquema da visão, que sai do pai e não do rótulo", () => {
    const [other] = objectNodes("c1", "outro esquema", "views", [{ name: "v", kind: "view" }]);

    expect(byId(menuFor(other, idle), "copyQualifiedName")?.action).toEqual({ type: "copy", text: '"outro esquema"."v"' });
  });

  it("o nome qualificado vai entre aspas duplas, como o catálogo o devolve: o que tem espaço, acento ou maiúscula cola no editor", () => {
    const qualified = (schema: string, name: string) => {
      const [node] = objectNodes("c1", schema, "tables", [{ name, kind: "table" }]);
      return byId(menuFor(node, idle), "copyQualifiedName")?.action;
    };

    expect(qualified("producao", "Notas Fiscais")).toEqual({ type: "copy", text: '"producao"."Notas Fiscais"' });
    expect(qualified("produção", "Máquina")).toEqual({ type: "copy", text: '"produção"."Máquina"' });
    expect(qualified("a", 'b"c')).toEqual({ type: "copy", text: '"a"."b""c"' });
  });

  it("é o mesmo nome que o 'Gerar SELECT' escreve, nos três bancos: o texto copiado é o que vem depois do FROM", () => {
    for (const [schema, name] of [["vendas", "pedido"], ["Fábrica 2", "Notas Fiscais"], ['a"b', 'c;--d']] as const) {
      const [node] = objectNodes("c1", schema, "tables", [{ name, kind: "table" }]);
      const action = byId(menuFor(node, idle), "copyQualifiedName")?.action;

      for (const engine of [1, 2, 3] as const) expect(selectAllSql(engine, schema, name)).toBe(`SELECT * FROM ${action?.type === "copy" ? action.text : ""}`);
    }
  });

  it("'Copiar nome' continua copiando o nome cru, sem aspas", () => {
    const [node] = objectNodes("c1", "vendas", "tables", [{ name: "Notas Fiscais", kind: "table" }]);

    expect(byId(menuFor(node, idle), "copyName")?.action).toEqual({ type: "copy", text: "Notas Fiscais" });
  });
});

describe("menuFor: tabela ou visão que o menu não sabe localizar", () => {
  const wrongKey = navKey({ type: "connection", connectionId: "c1" });
  const ids6 = ["openRecords", "openStructure", "openDiagram", "generateSelect", "copyQualifiedName"];

  it.each([
    ["tabela", { ...table, key: wrongKey }],
    ["visão", { ...view, key: `${wrongKey}#view:0` }],
  ])("%s: as ações aparecem desabilitadas, em vez de sumirem, e só o nome cru continua habilitado", (_kind, node) => {
    const groups = menuFor(node, idle);

    expect(ids(groups)).toEqual([["openRecords", "openStructure", "openDiagram"], ["generateSelect"], ["copyName", "copyQualifiedName"]]);
    expect(flat(groups).filter((item) => item.disabled).map((item) => item.id)).toEqual(ids6);
    expect(byId(groups, "copyName")?.disabled).toBeFalsy();
    expect(byId(groups, "copyName")?.action).toEqual({ type: "copy", text: node.label });
  });
});

describe("menuFor: o resto da árvore", () => {
  it.each([
    ["rotina", routine, "calcula"],
    ["coluna", column, "id"],
    ["índice", index, "pk_pedido"],
    ["chave estrangeira", foreignKey, "fk_cliente"],
  ])("%s: só Copiar nome", (_kind, node, name) => {
    expect(menuFor(node, idle)).toEqual([[expect.objectContaining({ id: "copyName", action: { type: "copy", text: name } })]]);
  });

  it("pasta: Nova conexão e Nova pasta (criam dentro dela), Renomear, Mover, Excluir e Copiar nome (o que a tela de Conexões oferecia, RN-NAV-003)", () => {
    const groups = menuFor(folderNode, idle);

    expect(ids(groups)).toEqual([["newConnection", "newFolder"], ["renameFolder", "moveFolder", "deleteFolder"], ["copyName"]]);
    expect(flat(groups).map((item) => item.action.type)).toEqual(["newConnection", "newFolder", "renameFolder", "moveFolder", "deleteFolder", "copy"]);
    expect([byId(groups, "newConnection")?.label, byId(groups, "newFolder")?.label]).toEqual(["Nova conexão", "Nova pasta"]);
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("as linhas Carregando… e de erro não têm menu", () => {
    const rows = flattenVisible([connectionNode], new Set([connectionNode.key]), new Map());
    const failed = flattenVisible([connectionNode], new Set([connectionNode.key]), new Map([[`children:${connectionNode.key}`, { status: "error" as const, message: "falhou" }]]));

    expect(menuFor(rows[1], idle)).toEqual([]);
    expect(menuFor(failed[1], idle)).toEqual([]);
  });

  it("o nome vai à área de transferência como está: texto, sem aparar nem escapar", () => {
    const [hostile] = objectNodes("c1", "s", "tables", [{ name: ' Pedido "x"<b>1</b> ', kind: "table" }]);

    expect(byId(menuFor(hostile, idle), "copyName")?.action).toEqual({ type: "copy", text: ' Pedido "x"<b>1</b> ' });
  });

  it("nenhum grupo vazio e nenhum id repetido no mesmo menu", () => {
    for (const node of [connectionNode, databaseNode, schemaNode, group, table, view, routine, column, index, foreignKey, folderNode]) {
      const groups = menuFor(node, state("connected"));
      const all = flat(groups).map((item) => item.id);

      expect(groups.every((items) => items.length > 0)).toBe(true);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe("backgroundMenu: o botão direito no espaço vazio do navegador (RN-NAV-003)", () => {
  it("Nova conexão e Nova pasta, que criam na raiz, sempre habilitadas", () => {
    const groups = backgroundMenu();

    expect(ids(groups)).toEqual([["newConnection", "newFolder"]]);
    expect(flat(groups).map((item) => [item.label, item.disabled ?? false])).toEqual([
      ["Nova conexão", false],
      ["Nova pasta", false],
    ]);
  });
});

describe("ignoresContextMenu (a tecla de menu gera um contextmenu no keyup)", () => {
  it("um menu aberto pelo teclado ignora o contextmenu do ponteiro que vem depois: é o que a tecla de menu gera ao ser solta, em cima do menu que ela abriu", () => {
    expect(ignoresContextMenu("first", "menu")).toBe(true);
  });

  it("sem menu aberto, ou com um aberto pelo ponteiro, o botão direito abre o menu da linha", () => {
    expect(ignoresContextMenu(null, "menu")).toBe(false);
    expect(ignoresContextMenu("menu", "menu")).toBe(false);
  });

  it("o teclado sempre abre (Shift+F10 e a tecla de menu), mesmo com outro menu aberto", () => {
    expect(ignoresContextMenu(null, "first")).toBe(false);
    expect(ignoresContextMenu("menu", "first")).toBe(false);
    expect(ignoresContextMenu("first", "first")).toBe(false);
  });
});
