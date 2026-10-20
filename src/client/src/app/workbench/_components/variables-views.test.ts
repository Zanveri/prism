import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { clickLabeled, elementsOf } from "@/lib/testing/react-tree";

import { createScriptRun, entryAt, finishRun, startEntry, withEntry } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import { sentSqlCopy } from "../_lib/sent-sql.copy";
import type { RunnerState, RunTarget, VariableErrorsState } from "../_lib/use-query-runner";
import { variableRunCopy } from "../_lib/variable-run.copy";
import type { BoundCommand } from "../_lib/variables/bind";
import { Random } from "../_lib/variables/random";
import { ScriptRun } from "../_lib/variables/run";
import { readScript } from "../_lib/variables/script";
import { collapsedSummary, ResultPanel, VariableErrorsView } from "./result-panel";
import { ScriptErrorDialog } from "./script-error-dialog";
import { sentSqlText, variableLabel } from "./sent-sql-dialog";
import { ScriptStatistics } from "./script-statistics";

vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

// As peças da execução com variáveis na tela (seção 41: RN-VAR-012, 018, 022 e 024), como HTML estático e árvore de elementos (o vitest deste projeto não tem DOM).
const markup = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, node));
const noop = () => {};

/** O comando trocado pelos marcadores, como o executor o monta: `@id` (number), `@status` (lista de 2) e `@nota` (texto com um caractere de controle, sem literal). */
const sent: BoundCommand = (() => {
  const model = readScript("const id = 7\nconst status = ['aberto', 'faturado']\nconst nota = 'a\\u0001b'\n\nselect * from pedido where id = @id and status in (@status) and nota = @nota", 1, { blankLines: true });
  const run = new ScriptRun(model, { engine: 1, random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1 });
  for (const item of model.items) if (item.parsed !== null) run.evaluate(item.index);
  const bound = run.bind(model.items.length - 1);
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.command;
})();

describe("a lista “Erros nas variáveis” (RN-VAR-012)", () => {
  const state: RunnerState = {
    status: "variableErrors",
    subject: "script",
    errors: [
      { line: 2, column: 1, message: "a é const e não pode receber outro valor (linha 1).", offset: 12 },
      { line: 5, column: 4, message: "Esperava o tipo depois de :.", offset: 60 },
    ],
  };
  const render = (onGoTo = noop) => createElement(ResultPanel, { state, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, onGoTo });

  it("mostra o título, e cada erro com a linha e a frase", () => {
    const html = markup(render());
    expect(html).toContain(variableRunCopy.errors.title);
    expect(html).toContain("Linha 2");
    expect(html).toContain("a é const e não pode receber outro valor (linha 1).");
    expect(html).toContain("Linha 5");
  });

  it("o clique leva o cursor ao lugar do erro", () => {
    const onGoTo = vi.fn();
    const found = elementsOf(VariableErrorsView({ state: state as VariableErrorsState, onGoTo }));
    const buttons = found.filter((element) => element.type === "button");
    (buttons[1].props.onClick as () => void)();
    expect(onGoTo).toHaveBeenCalledWith(60);
  });

  it("a barra recolhida diz quantos são", () => {
    expect(collapsedSummary(state)).toBe(`${variableRunCopy.errors.title} · 2`);
  });
});

describe("o “SQL enviado” (RN-VAR-018)", () => {
  it("a variável de um item de lista leva o índice: @status[1]", () => {
    expect(variableLabel("@status", 1)).toBe("@status[1]");
    expect(variableLabel("@id", null)).toBe("@id");
  });

  it("o que Copiar leva: a linha de comentário do valor sem literal, e o comando com os literais", () => {
    const text = sentSqlText(sent, 1);
    expect(text).toContain("select * from pedido where id = 7 and status in ('aberto', 'faturado') and nota = $4");
    expect(text.split("\n")[0]).toMatch(/^--/);
    expect(text.split("\n")[0]).toContain("$4");
  });

  it("o botão aparece só no resultado de um comando que levou variáveis, com a dica", () => {
    const rows = {
      status: "rows",
      id: 1,
      target: { sql: "select @id", offset: 0, engine: 1, sent },
      columns: [{ name: "id", type: "int4", kind: "number" }],
      rows: [["1"]],
      truncated: new Map(),
      hasMore: false,
      totalRows: null,
      elapsedMs: 3,
      pages: 1,
      loadingMore: false,
      cancelling: false,
      cursorClosed: false,
      total: null,
      counting: false,
    } as RunnerState;
    const withButton = markup(createElement(ResultPanel, { state: rows, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, onViewSent: noop }));
    expect(withButton).toContain(`aria-label="${sentSqlCopy.hint}"`);

    const plain = { ...rows, target: { sql: "select 1", offset: 0 } } as RunnerState;
    expect(markup(createElement(ResultPanel, { state: plain, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, onViewSent: noop }))).not.toContain(sentSqlCopy.hint);
  });
});

describe("as Estatísticas com declarações (RN-VAR-022)", () => {
  const targets: RunTarget[] = [
    { sql: "let total = 5", offset: 0 },
    { sql: "select @total", offset: 14, sent },
    { sql: "select 2", offset: 28 },
  ];
  const run = () => {
    let current = createScriptRun(1, targets, ["declaration", "statement", "statement"]);
    current = withEntry(startEntry(current, 0), 0, { status: "ok", elapsedMs: 3 });
    current = withEntry(startEntry(current, 1), 1, { status: "ok", rows: { read: 1, more: false, total: null }, elapsedMs: 10 });
    current = withEntry(startEntry(current, 2), 2, { status: "error", elapsedMs: 4, error: { title: "Erro", message: "falhou", sqlState: "42601" } });
    return finishRun(current, "done");
  };

  it("a declaração mostra “—” nas linhas, e os totais separam os comandos das declarações", () => {
    const html = markup(createElement(ScriptStatistics, { run: run(), onViewSent: noop }));
    expect(html).toContain("—");
    expect(html).toContain("Comandos executados: 1 de 2");
    expect(html).toContain("Declarações avaliadas: 1 de 1");
    expect(html).toContain("Com erro: 1");
  });

  it("o botão do SQL enviado está só na linha do comando que levou variáveis", () => {
    const html = markup(createElement(ScriptStatistics, { run: run(), onViewSent: noop }));
    expect(html.split(`aria-label="${sentSqlCopy.hint}"`)).toHaveLength(2);
  });

  it("o script sem declarações não mostra o total delas", () => {
    const plain = finishRun(createScriptRun(1, [{ sql: "select 1", offset: 0 }]), "done");
    expect(markup(createElement(ScriptStatistics, { run: plain }))).not.toContain("Declarações avaliadas");
  });
});

describe("a pergunta de erro de uma declaração (RN-VAR-022)", () => {
  const declaration = { ...entryAt(createScriptRun(1, [{ sql: "let total = (select 1)", offset: 0 }], ["declaration"]), 0), status: "error" as const, error: { title: "Erro", message: "A consulta falhou.", sqlState: null } };

  it("só Parar e Tentar de novo valem: Pular e Pular todos os erros ficam desabilitados, com o motivo", () => {
    const onChoose = vi.fn();
    const dialog = ScriptErrorDialog({ entry: declaration, number: 1, total: 2, onChoose });
    const found = elementsOf(dialog);

    expect((dialog.props as { title: string }).title).toBe(variableRunCopy.declarationTitle(1, 2));
    const skip = found.find((element) => element.props.children === scriptRunCopy.error.skip);
    const skipAll = found.find((element) => element.props.children === scriptRunCopy.error.skipAll);
    expect(skip?.props.disabled).toBe(true);
    expect(skipAll?.props.disabled).toBe(true);
    expect(skip?.props.title).toBe(variableRunCopy.skipDisabled("total"));
    expect(found.some((element) => element.props.children === variableRunCopy.skipDisabled("total"))).toBe(true);

    clickLabeled(dialog, scriptRunCopy.error.retry);
    expect(onChoose).toHaveBeenLastCalledWith("retry");
  });

  it("o comando que levou variáveis oferece “Ver o SQL enviado”", () => {
    const statement = { ...entryAt(createScriptRun(1, [{ sql: "select @id", offset: 0, sent }]), 0), status: "error" as const };
    const onViewSent = vi.fn();
    const dialog = ScriptErrorDialog({ entry: statement, number: 1, total: 1, onChoose: noop, onViewSent });
    clickLabeled(dialog, sentSqlCopy.view);
    expect(onViewSent).toHaveBeenCalledWith(statement.target);

    const skip = elementsOf(dialog).find((element) => element.props.children === scriptRunCopy.error.skip);
    expect(skip?.props.disabled).toBe(false);
  });
});
