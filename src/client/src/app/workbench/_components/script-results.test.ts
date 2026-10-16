import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { clickLabeled, elementsOf } from "@/lib/testing/react-tree";

import { createScriptRun, entryAt, finishRun, platformScriptShortcut, scriptResultCap, startEntry, statisticsWindow, withEntry, type ScriptRun } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import type { RowsState, RunnerState, RunTarget } from "../_lib/use-query-runner";
import { EditorToolbar } from "./editor-toolbar";
import { ResultPanel } from "./result-panel";
import { ScriptErrorDialog } from "./script-error-dialog";
import { ScriptStatistics } from "./script-statistics";
import { ScriptTabs } from "./script-tabs";

// A área de resultado lê as preferências da grade; aqui valem as de saída.
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

// As peças do "Executar script" na tela (seção 31, RN-SQL-019 a 022), como HTML estático (o vitest deste projeto não tem DOM): as abas, as Estatísticas,
// a aba guardada, a pergunta de erro e o botão da barra.
const copy = scriptRunCopy;
const noop = () => {};
const targets: RunTarget[] = [
  { sql: "-- os pedidos\nselect * from pedido", offset: 0 },
  { sql: "update pedido set status = 'paga' where id = 1", offset: 40 },
  { sql: "select * from cliente", offset: 90 },
];
const rows = (over: Partial<RowsState> = {}): RowsState => ({
  status: "rows",
  id: 3,
  target: targets[0],
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
  ...over,
});

function finished(): ScriptRun {
  let run = createScriptRun(1, targets);
  run = withEntry(run, 0, { status: "ok", rows: { read: 2, more: true, total: null }, elapsedMs: 42, kept: true });
  run = withEntry(run, 1, { status: "skipped", error: { title: "Erro do banco", message: 'ERROR: relation "pedido" is locked\nDETAIL: <tente de novo>', sqlState: "55P03" } });
  run = withEntry(run, 2, { status: "ok", affected: 7, elapsedMs: 8 });
  return { ...finishRun(run, "done"), results: [{ entry: 0, rows: rows() }] };
}

const workbenchLoadMore = "Carregar mais 200";
const markup = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, node));

describe("as abas do resultado do script (RN-SQL-020)", () => {
  const tabs = (shown: 0 | "statistics") => markup(createElement(ScriptTabs, { run: finished(), shown, idPrefix: "t", panelId: "t-panel", onChoose: noop }));

  it("uma lista de abas: uma por resultado guardado, com o número e o começo do comando, e as Estatísticas por último", () => {
    const html = tabs("statistics");

    expect(html).toMatch(/role="tablist" aria-label="Resultados do script"/);
    expect(html).toContain(">1 · select * from pedido</span>");
    expect(html).toContain(">Estatísticas</span>");
    expect(html.indexOf("1 · select")).toBeLessThan(html.indexOf("Estatísticas"));
    // O texto inteiro na dica, com o comentário de cima.
    expect(html).toContain('title="-- os pedidos\nselect * from pedido"');
  });

  it("só a escolhida entra no Tab, marcada, e todas controlam o corpo da área", () => {
    const html = tabs(0);

    expect(html).toMatch(/<button[^>]*id="t-0"[^>]*aria-selected="true"[^>]*aria-controls="t-panel"[^>]*tabindex="0"/);
    expect(html).toMatch(/<button[^>]*id="t-statistics"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  });
});

describe("as Estatísticas (RN-SQL-020)", () => {
  it("uma tabela com cabeçalho: o número, o comando, a situação, as linhas e o tempo de cada um", () => {
    const html = markup(createElement(ScriptStatistics, { run: finished() }));

    for (const header of ["Nº", "Comando", "Situação", "Linhas", "Tempo"]) expect(html).toMatch(new RegExp(`<th scope="col"[^>]*>${header}</th>`));
    expect(html.match(/<th scope="col"/g)).toHaveLength(5);
    expect(html).toContain(">primeiras 2 linhas</td>");
    expect(html).toContain(">7 linhas afetadas</td>");
    expect(html).toContain(">pulado</td>");
  });

  it("o erro vem na linha de baixo do comando, como veio, com o SQLSTATE; os totais vêm depois da tabela", () => {
    const html = markup(createElement(ScriptStatistics, { run: finished() }));

    expect(html).toContain("ERROR: relation &quot;pedido&quot; is locked\nDETAIL: &lt;tente de novo&gt;");
    expect(html).toContain("55P03");
    expect(html).toContain(copy.statistics.executed(2, 3));
    expect(html).toContain(copy.statistics.withErrors(1));
    expect(html).toContain(copy.statistics.changed(7));
    expect(html).toContain(copy.statistics.totalTime(50));
  });

  it("enquanto roda, marca a linha do comando em execução (o progresso é da barra, uma vez só); os resultados não guardados são contados", () => {
    const running = startEntry(withEntry(createScriptRun(2, targets), 0, { status: "ok", rows: { read: 200, more: true, total: null }, kept: false }), 1);
    const html = markup(createElement(ScriptStatistics, { run: running }));

    expect(html).not.toContain(`role="status"`);
    expect(html).toMatch(/<tr aria-current="step"[^>]*>.*?executando…/);
    expect(html).toContain(`primeiras 200 linhas · ${copy.statistics.notKept}`);
    expect(html).toContain(copy.statistics.dropped(1, scriptResultCap));
  });

  it("um script de 3.000 comandos: enquanto roda, só as linhas em volta do comando em execução, com quantos ficaram antes e depois; no fim, todas", () => {
    const size = 3_000;
    let run = createScriptRun(3, Array.from({ length: size }, (_, index) => ({ sql: `update cliente set nome = nome where id = ${index + 1}`, offset: index * 50 })));
    for (let index = 0; index < 2_000; index++) run = withEntry(run, index, { status: "ok", affected: 1, elapsedMs: 4 });
    const rowsOf = (html: string) => html.match(/<tr[ >]/g)!.length - 1;

    const running = markup(createElement(ScriptStatistics, { run: startEntry(run, 2_000) }));
    // As linhas dos comandos, mais as duas que dizem quantos ficaram de fora; o cabeçalho não conta.
    expect(rowsOf(running)).toBe(statisticsWindow + 2);
    expect(running).toContain(copy.statistics.before(1_995));
    expect(running).toContain(copy.statistics.after(size - 1_995 - statisticsWindow));
    expect(running).toMatch(/<tr aria-current="step"[^>]*><td[^>]*>2\.001<\/td>/);
    // Os totais são do script inteiro.
    expect(running).toContain(copy.statistics.executed(2_000, size));
    expect(running).toContain(copy.statistics.changed(2_000));

    const ended = markup(createElement(ScriptStatistics, { run: finishRun(startEntry(run, 2_000), "cancelled", "cancelled") }));
    expect(rowsOf(ended)).toBe(size);
    expect(ended).not.toContain(copy.statistics.before(1_995));
  });

  it("os textos das linhas de fora", () => {
    expect(copy.statistics.before(1)).toBe("1 comando antes destes, que aparecem quando o script terminar.");
    expect(copy.statistics.before(1_995)).toBe("1.995 comandos antes destes, que aparecem quando o script terminar.");
    expect(copy.statistics.after(955)).toBe("Mais 955 comandos na fila.");
  });
});

describe("a área de resultado do script (RN-SQL-020)", () => {
  const panel = (state: RunnerState, extra: Record<string, unknown>) =>
    markup(createElement(ResultPanel, { state, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, tabs: { list: createElement("div", { role: "tablist" }), panelId: "t-panel", labelledBy: "t-0" }, ...extra }));

  it("o corpo é o painel da aba escolhida, rotulado por ela, e o título 'Resultado' dá lugar às abas", () => {
    const html = panel(rows(), {});

    expect(html).toMatch(/role="tabpanel" id="t-panel" aria-labelledby="t-0"/);
    expect(html).not.toContain(">Resultado</h2>");
    expect(html).toContain("Contar total");
  });

  it("a área vazia ensina os dois jeitos de executar: o comando, e o script com o atalho da plataforma (RN-SQL-019)", () => {
    const html = markup(createElement(ResultPanel, { state: { status: "idle" }, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop }));

    expect(html).toContain(workbenchCopy.result.emptyHint(platformScriptShortcut));
    expect(workbenchCopy.result.emptyHint("Alt+X")).toBe("Ctrl+Enter executa o texto selecionado ou, sem seleção, o comando onde está o cursor. Alt+X executa os comandos da seleção ou do texto inteiro, um depois do outro.");
  });

  it("a aba guardada: as linhas, sem Contar total nem Carregar mais, e a nota com Executar este comando", () => {
    const html = panel(rows(), { connected: false, kept: { busy: false, onRunAlone: noop }, autoRefresh: createElement("span", null, "AUTO") });

    expect(html).toContain("Primeiras 2 linhas · 42 ms");
    // A nota cita os dois; os botões é que não estão.
    expect(html).not.toContain(">Contar total</button>");
    expect(html).not.toContain(`>${workbenchLoadMore}</button>`);
    expect(html).not.toContain("AUTO");
    expect(html).toContain(copy.kept.note);
    expect(html).toContain(copy.kept.runAlone);
    // Sem a edição, a grade é uma tabela só para leitura.
    expect(html).toContain('role="table"');
  });

  it("as Estatísticas tomam o corpo, entram no Tab, e a barra diz o comando em execução", () => {
    const html = panel({ status: "running", cancelling: false, previous: null }, { statistics: { body: createElement("p", null, "CORPO"), summary: "RESUMO" }, progress: copy.progress(2, 3) });

    expect(html).toMatch(/role="tabpanel"[^>]*tabindex="0"/);
    expect(html).toContain("CORPO");
    expect(html).toContain(copy.progress(2, 3));
    expect(html).not.toContain(">Executando…<");
    expect(html).toContain('aria-busy="true"');
  });

  it("recolhida, a barra diz o comando em execução, ou o resumo das Estatísticas", () => {
    const running = panel({ status: "running", cancelling: false, previous: null }, { collapsed: true, statistics: { body: null, summary: "RESUMO" }, progress: copy.progress(2, 3) });
    const done = panel({ status: "idle" }, { collapsed: true, statistics: { body: null, summary: "RESUMO" } });

    expect(running).toContain(copy.progress(2, 3));
    expect(done).toContain("RESUMO");
  });
});


describe("a pergunta de erro (RN-SQL-021)", () => {
  const entry = { ...entryAt(finished(), 1), status: "error" as const };

  it("mostra o comando e o erro como veio, e Parar é o padrão (o foco e o Esc); sem o X e sem o clique fora, que parariam o script calados", () => {
    const onChoose = vi.fn();
    const dialog = ScriptErrorDialog({ entry, number: 2, total: 3, onChoose });
    const found = elementsOf(dialog);
    const props = dialog.props as { title: string; role: string; dismissible: unknown; onClose: () => void };

    expect(props).toMatchObject({ title: copy.error.title(2, 3), role: "alertdialog", dismissible: "escape" });
    expect(found.some((element) => element.props.children === entry.target.sql)).toBe(true);
    expect(found.some((element) => element.props.children === entry.error!.message)).toBe(true);
    expect(found.find((element) => element.props.children === copy.error.stop)?.props.autoFocus).toBe(true);

    props.onClose();
    expect(onChoose).toHaveBeenLastCalledWith("stop");
  });

  it("cada botão leva a escolha dele", () => {
    const onChoose = vi.fn();
    const dialog = ScriptErrorDialog({ entry, number: 2, total: 3, onChoose });

    clickLabeled(dialog, copy.error.retry);
    clickLabeled(dialog, copy.error.skip);
    clickLabeled(dialog, copy.error.skipAll);
    clickLabeled(dialog, copy.error.stop);
    expect(onChoose.mock.calls.map(([choice]) => choice)).toEqual(["retry", "skip", "skipAll", "stop"]);
  });
});

describe("o botão Executar script na barra do editor (RN-SQL-019)", () => {
  const toolbar = (busy: boolean, runnable = true) => EditorToolbar({ busy, cancelling: false, runnable, onRun: noop, onRunScript: noop, scriptShortcut: { label: "Alt+X", aria: "Alt+X" }, onCancel: noop });

  it("fica ao lado de Executar, com o atalho escrito e anunciado, e se desabilita sem o que enviar", () => {
    const html = markup(toolbar(false));

    expect(html.indexOf(copy.editor.run)).toBeGreaterThan(html.indexOf(">Executar<"));
    expect(html).toContain('aria-keyshortcuts="Alt+X"');
    expect(html).toContain(">Alt+X</kbd>");
    expect(markup(toolbar(false, false))).toMatch(/<button[^>]*disabled=""[^>]*aria-keyshortcuts="Alt\+X"/);
  });

  it("com um comando ou um script rodando, os dois dão lugar a Cancelar", () => {
    const html = markup(toolbar(true));

    expect(html).not.toContain(copy.editor.run);
    expect(html).toContain("Cancelar");
  });
});
