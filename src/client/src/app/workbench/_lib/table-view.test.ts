import { describe, expect, it, vi } from "vitest";

import type { FilterRequest } from "./filter-handoff";
import { recordsRunPlan } from "./table-sql";
import type { RunnerState } from "./use-query-runner";
import { afterHandoff, applyRunPlan, canClear, clearRecords, handoffToTake, idleNotice, needsFirstRun, runRecords, settleHandoff, sortRecords, tableViews, tabForKey, takeHandoff, viewOf } from "./table-view";

const all = ["data", "structure", "diagram"] as const;

describe("tabForKey: as setas de uma lista de abas (o seletor de vistas, RN-TABELA-001, e a lista de seções, RN-TABELA-009)", () => {
  it("direita e esquerda andam uma vista e dão a volta nas pontas; é o padrão, a fileira de abas", () => {
    expect(tabForKey(all, "data", "ArrowRight")).toBe("structure");
    expect(tabForKey(all, "diagram", "ArrowRight")).toBe("data");
    expect(tabForKey(all, "data", "ArrowLeft")).toBe("diagram");
    expect(tabForKey(all, "structure", "ArrowLeft")).toBe("data");
    expect(tabForKey(all, "data", "ArrowRight", "horizontal")).toBe("structure");
  });

  it("Home e End vão à primeira e à última", () => {
    expect(tabForKey(all, "structure", "Home")).toBe("data");
    expect(tabForKey(all, "structure", "End")).toBe("diagram");
  });

  it("outra tecla, ou uma vista que o seletor não tem, não move nada", () => {
    expect(tabForKey(all, "data", "Enter")).toBeNull();
    expect(tabForKey(["data"], "diagram", "ArrowRight")).toBeNull();
  });

  it("na fileira, cima e baixo não movem nada: são das setas da outra orientação", () => {
    expect(tabForKey(all, "structure", "ArrowDown")).toBeNull();
    expect(tabForKey(all, "structure", "ArrowUp")).toBeNull();
  });

  describe("numa coluna (a lista lateral, `aria-orientation=\"vertical\"`)", () => {
    const sections = ["columns", "foreignKeys", "indexes", "ddl"] as const;

    it("baixo e cima andam uma entrada e dão a volta nas pontas", () => {
      expect(tabForKey(sections, "columns", "ArrowDown", "vertical")).toBe("foreignKeys");
      expect(tabForKey(sections, "indexes", "ArrowDown", "vertical")).toBe("ddl");
      expect(tabForKey(sections, "ddl", "ArrowDown", "vertical")).toBe("columns");
      expect(tabForKey(sections, "foreignKeys", "ArrowUp", "vertical")).toBe("columns");
      expect(tabForKey(sections, "columns", "ArrowUp", "vertical")).toBe("ddl");
    });

    it("Home e End vão à primeira e à última", () => {
      expect(tabForKey(sections, "indexes", "Home", "vertical")).toBe("columns");
      expect(tabForKey(sections, "indexes", "End", "vertical")).toBe("ddl");
    });

    it("esquerda e direita não movem nada, e outra tecla também não", () => {
      for (const key of ["ArrowLeft", "ArrowRight", "Enter", " ", "Tab", "a"]) expect(tabForKey(sections, "indexes", key, "vertical"), key).toBeNull();
    });

    it("uma entrada que a lista não tem, ou uma lista vazia, não move nada", () => {
      expect(tabForKey(sections, "outra" as never, "ArrowDown", "vertical")).toBeNull();
      expect(tabForKey([], "columns", "ArrowDown", "vertical")).toBeNull();
    });
  });
});

describe("viewOf: a vista que a aba mostra", () => {
  it("a pedida, quando a aba a oferece", () => {
    for (const view of tableViews) expect(viewOf(view)).toBe(view);
    expect(viewOf("diagram", all)).toBe("diagram");
  });

  it("uma que a aba não oferece cai nos registros", () => {
    expect(viewOf("diagram", ["data"])).toBe("data");
    expect(viewOf("structure", ["data"])).toBe("data");
  });
});

describe("needsFirstRun: quando a vista Registros executa sozinha (RN-TABELA-002, RN-SEG-001)", () => {
  const onScreen = { engine: 1 as const, visible: true, disconnected: false };
  const fresh: RunnerState = { status: "idle" };
  const rows: RunnerState = { status: "rows", id: 1, target: { sql: 'SELECT * FROM "producao"."apontamento"', offset: 0, engine: 1 }, columns: [], rows: [], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 2, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };

  it("a aba à vista, sem execução nenhuma e com o banco da conexão conhecido: executa", () => {
    expect(needsFirstRun(fresh, onScreen)).toBe(true);
  });

  it("depois do bloqueio, o executor é novo (sem resultado): a aba à vista recarrega sozinha, e a escondida espera ser aberta", () => {
    expect(needsFirstRun(fresh, onScreen)).toBe(true);
    expect(needsFirstRun(fresh, { ...onScreen, visible: false })).toBe(false);
  });

  it("a aba escondida não executa nada, nem na primeira carga: quando passa a estar à vista, executa", () => {
    expect(needsFirstRun(fresh, { ...onScreen, visible: false })).toBe(false);
    expect(needsFirstRun(fresh, { ...onScreen, visible: true })).toBe(true);
  });

  it("à vista ou escondida, com resultado na tela nada é refeito só por aparecer", () => {
    for (const visible of [true, false]) expect(needsFirstRun(rows, { ...onScreen, visible }), `visible ${visible}`).toBe(false);
  });

  it("sem o banco da conexão não se sabe escrever o nome da tabela, e nada é executado", () => {
    expect(needsFirstRun(fresh, { ...onScreen, engine: undefined })).toBe(false);
  });

  it("a conexão que a pessoa desconectou não é reaberta ao mostrar a aba: o clique é 'Atualizar'", () => {
    expect(needsFirstRun(fresh, { ...onScreen, disconnected: true })).toBe(false);
    expect(needsFirstRun(fresh, { ...onScreen, disconnected: false })).toBe(true);
  });

  it.each<RunnerState>([
    { status: "running", cancelling: false, previous: null },
    // As linhas que estão na tela, inclusive as de "carregar mais" (duas páginas lidas, o cursor ainda aberto): uma execução automática as perderia.
    rows,
    { status: "rows", id: 2, target: { sql: 'SELECT * FROM "producao"."apontamento"', offset: 0, engine: 1 }, columns: [], rows: [], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: true, total: null, counting: false },
    { status: "notice", message: "A seleção tem mais de um comando." },
    { status: "cancelled" },
    { status: "error", source: "database", title: "Erro do banco", message: "permission denied", sqlState: "42501", errorAt: null },
    { status: "affected", rowsAffected: 0, elapsedMs: 1 },
  ])("não executa de novo com a aba em %o", (state) => {
    expect(needsFirstRun(state, onScreen)).toBe(false);
  });
});

describe("handoffToTake: o filtro que outra aba pediu (RN-TABELA-007) vai ao campo quando a vista pode usá-lo", () => {
  const request: FilterRequest = { id: 3, where: '"id" = 7' };
  const free = { visible: true, busy: false, disconnected: false };

  it("sem pedido, nada a levar", () => {
    for (const visible of [true, false]) for (const busy of [true, false]) for (const disconnected of [true, false]) expect(handoffToTake(null, null, { visible, busy, disconnected })).toBeNull();
  });

  it("um pedido que ainda não foi levado, com a vista à vista e livre, é levado (o mesmo objeto)", () => {
    expect(handoffToTake(request, null, free)).toBe(request);
    expect(handoffToTake(request, 2, free)).toBe(request);
  });

  it("o pedido já levado não é levado de novo", () => {
    expect(handoffToTake(request, 3, free)).toBeNull();
  });

  it("com a vista escondida o pedido espera ser aberta, também ao desbloquear (RN-SEG-001)", () => {
    expect(handoffToTake(request, null, { ...free, visible: false })).toBeNull();
    expect(handoffToTake(request, null, free)).toBe(request);
  });

  it("com algo em andamento na aba o pedido espera: o executor recusaria o comando (RN-SESSAO-002), e o filtro ficaria na tela como aplicado sem ter sido enviado", () => {
    expect(handoffToTake(request, null, { ...free, busy: true })).toBeNull();
    // Livre de novo, o pedido que ficou na passagem é levado.
    expect(handoffToTake(request, null, free)).toBe(request);
  });

  it("com a conexão desconectada pela pessoa o pedido espera (E5): levado ao campo, o filtro e o comando apareceriam como aplicados sem nada ter sido enviado (RN-TABELA-005), porque nada reconecta sem o clique em 'Atualizar'", () => {
    expect(handoffToTake(request, null, { ...free, disconnected: true })).toBeNull();
    // Reconectada (o 'Atualizar' abriu a sessão da aba), o pedido que ainda está na passagem é levado, e aí é enviado.
    expect(handoffToTake(request, null, free)).toBe(request);
  });
});

describe("afterHandoff: o que se faz depois de levar o filtro ao campo", () => {
  const request: FilterRequest = { id: 3, where: '"id" = 7' };
  const rows: RunnerState = { status: "rows", id: 1, target: { sql: 'SELECT * FROM "producao"."apontamento"', offset: 0, engine: 1 }, columns: [], rows: [], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: true, total: null, counting: false };
  const idle: RunnerState = { status: "idle" };

  it("sem pedido, ou com um pedido que ainda não foi levado ao campo, nada se apaga nem se executa", () => {
    expect(afterHandoff(null, null, { state: rows })).toEqual({ clearId: null, execute: false });
    expect(afterHandoff(request, null, { state: rows })).toEqual({ clearId: null, execute: false });
    expect(afterHandoff(request, 2, { state: rows })).toEqual({ clearId: null, execute: false });
  });

  it("levado o pedido, ele sai da passagem; aba nova (sem resultado): quem executa é a primeira carga, que já usa o filtro", () => {
    expect(afterHandoff(request, 3, { state: idle })).toEqual({ clearId: 3, execute: false });
  });

  it("aba que já tinha resultado na tela (qualquer um): é o pedido que refaz a consulta", () => {
    const others: RunnerState[] = [
      rows,
      { status: "notice", message: "A seleção tem mais de um comando." },
      { status: "cancelled" },
      { status: "error", source: "database", title: "Erro do banco", message: "permission denied", sqlState: "42501", errorAt: null },
      { status: "affected", rowsAffected: 0, elapsedMs: 1 },
    ];

    for (const state of others) expect(afterHandoff(request, 3, { state }), state.status).toEqual({ clearId: 3, execute: true });
  });
});

/** Os estados em que a aba está ocupada (RN-SESSAO-002) e os em que está livre, para as decisões que olham o estado do executor. */
const loaded: RunnerState = { status: "rows", id: 1, target: { sql: 'SELECT * FROM "s"."t"', offset: 0, engine: 1 }, columns: [], rows: [], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };
const busyStates: RunnerState[] = [
  { status: "running", cancelling: false, previous: null },
  { status: "running", cancelling: false, previous: loaded },
  { ...loaded, loadingMore: true },
  { ...loaded, counting: true },
];
const freeStates: RunnerState[] = [{ status: "idle" }, loaded, { status: "cancelled" }, { status: "affected", rowsAffected: 0, elapsedMs: 1 }, { status: "error", source: "database", title: "Erro do banco", message: "permission denied", sqlState: "42501", errorAt: null }];

describe("applyRunPlan: o que a vista Registros faz com o plano de 'aplicar' e do clique no cabeçalho (RN-TABELA-005)", () => {
  const spies = () => ({ setProblem: vi.fn(), setFilter: vi.fn(), execute: vi.fn() });
  const next = 'ativo = 1 ORDER BY "c" DESC';

  it("enviar: o filtro entra como o em vigor (o comando à vista e a seta do cabeçalho) e vai ao executor, nesta ordem, uma vez cada", () => {
    const deps = spies();

    applyRunPlan({ kind: "send", filter: next, sql: 'SELECT * FROM "s"."t"\nWHERE ativo = 1 ORDER BY "c" DESC' }, deps);

    expect(deps.setFilter.mock.calls).toEqual([[next]]);
    expect(deps.execute.mock.calls).toEqual([[next]]);
    expect(deps.setFilter.mock.invocationCallOrder[0]).toBeLessThan(deps.execute.mock.invocationCallOrder[0]);
    expect(deps.setProblem).not.toHaveBeenCalled();
  });

  it("a aba ocupada: nada muda, porque o executor recusaria o comando; a seta, o comando à vista e o filtro em vigor ficam como estavam", () => {
    const deps = spies();

    applyRunPlan({ kind: "busy" }, deps);

    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.setProblem).not.toHaveBeenCalled();
  });

  it("mais de um comando: o campo diz o que há de errado, e nada entra como aplicado nem é enviado (a ordem do cabeçalho não aparece sem ter sido enviada)", () => {
    const deps = spies();

    applyRunPlan({ kind: "several" }, deps);

    expect(deps.setProblem.mock.calls).toEqual([["severalStatements"]]);
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("o plano de verdade (`recordsRunPlan`) leva o filtro como vai no comando (sem o `;` do fim): é ele que entra em vigor", () => {
    const deps = spies();

    applyRunPlan(recordsRunPlan(1, "s", "t", `  ${next} ; `, false), deps);

    expect(deps.setFilter.mock.calls).toEqual([[next]]);
    expect(deps.execute.mock.calls).toEqual([[next]]);
  });
});

describe("runRecords: o que 'aplicar' e 'atualizar' fazem, do estado do executor até o comando", () => {
  const spies = () => ({ setProblem: vi.fn(), setFilter: vi.fn(), execute: vi.fn() });
  const table = { engine: 1 as const, schema: "s", name: "t" };

  it.each(freeStates)("com a aba livre (%o) e um comando só: o filtro pedido entra em vigor e é enviado", (state) => {
    const deps = spies();
    const next = 'a = 1 ORDER BY "c" ASC';

    runRecords(table, next, state, deps);

    expect(deps.setFilter.mock.calls).toEqual([[next]]);
    expect(deps.execute.mock.calls).toEqual([[next]]);
  });

  it.each(busyStates)("com algo em andamento (%o) nada entra em vigor nem é enviado: o executor recusaria (RN-SESSAO-002)", (state) => {
    const deps = spies();

    runRecords(table, 'a = 1 ORDER BY "c" ASC', state, deps);

    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.setProblem).not.toHaveBeenCalled();
  });

  it("o filtro com mais de um comando: o campo avisa, e nada entra em vigor", () => {
    const deps = spies();

    runRecords(table, "a = 1; delete from t", { status: "idle" }, deps);

    expect(deps.setProblem.mock.calls).toEqual([["severalStatements"]]);
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
});

describe("sortRecords: o clique no cabeçalho escreve, troca ou tira o ORDER BY no texto do campo e o envia (RN-TABELA-010)", () => {
  const spies = () => ({ setProblem: vi.fn(), setFilter: vi.fn(), setDraft: vi.fn(), execute: vi.fn() });
  const table = { engine: 1 as const, schema: "s", name: "t" };
  const columns = [{ name: "id" }, { name: "is_active" }];

  /** O clique na coluna, com este texto no campo e este filtro em vigor (o mesmo, salvo aviso em contrário): o que foi ao campo, o que passou a valer e o que foi enviado. */
  function click(column: string, draft: string, filter = draft, state: RunnerState = loaded, engine: 1 | 2 | 3 = 1) {
    const deps = spies();
    sortRecords({ ...table, engine }, { draft, filter, column, columns }, state, deps);
    return deps;
  }
  /** O texto que o clique mandou: o mesmo no campo, no filtro em vigor e no executor. */
  const sent = (deps: ReturnType<typeof spies>) => {
    expect(deps.setDraft.mock.calls).toEqual(deps.execute.mock.calls);
    expect(deps.setFilter.mock.calls).toEqual(deps.execute.mock.calls);
    expect(deps.execute).toHaveBeenCalledOnce();
    return deps.execute.mock.calls[0][0] as string;
  };

  it("sobre um texto sem condição, o ciclo: crescente, decrescente, sem ordem (o SELECT puro)", () => {
    const ascending = sent(click("is_active", ""));
    const descending = sent(click("is_active", ascending));

    expect(ascending).toBe('ORDER BY "is_active" ASC');
    expect(descending).toBe('ORDER BY "is_active" DESC');
    expect(sent(click("is_active", descending))).toBe("");
  });

  it("sobre um texto com condição, o mesmo ciclo, e a condição fica como estava", () => {
    const ascending = sent(click("is_active", "id > 10"));
    const descending = sent(click("is_active", ascending));

    expect(ascending).toBe('id > 10 ORDER BY "is_active" ASC');
    expect(descending).toBe('id > 10 ORDER BY "is_active" DESC');
    expect(sent(click("is_active", descending))).toBe("id > 10");
  });

  it("outra coluna começa crescente", () => {
    expect(sent(click("id", 'id > 10 ORDER BY "is_active" DESC'))).toBe('id > 10 ORDER BY "id" ASC');
  });

  it("a condição digitada e ainda não aplicada vai junto: o campo é enviado inteiro", () => {
    expect(sent(click("is_active", "id > 10", ""))).toBe('id > 10 ORDER BY "is_active" ASC');
  });

  it("o ORDER BY digitado pela pessoa é trocado pelo do clique; de várias colunas, o ciclo começa do crescente", () => {
    expect(sent(click("is_active", "id > 10 order by id, is_active desc"))).toBe('id > 10 ORDER BY "is_active" ASC');
    // Digitado, de uma coluna só e aplicado: a seta já mostra o sentido, e o clique segue dele.
    expect(sent(click("is_active", "order by is_active"))).toBe('ORDER BY "is_active" DESC');
    expect(sent(click("is_active", "ORDER BY IS_ACTIVE DESC"))).toBe("");
  });

  it("o ciclo é o da ordem APLICADA (a da seta), e o texto trocado é o do CAMPO", () => {
    // Em vigor, crescente por `id`; no campo, a pessoa acrescentou uma condição e ainda não aplicou.
    expect(sent(click("id", 'id > 10 ORDER BY "id" ASC', 'ORDER BY "id" ASC'))).toBe('id > 10 ORDER BY "id" DESC');
    // No campo ela trocou o sentido à mão, sem aplicar: a seta ainda é a crescente, e o clique dá a decrescente.
    expect(sent(click("id", 'ORDER BY "id" DESC', 'ORDER BY "id" ASC'))).toBe('ORDER BY "id" DESC');
    // Nada em vigor, e uma ordem só digitada: o clique começa do crescente.
    expect(sent(click("id", 'ORDER BY "id" DESC', ""))).toBe('ORDER BY "id" ASC');
  });

  it("o `;` do fim do campo sai, e o campo passa a mostrar exatamente o que foi enviado", () => {
    expect(sent(click("id", "  is_active = true ;  "))).toBe('is_active = true ORDER BY "id" ASC');
  });

  it("enviado, o aviso do campo sai, e o filtro entra em vigor antes de ir ao executor", () => {
    const deps = click("id", "is_active = true");

    expect(deps.setProblem.mock.calls).toEqual([[null]]);
    expect(deps.setFilter.mock.invocationCallOrder[0]).toBeLessThan(deps.execute.mock.invocationCallOrder[0]);
  });

  it.each(busyStates)("com algo em andamento (%o) o clique não muda nada: nem o campo, nem o filtro em vigor, nem pedido ao executor", (state) => {
    const deps = click("id", "is_active = true", "is_active = true", state);

    for (const spy of Object.values(deps)) expect(spy).not.toHaveBeenCalled();
  });

  it("o campo com mais de um comando: só o aviso; a ordem não é escrita num texto que não foi enviado", () => {
    const deps = click("id", "is_active = true; delete from t", "");

    expect(deps.setProblem.mock.calls).toEqual([["severalStatements"]]);
    expect(deps.setDraft).not.toHaveBeenCalled();
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("o texto é lido pelas regras do banco da conexão", () => {
    // No Informix `{ ... }` é comentário: a ordem lá dentro não é a de fora.
    expect(sent(click("id", "is_active = 't' { order by id }", "", loaded, 3))).toBe(`is_active = 't' ORDER BY "id" ASC { order by id }`);
    // No PostgreSQL `$$ ... $$` é texto.
    expect(sent(click("id", "obs = $$ order by id $$", "", loaded, 1))).toBe('obs = $$ order by id $$ ORDER BY "id" ASC');
  });
});

describe("canClear e clearRecords: 'Limpar' vale com filtro ou ordem, aplicados ou só digitados, e limpa os dois de uma vez (RN-TABELA-010)", () => {
  const spies = () => ({ setProblem: vi.fn(), setFilter: vi.fn(), setDraft: vi.fn(), execute: vi.fn() });
  const table = { engine: 1 as const, schema: "s", name: "t" };

  it("habilitado com texto no campo OU com algo em vigor; sem os dois, não há o que limpar", () => {
    expect(canClear("", "")).toBe(false);
    expect(canClear("ativo = 1", "")).toBe(true);
    expect(canClear("   ", "")).toBe(true);
    expect(canClear("", "ativo = 1")).toBe(true);
    // O defeito: só a ordem do cabeçalho em vigor, e o botão ficava apagado.
    expect(canClear('ORDER BY "is_active" ASC', 'ORDER BY "is_active" ASC')).toBe(true);
    expect(canClear("", 'ORDER BY "is_active" ASC')).toBe(true);
  });

  it("só digitado (nada em vigor): esvazia o campo e o aviso dele, e não envia nada", () => {
    const deps = spies();

    clearRecords(table, "", loaded, deps);

    expect(deps.setDraft.mock.calls).toEqual([[""]]);
    expect(deps.setProblem.mock.calls).toEqual([[null]]);
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it.each(['ORDER BY "is_active" ASC', "ativo = 1", 'ativo = 1 ORDER BY "is_active" DESC'])("com `%s` em vigor: esvazia o campo e executa o SELECT puro, que passa a ser o que vale", (filter) => {
    for (const state of freeStates) {
      const deps = spies();

      clearRecords(table, filter, state, deps);

      expect(deps.setDraft.mock.calls, state.status).toEqual([[""]]);
      expect(deps.setProblem.mock.calls, state.status).toEqual([[null]]);
      expect(deps.setFilter.mock.calls, state.status).toEqual([[""]]);
      expect(deps.execute.mock.calls, state.status).toEqual([[""]]);
      expect(deps.setFilter.mock.invocationCallOrder[0]).toBeLessThan(deps.execute.mock.invocationCallOrder[0]);
    }
  });

  it.each(busyStates)("com algo em vigor e algo em andamento (%o): o campo esvazia, mas o que vale continua valendo, porque o executor recusaria o comando", (state) => {
    const deps = spies();

    clearRecords(table, 'ORDER BY "is_active" ASC', state, deps);

    expect(deps.setDraft.mock.calls).toEqual([[""]]);
    expect(deps.setProblem.mock.calls).toEqual([[null]]);
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("sem o banco da conexão (a lista de conexões ainda não chegou) o campo esvazia e nada é enviado: não há como montar o comando", () => {
    const deps = spies();

    clearRecords({ ...table, engine: undefined }, 'ORDER BY "is_active" ASC', loaded, deps);

    expect(deps.setDraft.mock.calls).toEqual([[""]]);
    expect(deps.setFilter).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
});

describe("takeHandoff: levar ao campo o filtro que outra aba pediu (RN-TABELA-007)", () => {
  const request: FilterRequest = { id: 3, where: '"id" = 7' };
  const spies = () => ({ setApplied: vi.fn(), setDraft: vi.fn(), setProblem: vi.fn(), setFilter: vi.fn() });
  const free = { visible: true, disconnected: false, state: loaded, filter: 'ativo = 1 ORDER BY "nome" DESC', engine: 1 as const };
  const untouched = (deps: ReturnType<typeof spies>) => Object.values(deps).every((spy) => spy.mock.calls.length === 0);

  it("a vista à vista, livre e conectada: o pedido fica marcado como levado, o aviso de erro do campo sai, e a condição pedida troca a que estava em vigor mantendo a ordem, no campo e no filtro em vigor", () => {
    const deps = spies();

    takeHandoff(request, null, free, deps);

    expect(deps.setApplied.mock.calls).toEqual([[3]]);
    expect(deps.setDraft.mock.calls).toEqual([['"id" = 7 ORDER BY "nome" DESC']]);
    expect(deps.setProblem.mock.calls).toEqual([[null]]);
    expect(deps.setFilter.mock.calls).toEqual([['"id" = 7 ORDER BY "nome" DESC']]);
  });

  it.each([
    ["sem nada em vigor", "", '"id" = 7'],
    ["só com condição em vigor", "ativo = 1", '"id" = 7'],
    ["só com ordem em vigor", 'ORDER BY "nome" ASC', '"id" = 7 ORDER BY "nome" ASC'],
    ["com uma ordem digitada, de várias colunas", "ativo = 1 order by nome, id desc -- nota", '"id" = 7 order by nome, id desc'],
    ["com a ordem só dentro de uma subconsulta", "id IN (SELECT id FROM t ORDER BY id)", '"id" = 7'],
  ])("%s: a condição pedida fica no lugar da que havia, e a ordem de fora continua", (_what, filter, text) => {
    const deps = spies();

    takeHandoff(request, null, { ...free, filter }, deps);

    expect(deps.setDraft.mock.calls).toEqual([[text]]);
    expect(deps.setFilter.mock.calls).toEqual([[text]]);
  });

  it("sem o banco da conexão ainda, o pedido é levado do mesmo jeito (o texto é lido como PostgreSQL)", () => {
    const deps = spies();

    takeHandoff(request, null, { ...free, engine: undefined }, deps);

    expect(deps.setFilter.mock.calls).toEqual([['"id" = 7 ORDER BY "nome" DESC']]);
  });

  it.each(busyStates)("com algo em andamento na aba (%o) nada vai ao campo: o filtro ficaria na tela como aplicado sem ter sido enviado", (state) => {
    const deps = spies();

    takeHandoff(request, null, { ...free, state }, deps);

    expect(untouched(deps)).toBe(true);
  });

  it("escondida, desconectada, sem pedido ou com o pedido já levado: nada muda", () => {
    const cases = {
      escondida: [request, null, { ...free, visible: false }],
      desconectada: [request, null, { ...free, disconnected: true }],
      "sem pedido": [null, null, free],
      "já levado": [request, 3, free],
    } as const;

    for (const [name, [asked, taken, context]] of Object.entries(cases)) {
      const deps = spies();

      takeHandoff(asked, taken, context, deps);

      expect(untouched(deps), name).toBe(true);
    }
  });
});

describe("settleHandoff: depois de levar o filtro ao campo, o pedido sai da passagem e a consulta se refaz", () => {
  const request: FilterRequest = { id: 3, where: '"id" = 7' };
  const spies = () => ({ clear: vi.fn(), execute: vi.fn() });

  it("aba que já tinha resultado: apaga o pedido atendido e executa a consulta com o filtro", () => {
    const deps = spies();

    settleHandoff(request, 3, loaded, deps);

    expect(deps.clear.mock.calls).toEqual([[3]]);
    expect(deps.execute).toHaveBeenCalledOnce();
  });

  it("aba nova (sem resultado): só apaga o pedido; quem executa é a primeira carga, que já sai com o filtro", () => {
    const deps = spies();

    settleHandoff(request, 3, { status: "idle" }, deps);

    expect(deps.clear.mock.calls).toEqual([[3]]);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("sem pedido, ou com um pedido que a vista ainda não levou: nada se apaga nem se executa", () => {
    const cases = [
      [null, null],
      [request, null],
      [request, 2],
    ] as const;

    for (const [asked, taken] of cases) {
      const deps = spies();

      settleHandoff(asked, taken, loaded, deps);

      expect(deps.clear).not.toHaveBeenCalled();
      expect(deps.execute).not.toHaveBeenCalled();
    }
  });
});

describe("idleNotice: o que a área de resultado diz enquanto a vista Registros não tem resultado", () => {
  const idle: RunnerState = { status: "idle" };

  it("a primeira carga está para começar: 'Carregando…'", () => {
    expect(idleNotice(idle, { engine: 1, disconnected: false })).toEqual({ waiting: true, disconnected: false });
  });

  it("a pessoa desconectou a conexão e nada foi carregado: 'desconectada', e não 'Carregando…'", () => {
    expect(idleNotice(idle, { engine: 1, disconnected: true })).toEqual({ waiting: false, disconnected: true });
  });

  it("sem o banco da conexão (a lista de conexões ainda não chegou) é 'Carregando…', também sobre uma conexão desconectada", () => {
    expect(idleNotice(idle, { engine: undefined, disconnected: false })).toEqual({ waiting: true, disconnected: false });
    expect(idleNotice(idle, { engine: undefined, disconnected: true })).toEqual({ waiting: true, disconnected: true });
  });

  it("com resultado, de qualquer tipo, nenhum dos dois avisos", () => {
    const others: RunnerState[] = [
      { status: "running", cancelling: false, previous: null },
      { status: "notice", message: "A seleção tem mais de um comando." },
      { status: "cancelled" },
      { status: "error", source: "database", title: "Erro do banco", message: "permission denied", sqlState: "42501", errorAt: null },
      { status: "affected", rowsAffected: 0, elapsedMs: 1 },
    ];

    for (const state of others) for (const disconnected of [true, false]) expect(idleNotice(state, { engine: 1, disconnected }), `${state.status} ${disconnected}`).toEqual({ waiting: false, disconnected: false });
  });
});
