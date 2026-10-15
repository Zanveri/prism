import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { elementsOf } from "@/lib/testing/react-tree";

import type { Connection } from "@/app/connections/_lib/connections.schema";

import { navKey, objectNodes, type NavNode } from "../_lib/navigator-model";
import { NavigatorRow, type NavigatorRowProps } from "./navigator-row";

const noop = () => {};

function render(node: NavNode, extra: Partial<NavigatorRowProps> = {}) {
  const props: NavigatorRowProps = { ...extra, node, index: 1, open: false, tabbable: false, selected: false, onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown: noop };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NavigatorRow, props)));
}

const error = (extra: Partial<NavNode> = {}): NavNode => ({ key: "k#error", kind: "error", label: "FATAL: senha errada", depth: 1, hasChildren: false, retryKey: "k", ...extra });

describe("a linha de erro da árvore (RN-ARVORE-005)", () => {
  it("mostra a mensagem e 'Tentar de novo', sem 'Instalar driver'", () => {
    const markup = render(error());

    expect(markup).toContain("FATAL: senha errada");
    expect(markup).toMatch(/<button[^>]*>Tentar de novo<\/button>/);
    expect(markup).not.toContain("Instalar driver");
  });

  it("driver não instalado: além de 'Tentar de novo', oferece 'Instalar driver', que leva à tela de Drivers (item G)", () => {
    const markup = render(error({ label: "O driver do IBM Data Server não está instalado.", errorCode: "DRIVER_NOT_INSTALLED" }));

    expect(markup).toContain("O driver do IBM Data Server não está instalado.");
    expect(markup).toMatch(/<button[^>]*>Tentar de novo<\/button>/);
    expect(markup).toMatch(/<a [^>]*href="\/drivers"[^>]*>Instalar driver<\/a>/);
  });

  it("com o driverID do 422 (seção 16), o link leva à tela de Drivers apontando a linha dele", () => {
    const markup = render(error({ errorCode: "DRIVER_NOT_INSTALLED", errorDriverID: "ibm-data-server" }));

    expect(markup).toMatch(/<a [^>]*href="\/drivers\?driver=ibm-data-server"[^>]*>Instalar driver<\/a>/);
  });

  it("o 'Instalar driver' entra no mesmo modelo de teclado do 'Tentar de novo': data-row-toggle (entra nas setas), o foco seleciona a linha e as teclas vão ao mesmo tratador", () => {
    const onSelect = vi.fn();
    const onKeyDown = vi.fn();
    const node = error({ errorCode: "DRIVER_NOT_INSTALLED" });
    const tree = NavigatorRow({ node, index: 4, open: false, tabbable: false, selected: false, onSelect, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown });
    const found = elementsOf(tree);
    const retry = found.find((element) => element.props["data-row-toggle"] === true && element.props.children === "Tentar de novo");
    const link = found.find((element) => element.type === InstallDriverLink);

    expect(retry).toBeDefined();
    expect(link?.props["data-row-toggle"]).toBe(true);

    (link?.props.onFocus as () => void)();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(node);

    const event = { key: "ArrowDown" };
    (link?.props.onKeyDown as (event: unknown) => void)(event);
    expect(onKeyDown).toHaveBeenCalledExactlyOnceWith(event, node, 4);
  });

  it("outro código da API não oferece o caminho", () => {
    expect(render(error({ errorCode: "DATABASE_CONNECTION_FAILED" }))).not.toContain("Instalar driver");
  });
});

describe("a linha de uma tabela ou visão (RN-TABELA-001)", () => {
  const [table] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);
  const [view] = objectNodes("c1", "public", "views", [{ name: "v_pedido", kind: "view" }]);
  const schema: NavNode = { key: navKey({ type: "schema", connectionId: "c1", schema: "public" }), kind: "schema", label: "public", depth: 2, hasChildren: true };

  function toggleButton(node: NavNode, handlers: Partial<NavigatorRowProps> = {}) {
    const props: NavigatorRowProps = { node, index: 0, open: false, tabbable: true, selected: false, onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown: noop, ...handlers };
    const button = elementsOf(NavigatorRow(props)).find((element) => element.props["data-row-toggle"] === true);
    if (button === undefined) throw new Error("A linha não tem o botão que alterna.");
    return button.props as { onClick: (event: unknown) => void; onDoubleClick?: () => void; title: string };
  }

  const nameClick = (detail: number) => ({ detail, target: { closest: () => null } });
  const chevronClick = (detail: number) => ({ detail, target: { closest: (selector: string) => (selector === "[data-chevron]" ? {} : null) } });

  it("o duplo clique na tabela e na visão abre a aba, com a linha que recebeu o clique", () => {
    for (const node of [table, view]) {
      const onOpenTable = vi.fn();

      toggleButton(node, { onOpenTable }).onDoubleClick?.();
      expect(onOpenTable).toHaveBeenCalledExactlyOnceWith(node);
    }
  });

  it("as demais linhas não reagem ao duplo clique", () => {
    expect(toggleButton(schema).onDoubleClick).toBeUndefined();
  });

  it("clicar no nome da tabela só seleciona; o chevron abre e fecha", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const button = toggleButton(table, { onSelect, onToggle });

    button.onClick(nameClick(1));
    button.onClick(nameClick(2));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();

    button.onClick(chevronClick(1));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(table);
  });

  it("o esquema abre no primeiro clique, e o segundo de um duplo clique não o fecha", () => {
    const onToggle = vi.fn();
    const button = toggleButton(schema, { onToggle });

    button.onClick(nameClick(1));
    button.onClick(nameClick(2));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith(schema);
  });

  it("a dica da linha diz o que o duplo clique faz, e só nas linhas que têm essa ação", () => {
    expect(toggleButton(table).title).toBe("pedido\nDuplo clique abre a aba da tabela");
    expect(toggleButton(view).title).toBe("v_pedido\nDuplo clique abre a aba da visão");
    expect(toggleButton(schema).title).toBe("public");
  });
});

describe("o destaque da busca na linha (RN-BUSCA-001)", () => {
  const [table] = objectNodes("c1", "public", "tables", [{ name: "pedido_item", kind: "table" }]);
  const withMatch = (match?: readonly [number, number]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NavigatorRow, { node: table, index: 0, open: false, tabbable: true, selected: false, match, onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown: noop })));

  it("o trecho que casou vai dentro de <mark>, e o resto do nome fica como está", () => {
    expect(withMatch([0, 3])).toContain("<mark");
    expect(withMatch([0, 3])).toMatch(/<mark[^>]*>ped<\/mark>ido_item/);
    expect(withMatch([7, 11])).toMatch(/pedido_<mark[^>]*>item<\/mark>/);
  });

  it("sem busca, o nome não tem destaque", () => {
    expect(withMatch()).not.toContain("<mark");
  });

  it("o nome do banco entra como texto: marcação dentro dele não vira elemento", () => {
    const hostile: NavNode = { ...table, label: "<b>ped</b>" };
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NavigatorRow, { node: hostile, index: 0, open: false, tabbable: true, selected: false, match: [3, 6], onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu: () => true, onKeyDown: noop })));

    expect(markup).toContain("&lt;b&gt;");
    expect(markup).not.toContain("<b>");
  });
});

describe("o botão direito na linha (RN-MENU-001)", () => {
  const [table] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);

  /** Faz o clique direito na linha desenhada; `opens` é o que o navegador responde ao pedido do menu. */
  function rightClick(opens: boolean) {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    const onContextMenu = vi.fn(() => opens);
    const props: NavigatorRowProps = { node: table, index: 0, open: false, tabbable: true, selected: false, onSelect: noop, onToggle: noop, onRetry: noop, onRefresh: noop, onNewQuery: noop, onDisconnect: noop, onOpenTable: noop, onContextMenu, onKeyDown: noop };
    const row = elementsOf(NavigatorRow(props))[0];

    (row.props.onContextMenu as (event: unknown) => void)({ preventDefault, clientX: 40, clientY: 90, currentTarget: { querySelector: () => ({ focus }) } });
    return { focus, preventDefault, onContextMenu };
  }

  it("pede o menu da linha no ponto do clique e não deixa abrir o menu do navegador", () => {
    const { preventDefault, onContextMenu } = rightClick(true);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onContextMenu).toHaveBeenCalledExactlyOnceWith(table, { x: 40, y: 90 });
  });

  it("a linha toma o foco quando o menu vai abrir: é para onde o foco volta quando ele fecha", () => {
    expect(rightClick(true).focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("o contextmenu que o navegador ignora (o da tecla de menu, com o menu do teclado já aberto) não tira o foco de quem o tem", () => {
    const { focus, preventDefault } = rightClick(false);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("a dica da linha da conexão (o que a lista da tela de Conexões mostrava, RN-NAV-003)", () => {
  const now = "2026-10-12T12:00:00Z";
  const connection: Connection = { id: "c1", folderID: null, name: "MES Produção", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", createdAt: now, updatedAt: now };
  const node: NavNode = { key: navKey({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES Produção", depth: 0, hasChildren: true };

  it("o nome e, embaixo, o banco e o endereço (host:porta / banco), que a lista de Conexões trazia em cada conexão e a árvore não mostra", () => {
    expect(render(node, { connection, status: "disconnected" })).toContain('title="MES Produção\nInformix · srv-ifx:9089 / mes"');
  });

  it("o endereço entra como texto, como veio", () => {
    expect(render(node, { connection: { ...connection, host: '"srv"<b>' }, status: "disconnected" })).toContain('title="MES Produção\nInformix · &quot;srv&quot;&lt;b&gt;:9089 / mes"');
  });
});

describe("a etiqueta do ambiente na árvore (RN-CONN-015 e RN-PASTA-005)", () => {
  const now = "2026-10-13T12:00:00Z";
  const fabrica = { id: "f1", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, createdAt: now, updatedAt: now };
  const connection: Connection = { id: "c1", folderID: "f1", name: "MES", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };
  const connectionNode: NavNode = { key: navKey({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES", depth: 1, hasChildren: true };
  const folderNode: NavNode = { key: navKey({ type: "folder", id: "f1" }), kind: "folder", label: "Fábrica", depth: 0, hasChildren: true };
  const pill = (markup: string) => /<span[^>]*style="background-color:#FF8A7A[^"]*"[^>]*>Produção<\/span>/.exec(markup)?.[0];

  it("a pasta com ambiente mostra a etiqueta ao lado do nome", () => {
    expect(pill(render(folderNode, { environment: { name: "Produção", color: "#FF8A7A", folder: null } }))).toBeDefined();
    expect(render(folderNode)).not.toContain("Produção");
  });

  it("a conexão sem ambiente próprio mostra o herdado, e a dica da etiqueta diz de qual pasta", () => {
    const markup = render(connectionNode, { connection, status: "disconnected", environment: { name: "Produção", color: "#FF8A7A", folder: fabrica } });

    expect(pill(markup)).toContain('title="Herdado da pasta Fábrica"');
  });

  it("o ambiente próprio da conexão aparece sem a dica de herdado", () => {
    const markup = render(connectionNode, { connection: { ...connection, environmentName: "Produção", environmentColor: "#FF8A7A" }, status: "disconnected", environment: { name: "Produção", color: "#FF8A7A", folder: null } });

    expect(pill(markup)).toBeDefined();
    expect(pill(markup)).not.toContain("title=");
  });
});

describe("a cor da pasta no ícone dela (RN-PASTA-007)", () => {
  const folderNode: NavNode = { key: navKey({ type: "folder", id: "f1" }), kind: "folder", label: "Fábrica", depth: 0, hasChildren: true };
  /** O `<span>` em volta do ícone da linha, com o estilo dele. */
  const iconSpan = (markup: string) => /<span[^>]*class="flex-none text-subtle[^"]*"[^>]*>\s*<svg/.exec(markup)?.[0] ?? "";

  it("pinta o ícone, aberta ou fechada, com a cor ajustada ao contraste do tema (light-dark), e o ícone continua o da pasta", () => {
    for (const open of [false, true]) {
      const markup = render(folderNode, { open, folderColor: "#F2B644" });

      expect(iconSpan(markup)).toMatch(/style="color:light-dark\(#[0-9A-F]{6}, #F2B644\)"/);
    }
  });

  it("sem cor, o ícone é o neutro de sempre", () => {
    expect(iconSpan(render(folderNode))).not.toContain("style=");
    expect(iconSpan(render(folderNode, { folderColor: null }))).not.toContain("style=");
  });

  it("a cor e o ambiente vão juntos: a cor no ícone, a etiqueta do ambiente ao lado do nome", () => {
    const markup = render(folderNode, { folderColor: "#7DB2FF", environment: { name: "Produção", color: "#FF8A7A", folder: null } });

    expect(iconSpan(markup)).toContain("#7DB2FF");
    expect(markup).toMatch(/<span[^>]*style="background-color:#FF8A7A[^"]*"[^>]*>Produção<\/span>/);
  });

  it("só a linha da pasta leva a cor: o esquema usa o mesmo desenho e fica neutro", () => {
    const schema: NavNode = { key: "s", kind: "schema", label: "public", depth: 1, hasChildren: true };

    expect(iconSpan(render(schema, { folderColor: "#7DB2FF" }))).not.toContain("style=");
  });
});

describe("a densidade do navegador na linha (RN-NAV-011)", () => {
  const now = "2026-10-15T12:00:00Z";
  const connection: Connection = { id: "c1", folderID: null, name: "MES", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", createdAt: now, updatedAt: now };
  const connectionNode: NavNode = { key: navKey({ type: "connection", connectionId: "c1" }), kind: "connection", label: "MES", depth: 0, hasChildren: true };
  const [table] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);
  const loading: NavNode = { key: "k#loading", kind: "loading", label: "Carregando…", depth: 2, hasChildren: false };
  const rowClass = (markup: string) => /^<div[^>]* class="([^"]*)"/.exec(markup)?.[1].split(" ") ?? [];
  const paddingOf = (markup: string) => Number(/padding-left:(\d+)px/.exec(markup)?.[1]);
  const actionSizes = (markup: string) => [...markup.matchAll(/<button type="button" aria-label="[^"]*" title="[^"]*" class="([^"]*)"/g)].map((match) => match[1].split(" ").filter((name) => name.startsWith("size-")));

  it("sem a escolha, a confortável, a do canvas: linha de 30 px, recuo de 10 px na raiz e 16 por nível, botões de ação de 24 px", () => {
    const markup = render(connectionNode, { connection, status: "connected" });

    expect(rowClass(markup)).toContain("h-[30px]");
    expect(paddingOf(markup)).toBe(10);
    expect(paddingOf(render(table))).toBe(10 + table.depth * 16);
    expect(actionSizes(markup)).toEqual([["size-6"], ["size-6"], ["size-6"]]);
  });

  it("a compacta: linha de 22 px, recuo de 6 px na raiz e 12 por nível, e os três botões de ação de 20 px, que cabem nela", () => {
    const markup = render(connectionNode, { connection, status: "connected", density: "compact" });

    expect(rowClass(markup)).toContain("h-[22px]");
    expect(rowClass(markup)).not.toContain("h-[30px]");
    expect(paddingOf(markup)).toBe(6);
    expect(paddingOf(render(table, { density: "compact" }))).toBe(6 + table.depth * 12);
    expect(actionSizes(markup)).toEqual([["size-5"], ["size-5"], ["size-5"]]);
    // O conteúdo se afasta dos três botões, no passo da compacta (22 px cada, e a folga da borda).
    expect(markup).toContain("--actions-width:74px");
  });

  it("na compacta a etiqueta do banco, a do ambiente e o ponto de estado continuam na linha", () => {
    const markup = render(connectionNode, { connection, status: "connected", density: "compact", environment: { name: "Produção", color: "#FF8A7A", folder: null } });

    expect(markup).toContain(">PG</span>");
    expect(markup).toContain(">Produção</span>");
    expect(markup).toContain('aria-label="Conectada"');
  });

  it("a linha de \"carregando\" tem a altura da densidade; a de erro, a que a mensagem pede", () => {
    expect(rowClass(render(loading))).toContain("h-[30px]");
    expect(rowClass(render(loading, { density: "compact" }))).toContain("h-[22px]");
    expect(rowClass(render(error(), { density: "compact" })).some((name) => name.startsWith("h-"))).toBe(false);
  });
});
