import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";

import { navKey, objectNodes, type NavNode } from "../_lib/navigator-model";
import { NavigatorRow, type NavigatorRowProps } from "./navigator-row";

// A fonte de toda linha da árvore é a da interface (RN-CONFIG-008, seção 42), sem exceção por tipo de nó, por densidade, por busca ou por estado: a linha não escolhe
// a mono nem a do editor, e o que o `navigator-row.test.ts` confere nos nomes de objeto vale aqui para o resto das linhas e para as combinações.

const noop = () => {};
const now = "2026-10-27T12:00:00Z";
const connection: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: true, ...newVerification, protections: { ...unprotected, readOnly: true }, createdAt: now, updatedAt: now };

function render(node: NavNode, extra: Partial<NavigatorRowProps> = {}) {
  const props: NavigatorRowProps = { ...extra, node, index: 1, open: false, tabbable: false, selected: false, onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown: noop };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NavigatorRow, props)));
}

/** As classes de fonte que a linha escolhe, fora a etiqueta do banco (`PG`), que é mono do app por desenho (RN-CONFIG-008: as etiquetas continuam na mono). */
const monoClasses = (markup: string) =>
  [...markup.replace(/<span class="[^"]*">(PG|IFX|DB2)<\/span>/g, "").matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(" ")).filter((name) => name === "font-mono" || name === "font-editor");

const nodes: [string, NavNode, Partial<NavigatorRowProps>][] = [
  ["pasta", { key: navKey({ type: "folder", id: "f1" }), kind: "folder", label: "Fábrica", depth: 0, hasChildren: true }, {}],
  ["conexão", { key: navKey({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES Produção", depth: 1, hasChildren: true }, { connection, status: "connected", readOnly: "Somente leitura" }],
  ["carregando", { key: "k#loading", kind: "loading", label: "Carregando…", depth: 2, hasChildren: false }, {}],
  ["erro", { key: "k#error", kind: "error", label: "FATAL: senha errada", depth: 2, hasChildren: false, retryKey: "k" }, {}],
  ["tabela na busca (com destaque)", objectNodes("c1", "vendas", "tables", [{ name: "pedido", kind: "table" }])[0], { match: [0, 3] }],
];

describe("nenhuma linha da árvore escolhe a mono nem a do editor: a do <body> (a da interface) vale em todas", () => {
  it.each(nodes)("%s", (_name, node, extra) => {
    expect(monoClasses(render(node, extra))).toEqual([]);
  });

  it.each(["comfortable", "compact"] as const)("tabela com detalhe e selo, na densidade %s, aberta e selecionada: a mesma fonte", (density) => {
    const column: NavNode = { key: "c", kind: "column", label: "valor_total", depth: 5, hasChildren: false, detail: "numeric(12,2)", badge: "PK" };

    expect(monoClasses(render(column, { density, selected: true, open: true }))).toEqual([]);
  });
});
