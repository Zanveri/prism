import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ColumnLink } from "../_lib/foreign-key-links";
import type { QueryColumn } from "../_lib/query.schema";
import type { RowsState, RunnerState } from "../_lib/use-query-runner";

// A grade de verdade é virtualizada e, sem DOM, não desenha linha nenhuma: aqui ela é trocada por uma que só anota o que recebeu. O que se confere é a LIGAÇÃO da
// área de resultado com a grade, que nenhum teste guardava: o que a vista Registros entrega (as chaves estrangeiras, o clique, o que pode virar link, a ordem)
// tem de chegar à grade, e o que só vale em certas horas (ordenar, buscar a página seguinte sozinha) só chega nelas.
const grid = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./result-grid", () => ({
  ResultGrid: (props: Record<string, unknown>) => {
    grid.props.push(props);
    return null;
  },
}));

// As preferências do usuário (RN-CONFIG-006): o que a área de resultado lê e entrega à grade.
const prefs = vi.hoisted(() => ({ results: { nullText: "NULL", autoLoadMore: false, showColumnTypes: true, gridZoom: 100 }, update: vi.fn() }));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: prefs, update: prefs.update }) }));

import { ResultPanel } from "./result-panel";

const noop = () => {};
const columns: QueryColumn[] = [{ name: "cliente_id", type: "integer", kind: "number" }];
const rows: RowsState = { status: "rows", id: 1, target: { sql: 'SELECT * FROM "loja"."pedidos"', offset: 0 }, columns, rows: [["4"], ["5"]], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 42, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };

const links: ReadonlyMap<number, ColumnLink> = new Map([[0, { table: { schema: "loja", name: "clientes" }, column: "id" }]]);
const onFollow = vi.fn();
const linkable = vi.fn(() => true);
const onLoadMore = vi.fn();
const records = { name: "loja.pedidos", onRefresh: noop, onCancel: noop, onExport: noop, links, onFollow, linkable, waiting: false, disconnected: false };

/** O que a grade recebeu da área de resultado, desenhada com este estado e estas propriedades. */
function gridProps(state: RunnerState, props: Partial<Parameters<typeof ResultPanel>[0]> = {}): Record<string, unknown> {
  grid.props.length = 0;
  renderToStaticMarkup(createElement(ResultPanel, { state, connected: true, onLoadMore, onCount: noop, onRerun: noop, ...props }));
  expect(grid.props).toHaveLength(1);
  return grid.props[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  prefs.results.showColumnTypes = true;
  prefs.results.gridZoom = 100;
});

describe("a área de resultado entrega à grade o que a vista Registros lhe deu (RN-TABELA-005 e 007)", () => {
  it("as chaves estrangeiras, o clique no valor e o que pode virar link chegam à grade como vieram", () => {
    const props = gridProps(rows, { records });

    expect(props.links).toBe(links);
    expect(props.onFollow).toBe(onFollow);
    // Sem isto a grade cai no padrão dela (o que cabe numa linha de filtro), e não na regra do banco da conexão (`sqlLiteral`).
    expect(props.linkable).toBe(linkable);
  });

  it("RN-GRADE-021: a ordem não sai da vista para a grade: o botão de ordenar do cabeçalho é da edição (`editing.sort`), que diz quando ele vale", () => {
    const props = gridProps(rows, { records });

    expect(props).not.toHaveProperty("sort");
    expect(props).not.toHaveProperty("onSort");
  });

  it("no resultado de uma consulta não há chave, link nem ordem pelo cabeçalho", () => {
    const props = gridProps(rows);

    expect(props.links).toBeUndefined();
    expect(props.onFollow).toBeUndefined();
    expect(props.linkable).toBeUndefined();
  });

  it("as colunas, as linhas, os valores cortados e o texto do nulo são os do resultado e da preferência", () => {
    const props = gridProps(rows, { nullText: "(vazio)" });

    expect(props.columns).toBe(rows.columns);
    expect(props.rows).toBe(rows.rows);
    expect(props.truncated).toBe(rows.truncated);
    expect(props.nullText).toBe("(vazio)");
  });
});

describe("a busca automática da página seguinte só chega à grade quando está armada (RN-CONFIG-005)", () => {
  it("ligada, com sessão, mais linhas a ler e nada em andamento: a grade avisa o fim a `onLoadMore`", () => {
    expect(gridProps(rows, { autoLoadMore: true }).onReachEnd).toBe(onLoadMore);
  });

  it("desligada, sem sessão, sem mais linhas, com o cursor fechado ou com algo em andamento: a grade não avisa ninguém", () => {
    expect(gridProps(rows).onReachEnd).toBeUndefined();
    expect(gridProps(rows, { autoLoadMore: true, connected: false }).onReachEnd).toBeUndefined();
    expect(gridProps({ ...rows, hasMore: false }, { autoLoadMore: true }).onReachEnd).toBeUndefined();
    expect(gridProps({ ...rows, cursorClosed: true }, { autoLoadMore: true }).onReachEnd).toBeUndefined();
    expect(gridProps({ ...rows, loadingMore: true }, { autoLoadMore: true }).onReachEnd).toBeUndefined();
  });
});

describe("o tipo no cabeçalho chega à grade pela preferência do usuário, na hora (RN-CONFIG-006)", () => {
  it("ligado, a grade mostra o tipo; desligado, não; nas duas grades (a da consulta e a dos Registros)", () => {
    expect(gridProps(rows).showTypes).toBe(true);
    expect(gridProps(rows, { records }).showTypes).toBe(true);

    prefs.results.showColumnTypes = false;
    expect(gridProps(rows).showTypes).toBe(false);
    expect(gridProps(rows, { records }).showTypes).toBe(false);
  });
});

describe("o zoom da grade é a preferência do usuário, nas duas grades (RN-GRADE-010)", () => {
  /** A área desenhada: o texto da página. */
  const markupOf = (state: RunnerState, props: Partial<Parameters<typeof ResultPanel>[0]> = {}) => renderToStaticMarkup(createElement(ResultPanel, { state, connected: true, onLoadMore, onCount: noop, onRerun: noop, ...props }));

  it("a grade recebe o zoom gravado, e o Ctrl+roda dela muda a preferência (a mesma para as duas grades)", () => {
    prefs.results.gridZoom = 150;
    const props = gridProps(rows, { records });

    expect(props.zoom).toBe(150);
    (props.onZoom as (zoom: number) => void)(175);
    expect(prefs.update.mock.calls).toEqual([[{ results: { gridZoom: 175 } }]]);
    expect(gridProps(rows).zoom).toBe(150);
  });

  it("os controles ficam na barra do resultado, com o valor de agora, quando há grade; e o clique neles muda a preferência", () => {
    prefs.results.gridZoom = 125;
    // A barra é o que vem antes do corpo da área (onde a grade mora).
    const bar = markupOf(rows).split('class="flex min-h-0 flex-1 flex-col"')[0];

    expect(bar).toMatch(/<div role="group" aria-label="Zoom da grade"[\s\S]*?>125%<\/button>/);
  });

  it("sem grade (um erro, as linhas afetadas) e com a área recolhida, não há controles de zoom", () => {
    expect(markupOf({ status: "error", source: "database", title: "Erro do banco", message: "x", sqlState: null, errorAt: null })).not.toContain("Zoom da grade");
    expect(markupOf({ status: "affected", rowsAffected: 3, elapsedMs: 1 })).not.toContain("Zoom da grade");
    expect(markupOf(rows, { collapsed: true })).not.toContain("Zoom da grade");
  });

  it("enquanto outro comando roda por cima das linhas, a grade continua lá e o zoom também", () => {
    expect(markupOf({ status: "running", cancelling: false, previous: rows })).toContain("Zoom da grade");
  });
});
