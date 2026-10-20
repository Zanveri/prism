import { describe, expect, it } from "vitest";

import {
  commandHead,
  commandHint,
  createScriptRun,
  entriesOf,
  entryAt,
  finishRun,
  keptResultIds,
  scriptEndToast,
  scriptProgress,
  scriptShortcut,
  scriptShortcutLabel,
  scriptTabKeyTarget,
  scriptTabsOf,
  scriptTotals,
  shownScriptTab,
  startEntry,
  statisticsRange,
  statisticsSummary,
  statisticsWindow,
  withEntry,
  withSavedResult,
  type ScriptEntry,
  type ScriptRun,
} from "./script-run";
import { scriptRunCopy } from "./script-run.copy";
import type { RowsState } from "./use-query-runner";

const copy = scriptRunCopy;
const key = (over: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "x", code: "KeyX", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("o atalho do script (RN-SQL-019)", () => {
  it("Alt+X no Windows e no Linux, maiúsculo ou não", () => {
    expect(scriptShortcut(key({ altKey: true }), "Win32")).toBe(true);
    expect(scriptShortcut(key({ altKey: true, key: "X" }), "Linux x86_64")).toBe(true);
  });

  it("sem Alt, com Ctrl (o AltGr do Windows chega como Ctrl+Alt), com Shift ou com Meta não é o atalho", () => {
    expect(scriptShortcut(key({}), "Win32")).toBe(false);
    expect(scriptShortcut(key({ altKey: true, ctrlKey: true }), "Win32")).toBe(false);
    expect(scriptShortcut(key({ altKey: true, shiftKey: true }), "Win32")).toBe(false);
    expect(scriptShortcut(key({ altKey: true, metaKey: true }), "Linux x86_64")).toBe(false);
    expect(scriptShortcut(key({ altKey: true, key: "z", code: "KeyZ" }), "Win32")).toBe(false);
  });

  it("no macOS é Cmd+Option+X: o Option+X sozinho escreve um caractere, e fica com o editor", () => {
    expect(scriptShortcut(key({ altKey: true, metaKey: true, key: "≈" }), "MacIntel")).toBe(true);
    expect(scriptShortcut(key({ altKey: true, key: "≈" }), "MacIntel")).toBe(false);
    expect(scriptShortcut(key({ metaKey: true }), "MacIntel")).toBe(false);
  });

  it("a tecla vale pelo caractere e pela posição: no macOS o Option muda o caractere", () => {
    expect(scriptShortcut(key({ altKey: true, metaKey: true, key: "Dead", code: "KeyX" }), "MacIntel")).toBe(true);
    expect(scriptShortcut(key({ altKey: true, key: "x", code: "KeyB" }), "Win32")).toBe(true);
  });

  it("o botão escreve o atalho da plataforma, e o leitor de tela o ouve", () => {
    expect(scriptShortcutLabel("Win32")).toEqual({ label: "Alt+X", aria: "Alt+X" });
    expect(scriptShortcutLabel("MacIntel")).toEqual({ label: "Cmd+Option+X", aria: "Meta+Alt+X" });
  });
});

describe("o título das abas e a coluna das Estatísticas (RN-SQL-020)", () => {
  const pg = (sql: string) => ({ sql, engine: 1 as const });
  const db2 = (sql: string) => ({ sql, engine: 2 as const });
  const ifx = (sql: string) => ({ sql, engine: 3 as const });

  it("o começo do comando, numa linha, sem os comentários de cima, cortado com reticências", () => {
    expect(commandHead(pg("SELECT *\n  FROM pedido\n WHERE a = 1"))).toBe("SELECT * FROM pedido WHERE a = 1");
    expect(commandHead(pg("-- os pedidos abertos\n/* de hoje */\nSELECT * FROM pedido WHERE status = 'aberto' AND criado_em > now()"))).toBe("SELECT * FROM pedido WHERE stat…");
    expect(commandHead(ifx("{ Informix }\nselect 1"))).toBe("select 1");
    expect(commandHead(pg("select 1"), 4)).toBe("sel…");
  });

  it("os comentários são os do banco do comando, lidos pelo leitor do projeto: o aninhado no PostgreSQL e no Db2, o `{ … }` só no Informix", () => {
    // No PostgreSQL e no Db2 o comentário de bloco aceita outro dentro: só o fecho do de fora o encerra.
    expect(commandHead(pg("/* fora /* dentro */ ainda fora */ SELECT 1"))).toBe("SELECT 1");
    expect(commandHead(db2("/* fora /* dentro */ ainda fora */ SELECT 1 FROM SYSIBM.SYSDUMMY1"))).toBe("SELECT 1 FROM SYSIBM.SYSDUMMY1");
    // No Informix o primeiro fecho encerra, e o resto é texto do comando; o `{ … }` é comentário nele, e só nele.
    expect(commandHead(ifx("/* a /* b */ select 1"))).toBe("select 1");
    expect(commandHead(ifx("{ carga de hoje }\n-- e mais\nselect 1 from systables"))).toBe("select 1 from systables");
    expect(commandHead(pg("{ não é comentário } select 1"))).toBe("{ não é comentário } select 1");
    // No PostgreSQL o `--` acaba também no retorno de carro; no Informix, só na quebra de linha.
    expect(commandHead(pg("-- linha\rSELECT 2"))).toBe("SELECT 2");
    expect(commandHead(ifx("-- linha\rselect 2\nfrom t"))).toBe("from t");
  });

  it("sem o banco, vale o PostgreSQL, e só comentário fica como está", () => {
    expect(commandHead({ sql: "/* a /* b */ c */ select 1" })).toBe("select 1");
    expect(commandHead(pg("-- só isto"))).toBe("-- só isto");
  });

  it("a dica traz o texto inteiro, e um texto enorme vai cortado", () => {
    expect(commandHint("select 1")).toBe("select 1");
    expect(commandHint("x".repeat(5_000))).toHaveLength(2_001);
  });
});

const target = (sql: string) => ({ sql, offset: 0 });
const rows = { status: "rows" } as RowsState;

function run(over: Partial<ScriptRun> = {}): ScriptRun {
  return { ...createScriptRun(7, [target("select 1"), target("update t"), target("select 2")]), ...over };
}

describe("o estado do script", () => {
  it("começa com todos na fila; o que começa fica executando, sem o erro de antes", () => {
    const started = startEntry(withEntry(run(), 1, { status: "error", error: { title: "Erro", message: "x", sqlState: null } }), 1);

    expect(entriesOf(started).map((entry) => entry.status)).toEqual(["pending", "running", "pending"]);
    expect(entryAt(started, 1).error).toBeNull();
    expect(started).toMatchObject({ phase: "running", current: 1 });
  });

  it("no fim, os que não rodaram ficam como não executados, e o que rodava, como o fim diz", () => {
    const ended = finishRun(startEntry(run(), 1), "cancelled", "cancelled");

    expect(entriesOf(ended).map((entry) => entry.status)).toEqual(["notRun", "cancelled", "notRun"]);
    expect(ended).toMatchObject({ phase: "cancelled", current: null });
  });

  it("os totais: os que deram certo, os com erro, as linhas alteradas (sem o negativo do banco que não conta) e o tempo", () => {
    let current = withEntry(run(), 0, { status: "ok", rows: { read: 200, more: true, total: null }, elapsedMs: 40, kept: true });
    current = withEntry(current, 1, { status: "ok", affected: 12, elapsedMs: 10 });
    current = withEntry(current, 2, { status: "skipped", error: { title: "Erro", message: "x", sqlState: null } });
    expect(scriptTotals(current)).toEqual({ ok: 2, total: 3, errors: 1, changed: 12, returning: 0, elapsedMs: 50, dropped: 0 });

    expect(scriptTotals(withEntry(current, 1, { affected: -1 })).changed).toBe(0);
    expect(scriptTotals(withEntry(current, 0, { kept: false })).dropped).toBe(1);
  });

  it("o comando que gravou e devolveu linhas (RN-SQL-013) não soma nas linhas alteradas: a API diz quantas ele devolveu, e não quantas alterou; ele conta à parte", () => {
    let current = withEntry(run(), 0, { status: "ok", rows: { read: 3, more: false, total: 3 }, elapsedMs: 5, kept: true });
    current = withEntry(current, 1, { status: "ok", affected: 12, elapsedMs: 10 });

    expect(scriptTotals(current)).toMatchObject({ changed: 12, returning: 1 });
    expect(copy.statistics.changed(12, 1)).toBe("Linhas alteradas: 12 (sem contar 1 comando que gravou e devolveu linhas)");
    expect(copy.statistics.changed(1200, 2)).toBe("Linhas alteradas: 1.200 (sem contar 2 comandos que gravaram e devolveram linhas)");
    expect(copy.statistics.changed(12)).toBe("Linhas alteradas: 12");
  });

  it("o comando que fica com erro no fim (a rede de segurança) conta nos totais", () => {
    expect(scriptTotals(finishRun(startEntry(run(), 1), "stopped", "error"))).toMatchObject({ errors: 1, ok: 0 });
  });

  it("a barra diz o comando em execução, ou onde a pergunta espera; nada no fim", () => {
    expect(scriptProgress(startEntry(run(), 2))).toBe(copy.progress(3, 3));
    expect(scriptProgress({ ...startEntry(run(), 1), phase: "paused" })).toBe(copy.paused(2, 3));
    expect(scriptProgress(finishRun(run(), "done"))).toBeNull();
    expect(scriptProgress(null)).toBeNull();
  });
});

describe("um script de milhares de comandos (RN-SQL-020)", () => {
  const many = (size: number) => createScriptRun(1, Array.from({ length: size }, (_, index) => target(`update t set a = ${index}`)));

  it("mudar um comando copia só a página dele: as outras são as mesmas, e um script de 20.000 não é copiado inteiro a cada comando", () => {
    const before = many(20_000);
    const after = withEntry(before, 300, { status: "ok", affected: 1 });

    expect(after.pages.length).toBe(before.pages.length);
    expect(after.pages.filter((page, index) => page !== before.pages[index])).toHaveLength(1);
    expect(after.pages[1]).not.toBe(before.pages[1]);
    expect(entryAt(after, 300)).toMatchObject({ status: "ok", affected: 1, target: target("update t set a = 300") });
    expect(entryAt(before, 300).status).toBe("pending");
    expect(entriesOf(after).map((entry) => entry.target.sql)).toEqual(entriesOf(before).map((entry) => entry.target.sql));
  });

  it("os totais seguem cada mudança sem percorrer o script, e dão o mesmo que contar tudo de novo", () => {
    const recount = (current: ScriptRun) => {
      const entries = entriesOf(current);
      const is = (...statuses: ScriptEntry["status"][]) => entries.filter((entry) => statuses.includes(entry.status)).length;
      return {
        ok: is("ok"),
        total: entries.length,
        errors: is("error", "skipped"),
        changed: entries.reduce((sum, entry) => sum + (entry.affected !== null && entry.affected > 0 ? entry.affected : 0), 0),
        returning: entries.filter((entry) => entry.rows !== null && entry.rows.total !== null).length,
        elapsedMs: entries.reduce((sum, entry) => sum + (entry.elapsedMs ?? 0), 0),
        dropped: entries.filter((entry) => entry.kept === false).length,
      };
    };
    let current = many(600);
    for (let index = 0; index < 600; index += 7) {
      current = startEntry(current, index);
      current = withEntry(current, index, index % 3 === 0 ? { status: "ok", affected: index % 5 === 0 ? -1 : index, elapsedMs: 3 } : index % 3 === 1 ? { status: "error", error: { title: "Erro", message: null, sqlState: null }, elapsedMs: 2 } : { status: "ok", rows: { read: 1, more: false, total: index % 4 === 0 ? 1 : null }, kept: index <= 300, elapsedMs: 1 });
      // "Tentar de novo" e "Pular": o mesmo comando muda outra vez.
      if (index % 3 === 1) current = withEntry(startEntry(current, index), index, { status: "skipped", error: { title: "Erro", message: null, sqlState: null } });
    }
    const ended = finishRun(startEntry(current, 599), "cancelled", "cancelled");

    expect(scriptTotals(current)).toEqual(recount(current));
    expect(scriptTotals(ended)).toEqual(recount(ended));
    expect(scriptTotals(ended).ok).toBeGreaterThan(0);
  });

  it("enquanto roda, as Estatísticas desenham só os comandos em volta do que está em execução, com ele perto do alto; no fim, todos", () => {
    const size = 3_000;
    const running = startEntry(many(size), 2_000);

    expect(statisticsRange(running)).toEqual({ from: 1_995, to: 1_995 + statisticsWindow });
    expect(statisticsRange(startEntry(many(size), 2))).toEqual({ from: 0, to: statisticsWindow });
    expect(statisticsRange(startEntry(many(size), size - 1))).toEqual({ from: size - statisticsWindow, to: size });
    expect(statisticsRange({ ...startEntry(many(size), 2_000), phase: "paused" })).toEqual({ from: 1_995, to: 1_995 + statisticsWindow });
    expect(statisticsRange(many(size))).toEqual({ from: 0, to: statisticsWindow });
    expect(statisticsRange(startEntry(many(10), 9))).toEqual({ from: 0, to: 10 });
    expect(statisticsRange(finishRun(running, "cancelled"))).toEqual({ from: 0, to: size });
  });
});

describe("a aba à frente (RN-SQL-020)", () => {
  const results = [
    { entry: 0, rows },
    { entry: 2, rows },
  ];

  it("enquanto roda, as Estatísticas; no fim, a do último comando quando ele devolveu linhas", () => {
    expect(shownScriptTab(run({ results }), null)).toBe("statistics");
    expect(shownScriptTab(run({ results, phase: "done", live: 2 }), null)).toBe(2);
    expect(shownScriptTab(run({ results, phase: "done", live: null }), null)).toBe("statistics");
  });

  it("a que a pessoa escolheu fica, enquanto existe", () => {
    expect(shownScriptTab(run({ results, phase: "done", live: 2 }), 0)).toBe(0);
    expect(shownScriptTab(run({ results, phase: "done", live: 2 }), "statistics")).toBe("statistics");
    expect(shownScriptTab(run({ results, phase: "done", live: 2 }), 1)).toBe(2);
  });
});

describe("as abas que continuam se editando (seção 33, RN-SQL-023 e 024)", () => {
  const of = (resultId: string | null) => ({ status: "rows", resultId, rows: [["1"]] }) as RowsState;
  const results = [
    { entry: 0, rows: of("r0") },
    { entry: 1, rows: of(null) },
    { entry: 2, rows: of("r2") },
  ];

  it("o keep são os resultados das abas, menos a do último comando, que o comando seguinte substitui; sem script, nenhum", () => {
    expect(keptResultIds(null)).toEqual([]);
    // Enquanto roda não há aba do último: vão todas, a do comando anterior também. O resultado sem `resultID` (uma API antiga) não vai.
    expect(keptResultIds(run({ results }))).toEqual(["r0", "r2"]);
    expect(keptResultIds(run({ results, phase: "done", live: 2 }))).toEqual(["r0"]);
    expect(keptResultIds(run({ results: [], phase: "done", live: null }))).toEqual([]);
  });

  it("o Salvar de uma aba guardada troca as linhas dela, e só dela; o comando, as Estatísticas e a aba do último ficam", () => {
    const before = run({ results, phase: "done", live: 2 });

    const after = withSavedResult(before, "r0", { rows: [["9"]], cursorClosed: true });

    expect(after.results[0].rows).toEqual({ status: "rows", resultId: "r0", rows: [["9"]], cursorClosed: true });
    expect(after.results[0].entry).toBe(0);
    expect(after.results.slice(1)).toEqual(before.results.slice(1));
    expect(after.pages).toBe(before.pages);
    expect(after.totals).toBe(before.totals);
    // A aba do último desenha o executor, e não a cópia: um resultado que não é de aba guardada deixa o mesmo script.
    expect(withSavedResult(before, "r2", { rows: [] })).toBe(before);
    expect(withSavedResult(before, "outro", { rows: [] })).toBe(before);
  });
});

describe("a lista das abas, pelo teclado (RN-SQL-020)", () => {
  const tabs = scriptTabsOf(run({ results: [{ entry: 0, rows }, { entry: 2, rows }] }));

  it("uma aba por resultado guardado, pelo número do comando, e as Estatísticas por último", () => {
    expect(tabs).toEqual([0, 2, "statistics"]);
  });

  it("as setas andam e dão a volta; Home e End vão às pontas; outra tecla segue o caminho dela", () => {
    expect(scriptTabKeyTarget("ArrowRight", tabs, 0)).toBe(2);
    expect(scriptTabKeyTarget("ArrowRight", tabs, "statistics")).toBe(0);
    expect(scriptTabKeyTarget("ArrowLeft", tabs, 0)).toBe("statistics");
    expect(scriptTabKeyTarget("Home", tabs, "statistics")).toBe(0);
    expect(scriptTabKeyTarget("End", tabs, 0)).toBe("statistics");
    expect(scriptTabKeyTarget("Enter", tabs, 0)).toBeNull();
  });
});

describe("a barra recolhida sobre as Estatísticas", () => {
  it("o comando em execução; no fim, os totais", () => {
    expect(statisticsSummary(startEntry(run(), 0))).toBe(copy.progress(1, 3));
    const ended = finishRun(withEntry(withEntry(run(), 0, { status: "ok", elapsedMs: 30 }), 1, { status: "error" }), "stopped");
    expect(statisticsSummary(ended)).toBe(`${copy.statistics.executed(1, 3)} · ${copy.statistics.withErrors(1)} · ${copy.statistics.totalTime(30)}`);
  });
});

describe("o aviso do fim (RN-SQL-020)", () => {
  const ok = (current: ScriptRun, index: number) => withEntry(current, index, { status: "ok" });

  it("sucesso quando todos deram certo; atenção com erros pulados, parado ou cancelado; nada enquanto roda", () => {
    const all = ok(ok(ok(run(), 0), 1), 2);
    expect(scriptEndToast({ ...all, phase: "done" }, "consulta-1.sql")).toEqual({ tone: "success", message: copy.toasts.done("consulta-1.sql", 3) });
    expect(scriptEndToast({ ...withEntry(all, 1, { status: "skipped" }), phase: "done" }, "consulta-1.sql")).toEqual({ tone: "warning", message: copy.toasts.doneWithErrors("consulta-1.sql", 1, 2, 3) });
    expect(scriptEndToast({ ...ok(run(), 0), phase: "stopped" }, "consulta-1.sql")).toEqual({ tone: "warning", message: copy.toasts.stopped("consulta-1.sql", 1, 3) });
    expect(scriptEndToast({ ...ok(run(), 0), phase: "cancelled" }, "consulta-1.sql")).toEqual({ tone: "warning", message: copy.toasts.cancelled("consulta-1.sql", 1, 3) });
    expect(scriptEndToast(run(), "consulta-1.sql")).toBeNull();
  });

  it("os textos do fim dizem a aba: o script de uma aba que não está à vista também termina; sem o nome, não a dizem", () => {
    expect(copy.toasts.done("consulta-1.sql", 1)).toBe("Script executado na aba consulta-1.sql: 1 comando.");
    expect(copy.toasts.doneWithErrors("carga.sql", 2, 10, 12)).toBe("Script executado na aba carga.sql com 2 erros: 10 de 12 comandos executados.");
    expect(copy.toasts.stopped("carga.sql", 4, 12)).toBe("Script parado na aba carga.sql: 4 de 12 comandos executados.");
    expect(copy.toasts.cancelled("carga.sql", 4, 12)).toBe("Script cancelado na aba carga.sql: 4 de 12 comandos executados.");
    expect(scriptEndToast({ ...ok(run(), 0), phase: "stopped" })).toEqual({ tone: "warning", message: "Script parado: 1 de 3 comandos executados." });
  });
});
