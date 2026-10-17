import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import { backgroundMenu, ignoresContextMenu, keyActionFor, menuFor, type MenuItem, type MenuState } from "./navigator-menu";
import { selectAllSql } from "./table-sql";
import { columnNodes, databaseNodes, flattenVisible, foreignKeyNodes, indexNodes, navKey, objectNodes, schemaNodes, tableGroupNodes, treeNodes, type NavNode, type TableLevelPath } from "./navigator-model";

const now = "2026-10-09T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 1, host: "srv", port: 5432, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };
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
  it("desconectada: Conectar, Nova consulta, Atualizar (desabilitado, não há o que atualizar), Editar conexão, Renomear, Duplicar conexão, Mover, Excluir, Exportar conexão… e Copiar nome", () => {
    const groups = menuFor(connectionNode, state("disconnected"));

    // Mover e Excluir vieram da tela de Conexões (RN-NAV-003): lá, mover era trocar a pasta no formulário, e excluir era o botão dele.
    // Renomear e Duplicar conexão são da RN-NAV-009 e da RN-CONN-016; Exportar conexão…, da RN-TRANSF-001, num grupo próprio antes de Copiar nome.
    expect(ids(groups)).toEqual([["connect", "newQuery"], ["refresh", "editConnection"], ["renameConnection", "duplicateConnection", "moveConnection", "deleteConnection"], ["exportConnection"], ["copyName"]]);
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

    expect(flat(groups).map((item) => item.action)).toEqual([
      { type: "disconnect" },
      { type: "newQuery" },
      { type: "refresh" },
      { type: "editConnection" },
      { type: "renameConnection" },
      { type: "duplicateConnection" },
      { type: "moveConnection" },
      { type: "deleteConnection" },
      { type: "exportConnections" },
      { type: "copy", text: "MES Produção" },
    ]);
  });

  it("Exportar conexão… (RN-TRANSF-001) vale em qualquer estado da conexão: exportar não mexe em sessão, em proteção nem no cofre", () => {
    for (const status of ["disconnected", "connecting", "connected", "failed"] as const) {
      expect(byId(menuFor(connectionNode, state(status, true)), "exportConnection")).toMatchObject({ label: "Exportar conexão…", action: { type: "exportConnections" } });
      expect(byId(menuFor(connectionNode, state(status, true)), "exportConnection")?.disabled).toBeFalsy();
    }
    // Uma conexão somente leitura não muda nada: o menu nem olha a proteção.
    expect(byId(menuFor(connectionNode, idle), "exportConnection")?.shortcut).toBeUndefined();
  });

  it("Mover e Excluir valem em qualquer estado: excluir uma conexão conectada encerra as sessões dela (RN-CONN-014)", () => {
    for (const status of ["disconnected", "connecting", "connected", "failed"] as const) {
      expect(byId(menuFor(connectionNode, state(status, true)), "moveConnection")?.disabled).toBeFalsy();
      expect(byId(menuFor(connectionNode, state(status, true)), "deleteConnection")?.disabled).toBeFalsy();
    }
    expect([byId(menuFor(connectionNode, idle), "moveConnection")?.label, byId(menuFor(connectionNode, idle), "deleteConnection")?.label]).toEqual(["Mover", "Excluir"]);
  });

  it("Renomear (F2, RN-NAV-009) e Duplicar conexão (RN-CONN-016) valem em qualquer estado: a cópia nasce desconectada, e renomear não mexe na sessão", () => {
    for (const status of ["disconnected", "connecting", "connected", "failed"] as const) {
      expect(byId(menuFor(connectionNode, state(status, true)), "renameConnection")?.disabled).toBeFalsy();
      expect(byId(menuFor(connectionNode, state(status, true)), "duplicateConnection")?.disabled).toBeFalsy();
    }
    expect(byId(menuFor(connectionNode, idle), "renameConnection")).toMatchObject({ label: "Renomear", shortcut: "F2" });
    expect(byId(menuFor(connectionNode, idle), "duplicateConnection")).toMatchObject({ label: "Duplicar conexão" });
    expect(byId(menuFor(connectionNode, idle), "duplicateConnection")?.shortcut).toBeUndefined();
  });
});

describe("menuFor: esquema, banco e grupo", () => {
  it("esquema: Nova consulta, Atualizar e Copiar nome", () => {
    const groups = menuFor(schemaNode, idle);

    expect(ids(groups)).toEqual([["newQuery", "refresh"], ["copyName"]]);
    expect(byId(groups, "copyName")?.action).toEqual({ type: "copy", text: "vendas" });
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("banco: Nova consulta, Atualizar e Copiar nome", () => {
    expect(ids(menuFor(databaseNode, idle))).toEqual([["newQuery", "refresh"], ["copyName"]]);
  });

  it("grupo (Tabelas, Colunas…): só Atualizar; copiar o nome de um rótulo fixo não serve a ninguém", () => {
    expect(ids(menuFor(group, idle))).toEqual([["refresh"]]);
  });
});

describe("menuFor: tabela e visão (RN-MENU-001 e RN-TABELA-001)", () => {
  it("tabela: as três vistas, Gerar SELECT, Exportar dados… e Importar dados… (RN-EXPORT-001 e RN-IMPORT-001, num grupo próprio) e as duas cópias", () => {
    const groups = menuFor(table, idle);

    expect(ids(groups)).toEqual([["openRecords", "openStructure", "openDiagram"], ["generateSelect"], ["exportData", "importData"], ["copyName", "copyQualifiedName"]]);
    expect(flat(groups).map((item) => item.action)).toEqual([
      { type: "openTable", view: "data" },
      { type: "openTable", view: "structure" },
      { type: "openTable", view: "diagram" },
      { type: "generateSelect" },
      { type: "exportData" },
      { type: "importData" },
      { type: "copy", text: "pedido" },
      { type: "copy", text: '"vendas"."pedido"' },
    ]);
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
    expect(byId(groups, "exportData")?.label).toBe("Exportar dados…");
    expect(byId(groups, "importData")?.label).toBe("Importar dados…");
    expect(byId(groups, "importData")?.hint).toBeUndefined();
  });

  it("visão: o mesmo menu, sem Importar dados… (RN-IMPORT-001: só uma tabela recebe linhas)", () => {
    const groups = menuFor(view, idle);

    expect(ids(groups)).toEqual([["openRecords", "openStructure", "openDiagram"], ["generateSelect"], ["exportData"], ["copyName", "copyQualifiedName"]]);
    expect(flat(groups).map((item) => item.action)).toEqual([
      { type: "openTable", view: "data" },
      { type: "openTable", view: "structure" },
      { type: "openTable", view: "diagram" },
      { type: "generateSelect" },
      { type: "exportData" },
      { type: "copy", text: "v_pedido" },
      { type: "copy", text: '"vendas"."v_pedido"' },
    ]);
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("tabela de uma conexão somente leitura: Importar dados… desabilitado, com o motivo embaixo do rótulo; o resto, inclusive Exportar dados…, continua", () => {
    const groups = menuFor(table, { ...idle, readOnly: true });

    expect(flat(groups).filter((item) => item.disabled).map((item) => item.id)).toEqual(["importData"]);
    expect(byId(groups, "importData")?.hint).toBe("A conexão é somente leitura: importar grava na tabela.");
    expect(byId(menuFor(view, { ...idle, readOnly: true }), "exportData")?.disabled).toBeFalsy();
  });

  it("a conexão desconectada não desabilita Importar dados…: a importação tem conexão própria (RN-IMPORT-015)", () => {
    for (const status of ["disconnected", "failed", "connecting"] as const) expect(byId(menuFor(table, { ...idle, status }), "importData")?.disabled).toBe(false);
  });

  it("só mostram atalho as teclas que a árvore já trata (nenhum atalho de mentira): o Enter de Abrir registros e o F2 de Renomear", () => {
    const shortcuts = (node: NavNode) => flat(menuFor(node, idle)).filter((item) => item.shortcut !== undefined).map((item) => [item.id, item.shortcut]);

    expect(shortcuts(table)).toEqual([["openRecords", "Enter"]]);
    expect(shortcuts(connectionNode)).toEqual([["renameConnection", "F2"]]);
    expect(shortcuts(folderNode)).toEqual([["renameFolder", "F2"]]);
    for (const node of [schemaNode, databaseNode, column]) expect(shortcuts(node)).toEqual([]);
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
  const views = ["openRecords", "openStructure", "openDiagram", "generateSelect"];

  it.each([
    ["tabela", { ...table, key: wrongKey }, ["exportData", "importData"]],
    ["visão", { ...view, key: `${wrongKey}#view:0` }, ["exportData"]],
  ])("%s: as ações aparecem desabilitadas, em vez de sumirem, e só o nome cru continua habilitado", (_kind, node, transfers) => {
    const groups = menuFor(node, { ...idle, readOnly: true });

    expect(ids(groups)).toEqual([["openRecords", "openStructure", "openDiagram"], ["generateSelect"], transfers, ["copyName", "copyQualifiedName"]]);
    expect(flat(groups).filter((item) => item.disabled).map((item) => item.id)).toEqual([...views, ...transfers, "copyQualifiedName"]);
    // O motivo do somente leitura não aparece onde o item já não vale por outro motivo (a tela não sabe onde a tabela está).
    expect(flat(groups).some((item) => item.hint !== undefined)).toBe(false);
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

  it("pasta: Nova conexão e Nova pasta (criam dentro dela), Renomear, Editar pasta…, Mover, Excluir, Exportar conexões…, Importar conexões aqui… e Copiar nome (RN-NAV-003 e RN-TRANSF-001)", () => {
    const groups = menuFor(folderNode, idle);

    expect(ids(groups)).toEqual([["newConnection", "newFolder"], ["renameFolder", "editFolder", "moveFolder", "deleteFolder"], ["exportConnections", "importHere"], ["copyName"]]);
    expect(flat(groups).map((item) => item.action.type)).toEqual(["newConnection", "newFolder", "renameFolder", "editFolder", "moveFolder", "deleteFolder", "exportConnections", "importConnections", "copy"]);
    expect([byId(groups, "exportConnections")?.label, byId(groups, "importHere")?.label]).toEqual(["Exportar conexões…", "Importar conexões aqui…"]);
    expect([byId(groups, "newConnection")?.label, byId(groups, "newFolder")?.label]).toEqual(["Nova conexão", "Nova pasta"]);
    expect(flat(groups).some((item) => item.disabled)).toBe(false);
  });

  it("pasta: o Renomear (F2) muda só o nome, como o da conexão (RN-NAV-009), e o Editar pasta…, sem atalho, abre o diálogo inteiro (RN-PASTA-006)", () => {
    const groups = menuFor(folderNode, idle);

    expect(byId(groups, "renameFolder")).toMatchObject({ label: "Renomear", shortcut: "F2", action: { type: "renameFolder" } });
    expect(byId(groups, "editFolder")).toMatchObject({ label: "Editar pasta…", action: { type: "editFolder" } });
    expect(byId(groups, "editFolder")?.shortcut).toBeUndefined();
    // O mesmo rótulo e o mesmo atalho do Renomear da conexão.
    expect(byId(menuFor(connectionNode, idle), "renameConnection")).toMatchObject({ label: byId(groups, "renameFolder")?.label, shortcut: "F2" });
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

describe("keyActionFor: as teclas da linha que são ações do menu (RN-NAV-009)", () => {
  const f2 = { key: "F2", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

  it("F2 na pasta é o Renomear da pasta, e na conexão o Renomear da conexão", () => {
    expect(keyActionFor(folderNode, f2)).toEqual({ type: "renameFolder" });
    expect(keyActionFor(connectionNode, f2)).toEqual({ type: "renameConnection" });
  });

  it("nenhuma tecla da linha abre o Editar pasta… (RN-PASTA-006: ele não tem atalho)", () => {
    for (const key of ["F2", "F3", "F4", "Enter", "e", "E"])
      for (const modifier of [{}, { shiftKey: true }, { ctrlKey: true }, { altKey: true }]) expect(keyActionFor(folderNode, { ...f2, key, ...modifier })).not.toEqual({ type: "editFolder" });
  });

  it("nas outras linhas o F2 não faz nada: banco, esquema, grupo, tabela, visão, rotina, coluna, índice e chave estrangeira não se renomeiam", () => {
    for (const node of [databaseNode, schemaNode, group, table, view, routine, column, index, foreignKey]) expect(keyActionFor(node, f2)).toBeNull();
  });

  it("com Shift, Ctrl, Alt ou Cmd não é o F2 do Renomear", () => {
    for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"] as const) {
      expect(keyActionFor(folderNode, { ...f2, [modifier]: true })).toBeNull();
      expect(keyActionFor(connectionNode, { ...f2, [modifier]: true })).toBeNull();
    }
  });

  it("outras teclas não são ação do menu por aqui (Enter, setas e o menu têm o tratamento delas na árvore)", () => {
    for (const key of ["Enter", "F1", "F3", "Delete", "ArrowLeft", "ContextMenu"]) expect(keyActionFor(connectionNode, { ...f2, key })).toBeNull();
  });

  it("a tecla faz o mesmo que o item do menu que a mostra como atalho", () => {
    for (const node of [folderNode, connectionNode]) {
      const shortcut = flat(menuFor(node, idle)).find((item) => item.shortcut === "F2");

      expect(keyActionFor(node, f2)).toEqual(shortcut?.action);
    }
  });
});

describe("backgroundMenu: o botão direito no espaço vazio do navegador (RN-NAV-003)", () => {
  it("Nova conexão e Nova pasta, que criam na raiz, sempre habilitadas, e, num grupo depois delas, Exportar conexões… e Importar conexões… (RN-TRANSF-001)", () => {
    const groups = backgroundMenu();

    expect(ids(groups)).toEqual([["newConnection", "newFolder"], ["exportConnections", "importConnections"]]);
    expect(flat(groups).map((item) => [item.label, item.disabled ?? false])).toEqual([
      ["Nova conexão", false],
      ["Nova pasta", false],
      ["Exportar conexões…", false],
      ["Importar conexões…", false],
    ]);
    expect(flat(groups).map((item) => item.action)).toEqual([{ type: "newConnection" }, { type: "newFolder" }, { type: "exportConnections" }, { type: "importConnections" }]);
  });

  it("sem nenhuma pasta e nenhuma conexão no cofre, Exportar conexões… fica desabilitado, com o motivo; Importar conexões… continua", () => {
    const groups = backgroundMenu(false);

    expect(byId(groups, "exportConnections")).toMatchObject({ disabled: true, hint: "Não há pastas nem conexões para exportar." });
    expect(byId(groups, "importConnections")?.disabled).toBeFalsy();
    expect(byId(groups, "newConnection")?.disabled).toBeFalsy();
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
