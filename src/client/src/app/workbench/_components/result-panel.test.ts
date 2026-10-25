import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { RowsState, RunnerState } from "../_lib/use-query-runner";
import type { PaneMode } from "../_lib/result-layout";
import { ResultActions } from "./result-actions";
import { collapsedSummary, ResultPanel } from "./result-panel";

// A área de resultado lê as preferências da grade (o tipo no cabeçalho, o zoom); aqui valem as de saída.
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

const noop = () => {};
const render = (state: RunnerState) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop })));

describe("a área de resultado com o driver do banco não instalado (item G, RN-DRIVER-006)", () => {
  const driverMissing: RunnerState = { status: "error", source: "driver", title: "Driver não instalado", message: "O driver do IBM Data Server não está instalado.", sqlState: null, errorAt: null };

  it("mostra a frase da API e oferece 'Instalar driver', que leva à tela de Drivers", () => {
    const markup = render(driverMissing);

    expect(markup).toContain("Driver não instalado");
    expect(markup).toContain("O driver do IBM Data Server não está instalado.");
    expect(markup).toMatch(/<a [^>]*href="\/drivers"[^>]*>Instalar driver<\/a>/);
  });

  it("com o `driverID` que a API deu, o link leva à tela de Drivers apontando a linha do driver", () => {
    const markup = render({ ...driverMissing, driverID: "ibm-data-server" } as RunnerState);

    expect(markup).toMatch(/<a [^>]*href="\/drivers\?driver=ibm-data-server"[^>]*>Instalar driver<\/a>/);
  });

  it("o erro da conexão com o banco e o erro de SQL não oferecem o caminho", () => {
    const connection: RunnerState = { status: "error", source: "connection", title: "Erro do banco", message: "FATAL: senha errada", sqlState: null, errorAt: null };
    const database: RunnerState = { status: "error", source: "database", title: "Erro do banco", message: "syntax error", sqlState: "42601", errorAt: null };

    expect(render(connection)).not.toContain("Instalar driver");
    expect(render(database)).not.toContain("Instalar driver");
  });
});

const rowsState: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select 1", offset: 0 },
  columns: [{ name: "id", type: "int4", kind: "number" }],
  rows: [["1"], ["2"]],
  truncated: new Map(),
  hasMore: true,
  totalRows: null,
  elapsedMs: 42,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
};

describe("collapsedSummary: o que a barra diz com a área recolhida (RN-PAINEL-001)", () => {
  it("as linhas e o tempo; com o total contado, o total junto", () => {
    expect(collapsedSummary(rowsState)).toBe("Primeiras 2 linhas · 42 ms");
    expect(collapsedSummary({ ...rowsState, total: 1000 })).toBe("Primeiras 2 linhas · 42 ms · Total: 1.000 linhas");
  });

  it("as linhas afetadas, o cancelamento e a frase de 'nada enviado'", () => {
    expect(collapsedSummary({ status: "affected", rowsAffected: 3, elapsedMs: 5 })).toBe("3 linhas afetadas · 5 ms");
    expect(collapsedSummary({ status: "cancelled" })).toBe("Comando cancelado.");
    expect(collapsedSummary({ status: "notice", message: "A seleção tem 2 comandos." })).toBe("A seleção tem 2 comandos.");
  });

  it("o erro do banco, com o SQLSTATE quando há", () => {
    const error: RunnerState = { status: "error", source: "database", title: "Erro do banco", message: "syntax error", sqlState: "42601", errorAt: null };

    expect(collapsedSummary(error)).toBe("Erro do banco · SQLSTATE 42601");
    expect(collapsedSummary({ ...error, sqlState: null })).toBe("Erro do banco");
  });

  it("o comando em andamento vence o resultado que ainda está lá; sem comando nenhum, o texto de aba vazia", () => {
    expect(collapsedSummary({ status: "running", cancelling: false, previous: rowsState })).toBe("Executando…");
    expect(collapsedSummary({ status: "idle" })).toBe("Nenhum comando executado nesta aba.");
  });
});

describe("a área de resultado recolhida (RN-PAINEL-001)", () => {
  const renderPanel = (props: { collapsed?: boolean; mode?: PaneMode }) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ResultPanel, {
          state: rowsState,
          connected: true,
          onLoadMore: noop,
          onCount: noop,
          onRerun: noop,
          collapsed: props.collapsed,
          actions: createElement(ResultActions, { mode: props.mode ?? "split", onAction: noop }),
        }),
      ),
    );

  it("dividida, o corpo está à mostra: sem `inert`, e a barra traz o resumo e 'Contar total'", () => {
    const markup = renderPanel({});

    expect(markup).not.toContain("inert");
    expect(markup).toContain("Primeiras 2 linhas · 42 ms");
    expect(markup).toContain("Contar total");
  });

  it("recolhida, o corpo continua na página mas sem altura e fora do Tab (`inert`); a barra segue com o resumo", () => {
    const markup = renderPanel({ collapsed: true, mode: "collapsed" });

    expect(markup).toMatch(/<div inert="" class="[^"]*h-0[^"]*overflow-hidden/);
    expect(markup).toContain("Primeiras 2 linhas · 42 ms");
    // O botão de contar vive no corpo da barra só com a área à mostra.
    expect(markup).not.toContain("Contar total");
    expect(markup).toContain('aria-label="Restaurar a área de resultado"');
  });
});

describe("a dica do rodapé com a busca automática (RN-CONFIG-005)", () => {
  const renderWith = (autoLoadMore: boolean) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: rowsState, connected: true, autoLoadMore, onLoadMore: noop, onCount: noop, onRerun: noop })));

  it("ligada, diz que a página seguinte vem ao rolar até o fim; o botão segue lá, para quem quiser pedir", () => {
    const markup = renderWith(true);

    expect(markup).toContain("As próximas vêm ao rolar até o fim da grade");
    expect(markup).not.toContain("só são buscados quando você pedir");
    expect(markup).toContain("Carregar mais 200");
  });

  it("desligada, é a frase de sempre", () => {
    const markup = renderWith(false);

    expect(markup).toContain("só são buscados quando você pedir");
    expect(markup).not.toContain("vêm ao rolar");
  });
});

describe("ResultActions: os botões da barra", () => {
  const labels = (mode: PaneMode) => [...renderToStaticMarkup(createElement(ResultActions, { mode, onAction: noop })).matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);

  it("dividida: recolher e maximizar", () => {
    expect(labels("split")).toEqual(["Recolher a área de resultado", "Maximizar a área de resultado"]);
  });

  it("recolhida: restaurar e maximizar", () => {
    expect(labels("collapsed")).toEqual(["Restaurar a área de resultado", "Maximizar a área de resultado"]);
  });

  it("maximizada: recolher e restaurar", () => {
    expect(labels("maximized")).toEqual(["Recolher a área de resultado", "Restaurar a área de resultado"]);
  });
});

describe("a área de resultado na vista Registros de uma tabela (RN-TABELA-002)", () => {
  const records = { name: "mes.apontamento", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };
  const renderRecords = (state: RunnerState) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state, connected: true, records, onLoadMore: noop, onCount: noop, onRerun: noop })));

  it("o rótulo e o título são dos registros da tabela", () => {
    const markup = renderRecords(rowsState);

    expect(markup).toContain('aria-label="Registros de mes.apontamento"');
    expect(markup).toMatch(/<h2[^>]*>Registros<\/h2>/);
    expect(markup).not.toContain("Resultado da consulta");
  });

  it("com as linhas na tela: 'Atualizar' e, havendo mais, a dica e 'Carregar mais 200'", () => {
    const markup = renderRecords(rowsState);

    expect(markup).toContain("Atualizar");
    expect(markup).not.toContain("Cancelar");
    expect(markup).toContain("Linhas 1 a 2 carregadas.");
    expect(markup).toContain("Carregar mais 200");
  });

  it("com todas as linhas na tela, não oferece carregar mais nem a dica", () => {
    const markup = renderRecords({ ...rowsState, hasMore: false });

    expect(markup).toContain("Atualizar");
    expect(markup).not.toContain("Carregar mais 200");
    expect(markup).not.toContain("Linhas 1 a");
  });

  it("com linhas na tela, 'Exportar CSV' está à mão, e a dica diz quantas linhas saem e que as não carregadas não entram (RN-TABELA-006)", () => {
    const markup = renderRecords(rowsState);
    const button = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Exportar CSV<\/button>/.exec(markup)?.[0] ?? "";

    expect(button).not.toBe("");
    expect(button).not.toMatch(/\sdisabled=""/);
    expect(button).toContain('title="Exporta as 2 linhas carregadas. As que ainda não foram carregadas não entram no arquivo."');
    // A mesma dica para leitor de tela: o `title` sozinho nem sempre é lido.
    const describedBy = /aria-describedby="([^"]+)"/.exec(button)?.[1] ?? "";
    expect(describedBy).not.toBe("");
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toMatch(new RegExp(`id="${describedBy.replaceAll(":", "\\:")}" class="sr-only">Exporta as 2 linhas carregadas`));
  });

  it("lido tudo, a dica não fala em linhas que faltam", () => {
    const markup = renderRecords({ ...rowsState, hasMore: false });

    expect(markup).toContain('title="Exporta as 2 linhas."');
    expect(markup).not.toContain("não foram carregadas");
  });

  it("sem linhas na tela (nada carregado, erro, comando que não devolve linhas) não há o que exportar: o botão não aparece", () => {
    for (const state of [{ status: "idle" }, { status: "affected", rowsAffected: 3, elapsedMs: 4 }, { status: "error", source: "database", title: "Erro do banco", message: "x", sqlState: null, errorAt: null }] as RunnerState[]) {
      expect(renderRecords(state), state.status).not.toContain("Exportar CSV");
    }
  });

  it("enquanto algo roda sobre as linhas, a exportação espera (as linhas estão mudando)", () => {
    const markup = renderRecords({ status: "running", cancelling: false, previous: rowsState });
    const button = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Exportar CSV<\/button>/.exec(markup)?.[0] ?? "";

    expect(button).toMatch(/\sdisabled=""/);
  });

  it("a área de resultado de uma consulta não tem 'Exportar CSV': é da vista Registros", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: rowsState, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).not.toContain("Exportar CSV");
  });

  it("enquanto algo roda (comando, página ou contagem), o botão é 'Cancelar', e não 'Atualizar'", () => {
    for (const state of [{ status: "running", cancelling: false, previous: null }, { ...rowsState, loadingMore: true }, { ...rowsState, counting: true }] as RunnerState[]) {
      const markup = renderRecords(state);

      expect(markup).toContain("Cancelar");
      expect(markup).not.toContain("Atualizar");
    }
  });

  it("sem resultado ainda, a frase 'Executando…' ocupa a área e deixa o rodapé com 'Cancelar' no fim dela", () => {
    const markup = renderRecords({ status: "running", cancelling: false, previous: null });

    expect(markup).toMatch(/<p role="status" class="[^"]*flex-1[^"]*">Executando…<\/p>/);
    expect(markup.indexOf("Executando…")).toBeLessThan(markup.indexOf("Cancelar"));
  });

  it("'Cancelando…' desabilita o botão até o pedido chegar", () => {
    const markup = renderRecords({ status: "running", cancelling: true, previous: null });

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Cancelando…/);
  });

  it("sem nenhum registro carregado (os resultados foram descartados, por exemplo) diz isso e manda atualizar, sem pedir um comando", () => {
    const markup = renderRecords({ status: "idle" });

    expect(markup).toContain("Nenhum registro carregado.");
    expect(markup).toContain("Use Atualizar para carregar os registros.");
    expect(markup).not.toContain("Ctrl+Enter");
    expect(markup).not.toContain("Carregando os registros…");
    expect(markup).toContain("Atualizar");
  });

  it("enquanto o banco da conexão não chegou, nada foi pedido e 'Carregando os registros…' é a verdade", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { status: "idle" }, connected: false, records: { ...records, waiting: true }, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).toContain("Carregando os registros…");
    expect(markup).not.toContain("Nenhum registro carregado.");
  });

  it("a conexão que a pessoa desconectou: a área diz que está desconectada, e 'Atualizar' é o clique que conecta e carrega", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { status: "idle" }, connected: false, records: { ...records, disconnected: true }, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).toContain("A conexão está desconectada.");
    expect(markup).toContain("Use Atualizar para conectar e carregar os registros.");
    expect(markup).not.toContain("Nenhum registro carregado.");
    expect(markup).not.toContain("Carregando os registros…");
    expect(markup).toContain("Atualizar");
  });

  it("sem o banco da conexão a primeira carga ainda não pode começar: 'Carregando…' vale mais que 'desconectada'", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { status: "idle" }, connected: false, records: { ...records, waiting: true, disconnected: true }, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).toContain("Carregando os registros…");
    expect(markup).not.toContain("A conexão está desconectada.");
  });

  it("desconectar não apaga o que está na tela: com linhas, a grade fica e o aviso de desconexão não aparece", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: rowsState, connected: false, records: { ...records, disconnected: true }, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).not.toContain("A conexão está desconectada.");
    expect(markup).toContain("Linhas 1 a 2 carregadas.");
  });

  it("o erro do banco aparece na área, e 'Atualizar' segue à mão para tentar de novo", () => {
    const markup = renderRecords({ status: "error", source: "database", title: "Erro do banco", message: 'permission denied for table "apontamento"', sqlState: "42501", errorAt: null });

    expect(markup).toContain("Erro do banco");
    expect(markup).toContain("permission denied for table");
    expect(markup).toContain("42501");
    expect(markup).toContain("Atualizar");
  });

  it("o cursor fechado diz para atualizar, não para executar de novo", () => {
    const markup = renderRecords({ ...rowsState, cursorClosed: true });

    expect(markup).toContain("O cursor foi fechado. Atualize para continuar.");
    expect(markup).not.toContain("Executar de novo");
    expect(markup).not.toContain("Carregar mais 200");
  });

  it("fora da vista Registros (a aba de consulta) nada disso aparece", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: rowsState, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop })));

    expect(markup).toContain('aria-label="Resultado da consulta"');
    expect(markup).not.toContain("Atualizar");
  });
});

describe("a execução da atualização automática na área de resultado (RN-GRADE-014)", () => {
  const autoRunning: RunnerState = { status: "running", cancelling: false, previous: rowsState, auto: true };
  const renderWith = (state: RunnerState, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, ...extra })));

  it("não esmaece a grade nem diz \"Executando…\": a barra segue com o resumo do resultado que está lá", () => {
    const markup = renderWith(autoRunning);

    expect(markup).not.toContain("Executando…");
    // O esmaecido é a classe sozinha (`disabled:opacity-50` dos botões não conta).
    expect(markup).not.toMatch(/class="[^"]*(?<![\w:-])opacity-50/);
    expect(renderWith({ status: "running", cancelling: false, previous: rowsState })).toMatch(/class="[^"]*(?<![\w:-])opacity-50/);
    expect(markup).toContain("Primeiras 2 linhas · 42 ms");
    expect(markup).toContain('aria-busy="false"');
  });

  it("recolhida, a barra também segue com o resumo; o comando da pessoa continua sendo \"Executando…\"", () => {
    expect(collapsedSummary(autoRunning)).toBe("Primeiras 2 linhas · 42 ms");
    expect(collapsedSummary({ status: "running", cancelling: false, previous: rowsState })).toBe("Executando…");
  });

  it("não ocupa a área para a pessoa: nos Registros o botão segue \"Atualizar\" (e não \"Cancelar\"), e \"Exportar CSV\" segue habilitado", () => {
    const records = { name: "loja.pedidos", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };
    const markup = renderWith(autoRunning, { records });

    expect(markup).toContain("Atualizar");
    expect(markup).not.toContain("Cancelar");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Exportar CSV/);
    // O comando da pessoa, sim: "Cancelar" no lugar de "Atualizar", e a exportação desabilitada.
    const mine = renderWith({ status: "running", cancelling: false, previous: rowsState }, { records });
    expect(mine).toContain("Cancelar");
    expect(mine).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Exportar CSV/);
  });

  it("na aba de consulta, o controle entra na barra, antes do zoom, com a área aberta ou recolhida", () => {
    const control = createElement("span", { "data-controle": "" }, "relógio");

    for (const collapsed of [false, true]) {
      const markup = renderWith(rowsState, { autoRefresh: control, collapsed });
      expect(markup).toContain('data-controle=""');
      if (!collapsed) expect(markup.indexOf("relógio")).toBeLessThan(markup.indexOf("Diminuir"));
    }
  });

  it("nos Registros, o controle fica no rodapé, logo depois de \"Atualizar\" (ou de \"Cancelar\"), e não na barra", () => {
    const control = createElement("span", { "data-controle": "" }, "relógio");
    const records = { name: "loja.pedidos", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };

    for (const state of [rowsState, { status: "running", cancelling: false, previous: rowsState } as RunnerState]) {
      const markup = renderWith(state, { autoRefresh: control, records });
      const button = markup.indexOf(state.status === "rows" ? "Atualizar</button>" : "Cancelar</button>");
      expect(markup.match(/data-controle/g)).toHaveLength(1);
      expect(button).toBeGreaterThan(markup.indexOf("Diminuir"));
      expect(markup.indexOf("relógio")).toBeGreaterThan(button);
      expect(markup.indexOf("relógio")).toBeLessThan(markup.indexOf("Exportar CSV"));
    }
  });
});

describe("o \"Exportar…\" da área de resultado (RN-EXPORT-001)", () => {
  const records = { name: "estoque.pedido", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };
  const enabled = { blocker: null, onExport: noop };
  const panel = (props: Partial<Parameters<typeof ResultPanel>[0]>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { ...rowsState, read: true }, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, ...props })));

  it("nos Registros, no rodapé, logo depois de \"Exportar CSV\", com a dica dos Registros", () => {
    const markup = panel({ records, exporter: enabled });

    expect(markup.indexOf("Exportar CSV")).toBeGreaterThan(-1);
    expect(markup.indexOf("Exportar…")).toBeGreaterThan(markup.indexOf("Exportar CSV"));
    expect(markup).toContain('title="Exportar todas as linhas da tabela, com o filtro e a ordem da aba, em CSV ou outro formato"');
  });

  it("no resultado de um comando, na barra da área, antes de recolher e maximizar, também com a área recolhida", () => {
    const actions = createElement(ResultActions, { mode: "split", onAction: noop });
    const markup = panel({ exporter: enabled, actions });
    expect(markup).toContain('title="Exportar todas as linhas deste resultado, em CSV ou outro formato"');
    expect(markup.indexOf("Exportar…")).toBeLessThan(markup.indexOf("Recolher"));

    expect(panel({ exporter: enabled, actions, collapsed: true })).toContain("Exportar…");
  });

  it("sem resultado continua lá, desabilitado sem sair do Tab (`aria-disabled`), com o motivo na dica e para o leitor de tela", () => {
    const markup = panel({ state: { status: "idle" }, exporter: { blocker: "Não há resultado para exportar.", onExport: noop } });

    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*title="Não há resultado para exportar."/);
    expect(markup).toMatch(/<span id="[^"]+" class="sr-only">Não há resultado para exportar.<\/span>/);
  });
});

describe("o botão 'Onde mostrar o resultado' na barra (RN-ABAS-014)", () => {
  const withBar = (actions?: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { status: "idle" }, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, placeControl: createElement("span", { "data-place": "" }), actions })));

  it("vem logo antes dos botões do fim da barra (no painel, o recolher e o maximizar), e sem eles fica na ponta direita", () => {
    expect(withBar(createElement("span", { "data-actions": "" }))).toMatch(/<span data-place=""><\/span><span data-actions=""><\/span><\/div>/);
    expect(withBar()).toMatch(/<span data-place=""><\/span><\/div>/);
  });
});

describe("as medidas da barra da área de resultado (RN-ABAS-009, seção 39)", () => {
  const records = { name: "estoque.pedido", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };
  const exporter = { blocker: null, onExport: noop };
  const panel = (props: Partial<Parameters<typeof ResultPanel>[0]>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: { ...rowsState, read: true }, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, ...props })));
  const classOf = (markup: string, pattern: RegExp) => /class="([^"]*)"/.exec(pattern.exec(markup)?.[0] ?? "")?.[1].split(" ") ?? [];

  it("na aba de consulta, o título \"Resultado\" tem 28 px com a borda de 2 px e 8 px de cada lado, e os botões da barra, 24 px", () => {
    const markup = panel({ exporter, actions: createElement(ResultActions, { mode: "split", onAction: noop }) });

    expect(classOf(markup, /<h2[^>]*>/)).toEqual(expect.arrayContaining(["h-7", "px-2", "border-b-2"]));
    expect(classOf(markup, /<button[^>]*title="Exportar todas as linhas deste resultado[^"]*"[^>]*>/)).toContain("h-6");
    expect(classOf(markup, /<button[^>]*>Contar total<\/button>/)).toContain("h-6");
    expect(classOf(markup, /<button[^>]*aria-label="Diminuir o zoom da grade"[^>]*>/)).toContain("size-6");
    expect(classOf(markup, /<button[^>]*aria-label="Recolher a área de resultado"[^>]*>/)).toContain("size-6");
  });

  it("nos Registros, a barra e o rodapé ficam com as medidas de antes: o título de 36 px e os botões de 28 px", () => {
    const markup = panel({ records, exporter });

    expect(classOf(markup, /<h2[^>]*>/)).toEqual(expect.arrayContaining(["h-9", "px-2.5"]));
    expect(classOf(markup, /<button[^>]*aria-label="Diminuir o zoom da grade"[^>]*>/)).toContain("size-7");
    expect(classOf(markup, /<button[^>]*>Contar total<\/button>/)).toContain("h-7");
    expect(classOf(markup, /<button[^>]*title="Exportar todas as linhas da tabela[^"]*"[^>]*>/)).toContain("h-7");
  });
});
