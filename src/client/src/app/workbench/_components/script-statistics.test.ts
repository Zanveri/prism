import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As Estatísticas enquanto o script roda (RN-SQL-020), com os ganchos do React simulados (`createHookRuntime`): o vitest não tem DOM. O executor publica
// um script novo a cada comando; a tabela mostra o mais novo no máximo a cada 250 ms, e a pergunta de erro, o fim e um script novo, na hora. A tabela em
// si (as linhas em volta do comando em execução, os totais) está em `script-results.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { createScriptRun, finishRun, startEntry, withEntry, type ScriptRun } from "../_lib/script-run";
import { statisticsRefreshMs, useCoalescedRun } from "./script-statistics";

const commands = Array.from({ length: 100 }, (_, index) => ({ sql: `update cliente set nome = nome where id = ${index + 1}`, offset: index * 50 }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
});

describe("as Estatísticas de um script que roda (RN-SQL-020)", () => {
  it("o script novo aparece no máximo a cada 250 ms, e não a cada comando: o relógio conta da última troca", () => {
    let run: ScriptRun = startEntry(createScriptRun(1, commands), 0);
    const show = () => rt.render(() => useCoalescedRun(run));
    const first = run;
    expect(show()).toBe(first);

    // Dez comandos em 100 ms: a tabela fica como estava.
    for (let index = 1; index <= 10; index++) {
      run = startEntry(withEntry(run, index - 1, { status: "ok", affected: 1, elapsedMs: 10 }), index);
      vi.advanceTimersByTime(10);
      expect(show()).toBe(first);
    }

    // Um comando a cada 10 ms, sem parar, por mais 500 ms: a tabela muda duas vezes (aos 260 ms e aos 510 ms), e não a cada comando, nem só quando os
    // comandos dão um intervalo.
    const seen = new Set<ScriptRun>([first]);
    for (let index = 11; index <= 60; index++) {
      run = startEntry(withEntry(run, index - 1, { status: "ok", affected: 1, elapsedMs: 10 }), index);
      vi.advanceTimersByTime(10);
      seen.add(show());
    }
    expect(seen.size).toBe(3);

    vi.advanceTimersByTime(statisticsRefreshMs);
    expect(show()).toBe(run);
    // Sem comando novo, nada a esperar.
    vi.advanceTimersByTime(statisticsRefreshMs);
    expect(show()).toBe(run);
  });

  it("a pergunta de erro, o fim e um script novo aparecem na hora", () => {
    let run: ScriptRun = startEntry(createScriptRun(1, commands), 0);
    const show = () => rt.render(() => useCoalescedRun(run));
    show();

    run = { ...withEntry(run, 0, { status: "error", error: { title: "Erro do banco", message: "boom", sqlState: "42601" } }), phase: "paused" };
    expect(show()).toBe(run);

    run = startEntry(run, 1);
    show();
    run = finishRun(run, "cancelled", "cancelled");
    expect(show()).toBe(run);

    run = startEntry(createScriptRun(2, commands), 0);
    expect(show()).toBe(run);
  });
});
