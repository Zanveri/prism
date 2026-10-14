import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import type { MenuState } from "./navigator-menu";
import { columnNodes, databaseNodes, flattenVisible, foreignKeyNodes, indexNodes, navKey, objectNodes, schemaNodes, tableGroupNodes, treeNodes, type NavNode, type TableLevelPath } from "./navigator-model";
import { isRefreshable, selectionConnectionId, targetFolderId, toolbarFor, type ToolbarButton, type ToolbarSelection } from "./navigator-toolbar";

const now = "2026-10-12T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 1, host: "srv", port: 5432, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };
const { roots } = treeNodes(buildConnectionTree([folder], [mes]));
const [folderNode] = roots;
const connectionNode: NavNode = { key: navKey({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES Produção", depth: 1, hasChildren: true };
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
const loadingRow = flattenVisible([connectionNode], new Set([connectionNode.key]), new Map())[1];
const errorRow = flattenVisible([connectionNode], new Set([connectionNode.key]), new Map([[`children:${connectionNode.key}`, { status: "error" as const, message: "falhou" }]]))[1];

const nothing: ToolbarSelection = { node: null, connection: null, folder: null };
const onFolder: ToolbarSelection = { node: folderNode, connection: null, folder: { id: "f1", name: "Fábrica" } };

/** O item escolhido é da conexão MES (que mora na pasta Fábrica), no estado dado. */
const onConnection = (node: NavNode, status: MenuState["status"], busy = false): ToolbarSelection => ({ node, connection: { id: "c1", name: "MES Produção", status, busy }, folder: { id: "f1", name: "Fábrica" } });

const byId = (buttons: ToolbarButton[], id: ToolbarButton["id"]) => {
  const button = buttons.find((candidate) => candidate.id === id);
  if (button === undefined) throw new Error(`A barra não tem o botão ${id}.`);
  return button;
};
const disabledIds = (buttons: ToolbarButton[]) => buttons.filter((button) => button.disabled).map((button) => button.id);

describe("toolbarFor: a barra de ações do navegador (RN-NAV-002)", () => {
  it("tem sempre os mesmos botões, na ordem do pedido: o que não se aplica fica desabilitado, não some", () => {
    const order = ["newConnection", "newFolder", "connect", "disconnect", "refresh", "collapseAll", "hide"];

    for (const selection of [nothing, onFolder, onConnection(connectionNode, "disconnected"), onConnection(connectionNode, "connected"), onConnection(column, "connected")]) {
      expect(toolbarFor(selection, { canCollapse: true }).map((button) => button.id)).toEqual(order);
    }
  });

  it("Nova conexão e Nova pasta estão SEMPRE habilitadas, qualquer que seja o item escolhido e o estado da conexão (RN-NAV-002, pedido do dono)", () => {
    const selections = [nothing, onFolder, ...(["disconnected", "connecting", "connected", "failed"] as const).flatMap((status) => [onConnection(connectionNode, status), onConnection(column, status, true), onConnection(table, status)])];

    for (const selection of selections) {
      for (const canCollapse of [true, false]) {
        const buttons = toolbarFor(selection, { canCollapse });
        expect([byId(buttons, "newConnection").disabled, byId(buttons, "newFolder").disabled]).toEqual([false, false]);
      }
    }
  });

  it("sem nada escolhido: Nova conexão, Nova pasta e Esconder valem; Conectar, Desconectar e Atualizar não têm sobre o que agir", () => {
    const buttons = toolbarFor(nothing, { canCollapse: true });

    expect(disabledIds(buttons)).toEqual(["connect", "disconnect", "refresh"]);
    expect(buttons.map((button) => button.label)).toEqual(["Nova conexão", "Nova pasta", "Conectar", "Desconectar", "Atualizar", "Recolher tudo", "Esconder o navegador"]);
  });

  it("com uma pasta escolhida: criar é dentro dela, e o nome do botão diz onde; as ações de conexão continuam desabilitadas", () => {
    const buttons = toolbarFor(onFolder, { canCollapse: true });

    expect(disabledIds(buttons)).toEqual(["connect", "disconnect", "refresh"]);
    expect(byId(buttons, "newConnection").label).toBe("Nova conexão em Fábrica");
    expect(byId(buttons, "newFolder").label).toBe("Nova pasta em Fábrica");
  });

  it("conexão desconectada: só Conectar, e o nome diz qual conexão", () => {
    const buttons = toolbarFor(onConnection(connectionNode, "disconnected"), { canCollapse: true });

    expect(disabledIds(buttons)).toEqual(["disconnect", "refresh"]);
    expect(byId(buttons, "connect").label).toBe("Conectar MES Produção");
  });

  it("conexão que falhou ao conectar: Conectar tenta de novo", () => {
    expect(disabledIds(toolbarFor(onConnection(connectionNode, "failed"), { canCollapse: true }))).toEqual(["disconnect", "refresh"]);
  });

  it("conectando: nem Conectar (pediria uma segunda sessão) nem Desconectar", () => {
    expect(disabledIds(toolbarFor(onConnection(connectionNode, "connecting"), { canCollapse: true }))).toEqual(["connect", "disconnect", "refresh"]);
  });

  it("conexão conectada: Desconectar e Atualizar valem, Conectar não", () => {
    const buttons = toolbarFor(onConnection(connectionNode, "connected"), { canCollapse: true });

    expect(disabledIds(buttons)).toEqual(["connect"]);
    expect(byId(buttons, "disconnect").label).toBe("Desconectar MES Produção");
    expect(byId(buttons, "refresh").label).toBe("Atualizar MES Produção");
  });

  it("Desconectar fica desabilitado enquanto a desconexão está em andamento", () => {
    expect(disabledIds(toolbarFor(onConnection(connectionNode, "connected", true), { canCollapse: true }))).toEqual(["connect", "disconnect"]);
  });

  it.each([
    ["banco", databaseNode, "mes"],
    ["esquema", schemaNode, "vendas"],
    ["grupo", group, "Colunas"],
    ["tabela", table, "pedido"],
  ])("%s escolhido: Desconectar age sobre a conexão dele, e Atualizar sobre ele", (_kind, node, name) => {
    const buttons = toolbarFor(onConnection(node, "connected"), { canCollapse: true });

    expect(disabledIds(buttons)).toEqual(["connect"]);
    expect(byId(buttons, "disconnect").label).toBe("Desconectar MES Produção");
    expect(byId(buttons, "refresh").label).toBe(`Atualizar ${name}`);
  });

  it.each([
    ["visão", view],
    ["rotina", routine],
    ["coluna", column],
    ["índice", index],
    ["chave estrangeira", foreignKey],
  ])("%s escolhida: Desconectar age sobre a conexão dela; não há o que atualizar numa folha", (_kind, node) => {
    expect(disabledIds(toolbarFor(onConnection(node, "connected"), { canCollapse: true }))).toEqual(["connect", "refresh"]);
  });

  it("a linha de erro de uma conexão que falhou: Conectar tenta de novo", () => {
    expect(disabledIds(toolbarFor(onConnection(errorRow, "failed"), { canCollapse: true }))).toEqual(["disconnect", "refresh"]);
  });

  it("Recolher tudo só vale com algo aberto", () => {
    expect(byId(toolbarFor(nothing, { canCollapse: false }), "collapseAll").disabled).toBe(true);
    expect(byId(toolbarFor(nothing, { canCollapse: true }), "collapseAll").disabled).toBe(false);
  });

  it("a dica de cada botão é o nome dele; a de esconder leva o atalho", () => {
    const buttons = toolbarFor(onConnection(connectionNode, "disconnected"), { canCollapse: true }, "Ctrl+B");

    for (const button of buttons.filter((candidate) => candidate.id !== "hide")) expect(button.title).toBe(button.label);
    expect(byId(buttons, "hide").title).toBe("Esconder o navegador (Ctrl+B)");
    expect(byId(buttons, "hide").label).toBe("Esconder o navegador");
  });
});

describe("selectionConnectionId: a conexão a que o item escolhido pertence", () => {
  it("a conexão, o banco, o esquema, o grupo e a tabela a trazem na própria chave", () => {
    expect([connectionNode, databaseNode, schemaNode, group, table].map(selectionConnectionId)).toEqual(Array(5).fill("c1"));
  });

  it("as folhas (visão, rotina, coluna, índice, chave estrangeira) e as linhas de aviso a tiram do pai", () => {
    expect([view, routine, column, index, foreignKey, loadingRow, errorRow].map(selectionConnectionId)).toEqual(Array(7).fill("c1"));
  });

  it("nome com '#' no esquema não confunde o corte da chave da folha", () => {
    const [odd] = objectNodes("c9", "a#b", "routines", [{ name: "f#1", kind: "function" }]);

    expect(selectionConnectionId(odd)).toBe("c9");
  });

  it("a pasta, e nada escolhido, não são de conexão nenhuma", () => {
    expect(selectionConnectionId(folderNode)).toBeNull();
    expect(selectionConnectionId(null)).toBeNull();
  });
});

describe("targetFolderId: onde Nova pasta e Nova conexão criam", () => {
  const connections = [mes, { ...mes, id: "c2", folderID: null }];

  it("na pasta escolhida", () => {
    expect(targetFolderId(folderNode, connections)).toBe("f1");
  });

  it("na pasta do item escolhido: a da conexão dele, em qualquer profundidade", () => {
    expect(targetFolderId(connectionNode, connections)).toBe("f1");
    expect(targetFolderId(table, connections)).toBe("f1");
    expect(targetFolderId(column, connections)).toBe("f1");
  });

  it("na raiz: sem nada escolhido, ou com um item de uma conexão que está na raiz (ou que saiu da lista)", () => {
    const [atRoot] = databaseNodes("c2", [{ name: "outro", isCurrent: true }]);
    const [gone] = databaseNodes("c404", [{ name: "sumiu", isCurrent: true }]);

    expect(targetFolderId(null, connections)).toBeNull();
    expect(targetFolderId(atRoot, connections)).toBeNull();
    expect(targetFolderId(gone, connections)).toBeNull();
  });
});

describe("isRefreshable: onde 'Atualizar' tem o que buscar de novo", () => {
  it("o banco, o esquema, o grupo e a tabela, sempre: guardam uma lista buscada", () => {
    for (const node of [databaseNode, schemaNode, group, table]) expect(isRefreshable(node, false)).toBe(true);
  });

  it("a conexão, só conectada", () => {
    expect(isRefreshable(connectionNode, true)).toBe(true);
    expect(isRefreshable(connectionNode, false)).toBe(false);
  });

  it("a pasta, as folhas e as linhas de aviso, nunca", () => {
    for (const node of [folderNode, view, routine, column, index, foreignKey, loadingRow, errorRow]) expect(isRefreshable(node, true)).toBe(false);
  });
});
