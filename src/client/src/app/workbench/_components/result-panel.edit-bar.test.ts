import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GridEditing } from "../_lib/grid-editing";
import type { RowsState, RunnerState } from "../_lib/use-query-runner";

// A barra de edição na área de resultado (RN-EDIT-013): ONDE ela fica e QUANDO aparece. A grade de verdade é virtualizada e, sem DOM, não desenha nada: aqui
// ela é uma marca no lugar dela, e a barra é uma que anota o que recebeu e se desenha como uma barra com nome, para a posição se ler na marcação.
const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./result-grid", async () => {
  const { createElement: element } = await import("react");
  return { ResultGrid: () => element("div", { "data-grid": "" }) };
});
vi.mock("./edit-bar", async () => {
  const { createElement: element } = await import("react");
  return {
    EditBar: (props: Record<string, unknown>) => {
      captured.props.push(props);
      return element("div", { role: "toolbar", "aria-label": "Edição da grade" });
    },
  };
});
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

import { scriptRunCopy } from "../_lib/script-run.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { ResultPanel } from "./result-panel";

const copy = workbenchCopy.result;
const noop = () => {};
const bar = '<div role="toolbar" aria-label="Edição da grade">';

const rows: RowsState = { status: "rows", id: 1, target: { sql: "select * from loja.pedido", offset: 0 }, columns: [{ name: "id", type: "int4", kind: "number" }], rows: [["1"], ["2"]], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 42, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };
const records = { name: "loja.pedido", onRefresh: noop, onCancel: noop, sort: null, onSort: noop, onExport: noop, waiting: false, disconnected: false };
const onAction = vi.fn();
const buttons = [{ id: "edit" as const, label: "Editar célula", shortcut: { label: "F2", aria: "F2" }, title: "Editar célula (F2)", reason: null }];
const editing = { bar: { buttons, onAction } } as unknown as GridEditing;

const render = (state: RunnerState, props: Partial<Parameters<typeof ResultPanel>[0]> = {}) => renderToStaticMarkup(createElement(ResultPanel, { state, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, editing, ...props }));

beforeEach(() => {
  captured.props.length = 0;
});

describe("onde fica a barra de edição (RN-EDIT-013)", () => {
  it("nos Registros, no rodapé, logo depois de \"Exportar CSV\" e antes das linhas carregadas e do \"Carregar mais\"", () => {
    const markup = render(rows, { records });
    const at = markup.indexOf(bar);

    expect(at).toBeGreaterThan(markup.indexOf("data-grid"));
    expect(at).toBeGreaterThan(markup.indexOf(copy.exportCsv));
    expect(at).toBeLessThan(markup.indexOf(copy.loadedHint(2)));
    expect(at).toBeLessThan(markup.indexOf(copy.loadMore));
    expect(markup.split(bar)).toHaveLength(2);
  });

  it("no resultado de um comando, numa linha própria entre a grade e os rodapés dela (o \"Carregar mais\", o cursor fechado)", () => {
    const more = render(rows);
    const closed = render({ ...rows, cursorClosed: true });

    expect(more.indexOf(bar)).toBeGreaterThan(more.indexOf("data-grid"));
    expect(more.indexOf(bar)).toBeLessThan(more.indexOf(copy.loadMore));
    expect(closed.indexOf(bar)).toBeLessThan(closed.indexOf(copy.cursorClosed));
    // A linha dela, alinhada à esquerda, com a borda de cima dos rodapés.
    expect(more).toMatch(new RegExp(`<div class="flex flex-none items-center border-t border-border bg-panel px-3 py-1.5">${bar}`));
  });

  it("o resultado sem nenhuma linha tem grade, e a barra aparece; e também com outro comando rodando sobre as linhas (com os motivos da aba ocupada)", () => {
    expect(render({ ...rows, rows: [], hasMore: false })).toContain(bar);
    expect(render({ status: "running", cancelling: false, previous: rows })).toContain(bar);
  });

  it("sem grade na tela, não aparece: antes do primeiro resultado, executando sem resultado, nas linhas afetadas, no erro e nas Estatísticas do script", () => {
    expect(render({ status: "idle" })).not.toContain(bar);
    expect(render({ status: "running", cancelling: false, previous: null })).not.toContain(bar);
    expect(render({ status: "affected", rowsAffected: 3, elapsedMs: 5 } as RunnerState)).not.toContain(bar);
    expect(render({ status: "error", source: "database", title: "Erro do banco", message: "x", sqlState: "42601", errorAt: null })).not.toContain(bar);
    expect(render(rows, { statistics: { body: null, summary: "3 comandos" } })).not.toContain(bar);
  });

  it("só onde a grade tem a edição: sem ela não há barra", () => {
    expect(render(rows, { editing: undefined })).not.toContain(bar);
  });

  it("na aba guardada do script, que se edita (RN-SQL-023), a barra fica na linha própria, entre a grade e a nota com \"Executar este comando\"", () => {
    const markup = render(rows, { kept: { busy: false, onRunAlone: noop } });
    const at = markup.indexOf(bar);

    expect(at).toBeGreaterThan(markup.indexOf("data-grid"));
    expect(at).toBeLessThan(markup.indexOf(scriptRunCopy.kept.note));
    expect(at).toBeLessThan(markup.indexOf(scriptRunCopy.kept.runAlone));
    expect(markup.split(bar)).toHaveLength(2);
  });

  it("recolhida a área (RN-PAINEL-001), a barra vai junto com o corpo, que fica inerte", () => {
    const markup = render(rows, { collapsed: true });

    expect(markup).toContain(bar);
    expect(markup.lastIndexOf("inert", markup.indexOf(bar))).toBeGreaterThan(-1);
  });

  it("a barra recebe os botões e a ação da edição, e quem devolve o foco à grade depois do botão", () => {
    render(rows);

    expect(captured.props).toHaveLength(1);
    expect(captured.props[0]).toMatchObject({ buttons, onAction });
    expect(typeof captured.props[0].onDone).toBe("function");
  });
});
