import { describe, expect, it } from "vitest";

import type { ApiResult } from "@/lib/api/prism-api";

import type { Transfer } from "../data-export/transfers.schema";
import { cancelQuestionOf, createLoadTracker, failureDescription, loadEntryView, stayedText, type LoadTrackerDeps, type NewLoad, type TrackedLoad } from "./load-tracker";

const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const table = { connectionId: "c1", schema: "estoque", name: "pedido" };

const imported: NewLoad = { id, kind: "import", sourceName: "pedidos.csv", format: "csv", sheet: null, table, oneAtATime: false, empty: false, single: false };

const transfer = (change: Partial<Transfer> = {}): Transfer => ({
  id,
  kind: "import",
  connectionID: "c1",
  targetConnectionID: "c1",
  windowID: 1,
  state: "running",
  phase: "loading",
  rows: 0,
  committed: 0,
  total: null,
  bytes: 0,
  size: 1000,
  uncertain: false,
  summary: null,
  error: null,
  reason: null,
  ...change,
});

const entry = (change: Partial<TrackedLoad> = {}): TrackedLoad => ({ ...imported, seq: 1, stage: "running", phase: "loading", rows: 0, committed: 0, total: null, bytes: 0, size: 1000, failure: null, ...change });

const error = (change: Partial<NonNullable<Transfer["error"]>>) => ({ code: "IMPORT_VALUE_INVALID", message: "«12a» não é um número inteiro.", sqlState: null, line: null, column: null, side: "target" as const, committed: 0, uncertain: false, ...change });

function harness() {
  const timers: (() => void)[] = [];
  const answers: ApiResult<Transfer>[] = [];
  const forgets: (ApiResult<void> | Promise<ApiResult<void>>)[] = [];
  const toasts: { tone: string; title: string; description?: string; action?: string; run?: () => void }[] = [];
  const opened: unknown[] = [];
  const marked: unknown[] = [];
  const forgotten: string[] = [];
  let seq = 0;
  const deps: LoadTrackerDeps = {
    getTransfer: async () => answers.shift() ?? { ok: true, data: transfer() },
    forget: async (job) => {
      forgotten.push(job);
      return (await forgets.shift()) ?? { ok: true, data: undefined };
    },
    notify: {
      success: (title, description, action) => void toasts.push({ tone: "success", title, description, action: action?.label, run: action?.run }),
      warning: (title, description, action) => void toasts.push({ tone: "warning", title, description, action: action?.label, run: action?.run }),
      error: (title, description) => void toasts.push({ tone: "error", title, description }),
    },
    schedule: (run) => {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    openRecords: (target) => void opened.push(target),
    markImported: (target) => void marked.push(target),
    sequence: () => ++seq,
  };
  const tracker = createLoadTracker(deps);
  return {
    tracker,
    answers,
    forgets,
    toasts,
    opened,
    marked,
    forgotten,
    timers,
    tick: async () => {
      timers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("a barra de status da importação (RN-IMPORT-019)", () => {
  it("o texto pela fase: conectando, conferindo com a porcentagem dos bytes, esvaziando, a porcentagem com as linhas na dica, confirmando", () => {
    expect(loadEntryView(entry({ phase: "connecting" })).text).toBe("Importando pedidos.csv para pedido… conectando");
    const checking = loadEntryView(entry({ phase: "checking", bytes: 120 * 1024 * 1024, size: 260 * 1024 * 1024 }));
    expect(checking.text).toBe("Importando pedidos.csv para pedido… conferindo o arquivo, 46%");
    expect(checking.hint).toBe("Conferindo o arquivo antes de gravar: nada foi gravado ainda · 120 MB de 260 MB lidos");
    expect(loadEntryView(entry({ phase: "emptying" })).text).toBe("Importando pedidos.csv para pedido… esvaziando a tabela");
    const loading = loadEntryView(entry({ phase: "loading", rows: 12_345, committed: 10_000, bytes: 999, size: 1000 }));
    expect(loading).toMatchObject({ text: "Importando pedidos.csv para pedido… 99%", percent: 99 });
    expect(loading.hint).toBe("12.345 linhas gravadas, 10.000 confirmadas · 999 bytes de 1000 bytes lidos");
    expect(loadEntryView(entry({ phase: "loading", rows: 1, oneAtATime: true, bytes: 0, size: 10 })).hint).toBe("1 linha gravada · 0 bytes de 10 bytes lidos");
    expect(loadEntryView(entry({ phase: "committing" })).text).toBe("Importando pedidos.csv para pedido… confirmando");
    expect(loadEntryView(entry({ stage: "cancelling" }))).toMatchObject({ text: "Cancelando…", busy: true });
    expect(loadEntryView(entry({ stage: "lost" })).text).toBe("Não foi possível saber como está a importação.");
    expect(loadEntryView(entry({ stage: "failed" })).text).toBe("A importação para pedido parou.");
  });

  it("a cópia: contando, a porcentagem das linhas sobre o total, e sem total as linhas", () => {
    const copy = entry({ kind: "copy", sourceName: "pedido", table: { ...table, name: "pedido_hist" }, size: null });
    expect(loadEntryView({ ...copy, phase: "counting" }).text).toBe("Copiando pedido para pedido_hist… contando as linhas");
    expect(loadEntryView({ ...copy, rows: 5_678, total: 12_345, committed: 5_000 })).toMatchObject({ text: "Copiando pedido para pedido_hist… 45%", hint: "5.678 de 12.345 linhas · 5.000 confirmadas" });
    expect(loadEntryView({ ...copy, rows: 12_345, total: null, committed: 0 })).toMatchObject({ text: "Copiando pedido para pedido_hist… 12.345 linhas", percent: null });
  });
});

describe("o \"Cancelar\" que pergunta (RN-IMPORT-019)", () => {
  it("não pergunta quando nada ficaria: na conexão, na conferência, com \"Tudo numa transação só\" e antes da primeira confirmação", () => {
    expect(cancelQuestionOf(entry({ phase: "connecting", committed: 5 }))).toBeNull();
    expect(cancelQuestionOf(entry({ phase: "checking" }))).toBeNull();
    expect(cancelQuestionOf(entry({ single: true, committed: 5 }))).toBeNull();
    expect(cancelQuestionOf(entry({ committed: 0 }))).toBeNull();
  });

  it("pergunta quando algo já ficou, e diz o quê; sem log, a linha gravada ou o esvaziamento começado; sem saber como está, sempre", () => {
    expect(cancelQuestionOf(entry({ committed: 30_000 }))).toEqual({
      title: "Cancelar a importação para pedido?",
      text: "As 30.000 linhas já confirmadas ficam na tabela, e as da transação em andamento são desfeitas.",
      confirm: "Cancelar a importação",
      keep: "Continuar importando",
    });
    expect(cancelQuestionOf(entry({ committed: 30_000, empty: true }))?.text).toBe("As 30.000 linhas já confirmadas ficam na tabela, e as linhas antigas, apagadas pelo esvaziamento, não voltam.");
    expect(cancelQuestionOf(entry({ oneAtATime: true, rows: 1_234 }))?.text).toBe("As 1.234 linhas já gravadas ficam na tabela.");
    expect(cancelQuestionOf(entry({ oneAtATime: true, rows: 0, empty: true, phase: "emptying" }))?.text).toBe("O esvaziamento já começou, e as linhas que ele apagou não voltam.");
    expect(cancelQuestionOf(entry({ stage: "lost" }))?.text).toBe("As linhas já confirmadas ficam na tabela.");
    expect(cancelQuestionOf(entry({ kind: "copy", sourceName: "pedido", table: { ...table, name: "pedido_hist" }, committed: 1 }))).toMatchObject({ title: "Cancelar a cópia de pedido para pedido_hist?", confirm: "Cancelar a cópia", keep: "Continuar copiando" });
  });
});

describe("o que ficou e onde parou (RN-IMPORT-016 e 020)", () => {
  it("as linhas confirmadas, nenhuma, sem log, o esvaziamento em parte e a dúvida", () => {
    expect(stayedText(entry(), transfer({ state: "failed", committed: 30_000 }))).toBe("30.000 linhas confirmadas ficaram na tabela; as da transação em andamento foram desfeitas.");
    expect(stayedText(entry({ empty: true }), transfer({ state: "failed", committed: 1 }))).toBe("1 linha confirmada ficou na tabela; as da transação em andamento foram desfeitas. A tabela foi esvaziada antes.");
    expect(stayedText(entry(), transfer({ state: "canceled", committed: 0 }))).toBe("Nenhuma linha foi gravada, e a tabela está como antes.");
    expect(stayedText(entry({ oneAtATime: true }), transfer({ state: "failed", committed: 1_233 }))).toBe("As 1.233 linhas anteriores ficaram gravadas.");
    expect(stayedText(entry({ oneAtATime: true, empty: true }), transfer({ state: "canceled", committed: 1_234 }))).toBe("As 1.234 linhas gravadas até ali ficaram na tabela. A tabela foi esvaziada antes.");
    expect(stayedText(entry({ oneAtATime: true, empty: true }), transfer({ state: "failed", phase: "emptying" }))).toBe("A tabela pode ter sido esvaziada em parte; nenhuma linha do arquivo foi gravada.");
    expect(stayedText(entry(), transfer({ state: "failed", rows: 30_000, committed: 20_000, uncertain: true }))).toBe(
      "A conexão caiu durante a confirmação das linhas 20.001 a 30.000: o Prism não sabe se elas foram gravadas. Confira a tabela.",
    );
    expect(stayedText(entry({ empty: true }), transfer({ state: "failed", rows: 10_000, committed: 0, error: error({ uncertain: true }) }))).toBe(
      "A conexão caiu durante a confirmação do esvaziamento e das linhas 1 a 10.000: o Prism não sabe se a tabela foi esvaziada nem se as linhas foram gravadas. Confira a tabela.",
    );
    expect(stayedText(entry({ oneAtATime: true }), transfer({ state: "failed", rows: 1_233, error: error({ uncertain: true, line: 1_234 }) }))).toBe(
      "A conexão caiu durante a gravação da linha 1.234: o Prism não sabe se ela foi gravada. Confira a tabela.",
    );
    expect(stayedText(entry(), transfer({ state: "canceled", uncertain: true }))).toBe("O banco não respondeu ao cancelamento: o Prism não sabe o que ficou na tabela. Confira-a.");
  });

  it("a descrição da falha: a linha e a coluna do arquivo (o item da lista, a linha da planilha), a mensagem, o SQLSTATE e o que ficou; na cópia, o lado", () => {
    expect(failureDescription(entry(), transfer({ state: "failed", error: error({ line: 1_234, column: "qtd" }) })).description).toBe(
      "Linha 1.234 do arquivo, coluna qtd: «12a» não é um número inteiro. Nenhuma linha foi gravada, e a tabela está como antes.",
    );
    expect(failureDescription(entry({ format: "json" }), transfer({ state: "failed", error: error({ line: 12 }) })).description).toContain("Item 12 da lista: ");
    expect(failureDescription(entry({ format: "xlsx", sheet: "Pedidos" }), transfer({ state: "failed", error: error({ line: 12 }) })).description).toContain("Linha 12 da planilha Pedidos: ");
    expect(
      failureDescription(entry(), transfer({ state: "failed", rows: 30_000, committed: 20_000, error: error({ code: "SQL_EXECUTION_FAILED", message: "deadlock detected", sqlState: "40P01", committed: 20_000 }) })).description,
    ).toBe("Nas linhas 20.001 a 30.000 do arquivo: deadlock detected (SQLSTATE 40P01) 20.000 linhas confirmadas ficaram na tabela; as da transação em andamento foram desfeitas.");
    const copy = entry({ kind: "copy", sourceName: "pedido", table: { ...table, name: "pedido_hist" } });
    expect(failureDescription(copy, transfer({ kind: "copy", state: "failed", error: error({ line: 7, side: "target", code: "SQL_EXECUTION_FAILED", message: "duplicate key", sqlState: "23505" }) })).description).toBe(
      "Ao gravar no destino: linha 7 da origem: duplicate key (SQLSTATE 23505) Nenhuma linha foi gravada, e a tabela está como antes.",
    );
  });
});

describe("o acompanhamento (RN-IMPORT-019 a 021)", () => {
  it("consulta a cada segundo; o sucesso diz as linhas, o que a leitura fez no caminho e \"Abrir registros\", marca os Registros da tabela e esquece o trabalho", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ rows: 5, committed: 0, bytes: 500, phase: "loading" }) });
    await h.tick();
    expect(h.tracker.snapshot()[0]).toMatchObject({ rows: 5, bytes: 500, phase: "loading" });
    h.answers.push({ ok: true, data: transfer({ state: "done", rows: 12_345, summary: { rows: 12_345, committed: 12_345, emptied: true, skippedLines: 12, unguarded: 8, shortRows: 0, formulasWithoutValue: 0, bytes: null, sheets: null, cutValues: null, removedCharacters: null, skippedRows: null } }) });
    await h.tick();
    expect(h.toasts).toMatchObject([{ tone: "success", title: "12.345 linhas importadas em pedido.", description: "A tabela foi esvaziada antes. 12 linhas vazias do arquivo foram puladas. 8 valores perderam o apóstrofo da proteção contra fórmula.", action: "Abrir registros" }]);
    h.toasts[0].run?.();
    expect(h.opened).toEqual([table]);
    expect(h.marked).toEqual([table]);
    expect(h.forgotten).toEqual([id]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("as linhas completadas com nulo e as fórmulas sem resultado passam o aviso ao tom de atenção", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ state: "done", rows: 1, summary: { rows: 1, committed: 1, emptied: false, skippedLines: 0, unguarded: 0, shortRows: 1, formulasWithoutValue: 3, bytes: null, sheets: null, cutValues: null, removedCharacters: null, skippedRows: null } }) });
    await h.tick();
    expect(h.toasts[0]).toMatchObject({ tone: "warning", title: "1 linha importada em pedido.", description: "1 linha tinha menos valores que o cabeçalho e foi completada com nulo. 3 células com fórmula sem resultado guardado chegaram vazias." });
  });

  it("a falha: o aviso de erro com onde e por quê, e a entrada \"Ver o erro\" na barra, que não segura o bloqueio e não conta para as saídas", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ state: "failed", error: error({ line: 1_234, column: "qtd" }) }) });
    await h.tick();
    expect(h.toasts[0]).toMatchObject({ tone: "error", title: "A importação para pedido parou.", description: "Linha 1.234 do arquivo, coluna qtd: «12a» não é um número inteiro. Nenhuma linha foi gravada, e a tabela está como antes." });
    expect(h.tracker.snapshot()[0]).toMatchObject({ stage: "failed", failure: { line: 1_234, column: "qtd", message: "«12a» não é um número inteiro." } });
    expect(h.forgotten).toEqual([id]);
    expect(h.tracker.holdsLock()).toBe(false);
    expect(h.tracker.counts()).toEqual({ imports: 0, copies: 0 });
    expect(h.marked).toEqual([]);
    h.tracker.discard(id);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("cancelar: \"Cancelando…\" até o DELETE, então lê o trabalho, diz o que ficou e o esquece (o segundo DELETE)", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ state: "canceled", reason: "person", committed: 30_000 }) });
    const pending = h.tracker.confirmCancel(id);
    expect(h.tracker.snapshot()[0].stage).toBe("cancelling");
    expect(h.tracker.holdsLock()).toBe(true);
    await pending;
    expect(h.toasts).toMatchObject([{ tone: "warning", title: "Importação para pedido cancelada. 30.000 linhas confirmadas ficaram na tabela; as da transação em andamento foram desfeitas." }]);
    expect(h.forgotten).toEqual([id, id]);
    expect(h.marked).toEqual([table]);
  });

  it("o cancelamento que chegou durante a confirmação final termina em `done`, e o aviso diz que ela já tinha terminado", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ state: "done", rows: 12_345, summary: null }) });
    await h.tracker.confirmCancel(id);
    expect(h.toasts[0].title).toBe("A importação para pedido já tinha terminado quando o cancelamento chegou: 12.345 linhas importadas.");
  });

  it("o DELETE sem resposta devolve a entrada como estava; os outros fins (a conexão excluída, o somente leitura) avisam no tom de atenção", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.forgets.push(Promise.reject(new Error("x")));
    await h.tracker.confirmCancel(id);
    expect(h.tracker.snapshot()[0].stage).toBe("running");

    h.answers.push({ ok: true, data: transfer({ state: "canceled", reason: "connectionDeleted", committed: 0 }) });
    await h.tick();
    expect(h.toasts.at(-1)?.title).toBe("A importação para pedido foi cancelada: a conexão foi excluída. Nenhuma linha foi gravada, e a tabela está como antes.");

    h.tracker.start(imported);
    h.answers.push({ ok: true, data: transfer({ state: "canceled", reason: "readOnly", committed: 10 }) });
    await h.tick();
    expect(h.toasts.at(-1)?.title).toBe("A importação para pedido parou: a conexão passou a ser somente leitura. 10 linhas confirmadas ficaram na tabela; as da transação em andamento foram desfeitas.");
  });

  it("três consultas que falham deixam a entrada sem saber como está (o \"Cancelar\" pergunta sempre); o trabalho que sumiu avisa e marca os Registros", async () => {
    const h = harness();
    h.tracker.start(imported);
    const failure: ApiResult<Transfer> = { ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "", detail: null, errors: null, extensions: {} } };
    h.answers.push(failure, failure, failure);
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.tracker.snapshot()[0].stage).toBe("lost");
    expect(h.tracker.cancelQuestion(id)?.text).toBe("As linhas já confirmadas ficam na tabela.");
    expect(h.tracker.holdsLock()).toBe(false);

    const gone = harness();
    gone.tracker.start(imported);
    gone.answers.push({ ok: false, error: { status: 404, code: "TRANSFER_NOT_FOUND", title: "", detail: null, errors: null, extensions: {} } });
    await gone.tick();
    expect(gone.toasts[0].title).toBe("A importação para pedido se perdeu: o Prism não sabe o que ficou na tabela. Confira-a.");
    expect(gone.marked).toEqual([table]);
  });

  it("as saídas cancelam e esquecem as que rodam, sem avisos, e descartam a entrada da falha; o cofre que fecha só tira as entradas", async () => {
    const h = harness();
    h.tracker.start(imported);
    h.tracker.start({ ...imported, id: "outro", kind: "copy" });
    expect(h.tracker.counts()).toEqual({ imports: 1, copies: 1 });
    await h.tracker.cancelAll();
    expect([...h.forgotten].sort()).toEqual([id, id, "outro", "outro"].sort());
    expect(h.toasts).toEqual([]);
    expect(h.tracker.snapshot()).toEqual([]);

    h.tracker.start(imported);
    h.tracker.vaultClosed();
    expect(h.tracker.snapshot()).toEqual([]);
    expect(h.timers).toEqual([]);
  });
});
