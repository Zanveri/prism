import { describe, expect, it } from "vitest";

import type { ApiResult } from "@/lib/api/prism-api";

import type { CopyReply, DeliverReply, DestinationReply } from "../../../../../electron/transfer-messages";
import { createTransferTracker, entryView, featuredExport, formatFileSize, maxPollFailures, summaryNotes, type NewExport, type TrackedExport, type TrackerDeps } from "./transfer-tracker";
import type { Transfer } from "./transfers.schema";

const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
const other = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const job = (change: Partial<Transfer> = {}): Transfer => ({ id, kind: "export", connectionID: "c1", windowID: 1, state: "running", phase: "reading", rows: 0, total: null, bytes: 0, summary: null, error: null, reason: null, ...change });

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const refused = (code: string): ApiResult<never> => ({ ok: false, error: { status: 404, code, title: code, detail: null, errors: null, extensions: {} } });

const added = (change: Partial<NewExport> = {}): NewExport => ({
  id,
  name: "pedido",
  subject: { subject: "Tabela pedido", feminine: true },
  connectionId: "c1",
  format: "csv",
  clipboard: false,
  reveal: false,
  destinationId: "dest-1",
  fileName: "pedido_2026-10-16_143005.csv",
  suggested: { suggestedName: "pedido_2026-10-16_143005", extension: "csv" },
  ...change,
});

/** Espera as promessas que a última ação deixou correndo (a consulta, a entrega, o esquecimento). */
const settle = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};

function harness() {
  const calls: string[] = [];
  const toasts: { tone: string; title: string; description?: string; action?: string }[] = [];
  let timer: (() => void) | null = null;
  const state = {
    polls: new Map<string, ApiResult<Transfer>>([[id, ok(job())]]),
    forget: ok<void>(undefined) as ApiResult<void>,
    deliver: { status: "delivered", deliveryId: "e1", fileName: "pedido_2026-10-16_143005.csv" } as DeliverReply,
    copy: { status: "copied" } as CopyReply,
    destination: { status: "chosen", destinationId: "dest-2", fileName: "outro.csv" } as DestinationReply | { status: "error" },
    revealed: [] as string[],
  };
  const deps: TrackerDeps = {
    getTransfer: async (transferId) => (calls.push(`get ${transferId}`), state.polls.get(transferId) ?? refused("TRANSFER_NOT_FOUND")),
    forget: async (transferId) => (calls.push(`delete ${transferId}`), state.forget),
    deliver: async (request) => (calls.push(`deliver ${request.transferId} ${request.destinationId} ${String(request.reveal)}`), state.deliver),
    copy: async (transferId) => (calls.push(`copy ${transferId}`), state.copy),
    chooseDestination: async (request) => (calls.push(`choose ${request.suggestedName}.${request.extension}`), state.destination),
    release: async (destinationId) => void calls.push(`release ${destinationId}`),
    reveal: (deliveryId) => state.revealed.push(deliveryId),
    notify: {
      success: (title, description, action) => toasts.push({ tone: "success", title, description, action: action?.label }),
      warning: (title, description, action) => toasts.push({ tone: "warning", title, description, action: action?.label }),
      error: (title, description) => toasts.push({ tone: "error", title, description }),
    },
    schedule: (run) => {
      timer = run;
      return () => (timer = null);
    },
  };
  const tracker = createTransferTracker(deps);
  return {
    tracker,
    calls,
    toasts,
    state,
    /** Um segundo do relógio da consulta. */
    async second() {
      const run = timer;
      timer = null;
      run?.();
      await settle();
    },
    scheduled: () => timer !== null,
    entry: () => tracker.snapshot()[0] as TrackedExport | undefined,
  };
}

describe("a exportação da janela, do 202 até a entrega (RN-EXPORT-020 e 021)", () => {
  it("entra na barra e é consultada a cada segundo, com a fase, as linhas, o total e os bytes; sem nada a consultar, o relógio para", async () => {
    const h = harness();
    expect(h.scheduled()).toBe(false);

    h.tracker.start(added());
    expect(h.entry()).toMatchObject({ stage: "running", phase: null, rows: 0 });
    expect(entryView(h.entry() as TrackedExport).text).toBe("Exportando pedido… conectando");

    h.state.polls.set(id, ok(job({ phase: "reading", rows: 5678, total: 12345, bytes: 3_565_158 })));
    await h.second();
    expect(h.entry()).toMatchObject({ phase: "reading", rows: 5678, total: 12345 });
    expect(entryView(h.entry() as TrackedExport)).toEqual({ text: "Exportando pedido… 45%", hint: "5.678 de 12.345 linhas · 3,4 MB", percent: 45, busy: false });
    expect(h.scheduled()).toBe(true);
  });

  it("pronto, o processo principal entrega: o aviso de sucesso com \"Mostrar na pasta\", o trabalho esquecido na API, e a entrada sai", async () => {
    const h = harness();
    h.tracker.start(added({ reveal: true }));
    h.state.polls.set(id, ok(job({ state: "done", phase: null, rows: 12345, bytes: 100, summary: { rows: 12345, bytes: 100, sheets: null, cutValues: 0, removedCharacters: 0, skippedRows: 0 } })));

    await h.second();

    expect(h.calls).toEqual([`get ${id}`, `deliver ${id} dest-1 true`, `delete ${id}`]);
    expect(h.toasts).toEqual([{ tone: "success", title: "Tabela pedido exportada: 12.345 linhas em pedido_2026-10-16_143005.csv.", description: undefined, action: "Mostrar na pasta" }]);
    expect(h.tracker.snapshot()).toEqual([]);
    expect(h.scheduled()).toBe(false);
  });

  it("o resumo vai no mesmo aviso, que passa ao tom de atenção quando algo do dado não saiu inteiro; as planilhas a mais não mudam o tom", () => {
    expect(summaryNotes("xlsx", { rows: 3, bytes: 1, sheets: 3, cutValues: 0, removedCharacters: 0, skippedRows: 0 })).toEqual({ notes: ["Em 3 planilhas: o Excel tem até 1.048.576 linhas por planilha."], warning: false });
    expect(summaryNotes("xlsx", { rows: 3, bytes: 1, sheets: 1, cutValues: 4, removedCharacters: 0, skippedRows: 0 })).toEqual({ notes: ["4 valores cortados no limite da célula do Excel (32.767 caracteres)."], warning: true });
    expect(summaryNotes("txt", { rows: 3, bytes: 1, sheets: null, cutValues: 1, removedCharacters: 0, skippedRows: 0 }).notes).toEqual(["1 valor cortado na largura máxima do TXT."]);
    expect(summaryNotes("xml", { rows: 3, bytes: 1, sheets: null, cutValues: 0, removedCharacters: 12, skippedRows: 0 }).notes).toEqual(["12 caracteres que o formato não aceita foram tirados."]);
    expect(summaryNotes("sql", { rows: 3, bytes: 1, sheets: null, cutValues: 0, removedCharacters: 0, skippedRows: 1 }).notes).toEqual(["1 linha não exportada, comentada no arquivo: um valor dela não tem literal no banco."]);
  });

  it("na área de transferência, o texto é copiado pelo processo principal e o aviso diz o formato, sem botão", async () => {
    const h = harness();
    h.tracker.start(added({ clipboard: true, destinationId: null, fileName: null, suggested: null, name: "resultado de consulta-1.sql", subject: { subject: "Resultado de consulta-1.sql", feminine: false } }));
    h.state.polls.set(id, ok(job({ state: "done", rows: 120, summary: { rows: 120, bytes: 10, sheets: null, cutValues: 0, removedCharacters: 0, skippedRows: 0 } })));

    await h.second();

    expect(h.calls).toEqual([`get ${id}`, `copy ${id}`, `delete ${id}`]);
    expect(h.toasts).toEqual([{ tone: "success", title: "Resultado de consulta-1.sql copiado: 120 linhas em CSV.", description: undefined, action: undefined }]);
  });

  it("o trabalho que falha dá o aviso de erro com a mensagem do banco e o SQLSTATE, solta o destino e é esquecido", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.polls.set(id, ok(job({ state: "failed", error: { code: "SQL_EXECUTION_FAILED", message: 'relation "pedido" does not exist', sqlState: "42P01" } })));

    await h.second();

    expect(h.toasts).toEqual([{ tone: "error", title: "A exportação de pedido falhou.", description: 'relation "pedido" does not exist (SQLSTATE 42P01)' }]);
    expect(h.calls).toEqual([`get ${id}`, "release dest-1", `delete ${id}`]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("cancelada pela exclusão da conexão: o aviso de atenção; cancelada pela pessoa noutra rota, nada a dizer de novo", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.polls.set(id, ok(job({ state: "canceled", reason: "connectionDeleted" })));
    await h.second();
    expect(h.toasts).toEqual([{ tone: "warning", title: "A exportação de pedido foi cancelada: a conexão foi excluída.", description: undefined, action: undefined }]);
  });

  it("a entrega que falha fica na barra com o motivo, segue consultada (o trabalho não é abandonado) e não segura o bloqueio", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.deliver = { status: "failed", reason: "inUse", message: "o arquivo está aberto em outro programa" };
    h.state.polls.set(id, ok(job({ state: "done", rows: 3 })));

    await h.second();

    expect(h.entry()).toMatchObject({ stage: "deliveryFailed", failure: "o arquivo está aberto em outro programa" });
    expect(entryView(h.entry() as TrackedExport).text).toBe("pedido_2026-10-16_143005.csv não foi gravado: o arquivo está aberto em outro programa.");
    expect(h.tracker.holdsLock()).toBe(false);
    expect(h.tracker.failedDeliveries()).toBe(1);
    expect(h.scheduled()).toBe(true);
    await h.second();
    expect(h.calls.filter((call) => call.startsWith("get"))).toHaveLength(2);
  });

  it("\"Salvar como…\" solta o destino que falhou ANTES de pedir o novo (o mesmo arquivo pode ser escolhido de novo) e entrega nele", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.deliver = { status: "failed", reason: "inUse", message: "x" };
    h.state.polls.set(id, ok(job({ state: "done", rows: 3, summary: { rows: 3, bytes: 1, sheets: null, cutValues: 0, removedCharacters: 0, skippedRows: 0 } })));
    await h.second();
    h.calls.length = 0;
    h.state.deliver = { status: "delivered", deliveryId: "e2", fileName: "outro.csv" };

    await h.tracker.saveAs(id);

    expect(h.calls).toEqual(["release dest-1", "choose pedido_2026-10-16_143005.csv", `deliver ${id} dest-2 false`, `delete ${id}`]);
    expect(h.toasts.at(-1)).toMatchObject({ tone: "success", title: "Tabela pedido exportada: 3 linhas em outro.csv." });
  });

  it("desistir do diálogo do \"Salvar como…\" deixa a entrada como estava; \"Descartar\" a esquece, sem aviso", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.deliver = { status: "failed", reason: "diskFull", message: "x" };
    h.state.polls.set(id, ok(job({ state: "done" })));
    await h.second();
    h.state.destination = { status: "canceled" };

    await h.tracker.saveAs(id);
    expect(h.entry()).toMatchObject({ stage: "deliveryFailed", busy: false, failure: "não há espaço no disco de destino" });

    h.calls.length = 0;
    await h.tracker.discard(id);
    expect(h.calls).toEqual([`delete ${id}`]);
    expect(h.tracker.snapshot()).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("o pronto que sumiu antes da entrega (`missing`) sai com o aviso de que a exportação se perdeu", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.deliver = { status: "missing" };
    h.state.polls.set(id, ok(job({ state: "done" })));
    await h.second();
    expect(h.toasts).toEqual([{ tone: "error", title: "A exportação de pedido se perdeu antes de ser gravada. Exporte de novo.", description: undefined }]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("três falhas seguidas da consulta param a consulta da entrada, que diz que não se sabe como está; \"Cancelar\" tenta o DELETE", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.polls.set(id, { ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "", detail: null, errors: null, extensions: {} } });
    for (let index = 0; index < maxPollFailures; index++) await h.second();

    expect(h.entry()).toMatchObject({ stage: "lost" });
    expect(entryView(h.entry() as TrackedExport).text).toBe("Não foi possível saber como está a exportação.");
    expect(h.scheduled()).toBe(false);

    await h.tracker.cancel(id);
    expect(h.calls.slice(-2)).toEqual(["release dest-1", `delete ${id}`]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("o trabalho que a API não conhece mais (abandonado, a API que reiniciou) sai com o aviso de que se perdeu", async () => {
    const h = harness();
    h.tracker.start(added());
    h.state.polls.delete(id);
    await h.second();
    expect(h.toasts.map((toast) => toast.title)).toEqual(["A exportação de pedido se perdeu antes de ser gravada. Exporte de novo."]);
  });
});

describe("cancelar e sair (RN-EXPORT-021 e 023)", () => {
  it("\"Cancelar\" pede o DELETE e solta o destino; com a resposta, a entrada sai com o aviso de atenção", async () => {
    const h = harness();
    h.tracker.start(added());

    const cancelling = h.tracker.cancel(id);
    expect(h.entry()).toMatchObject({ stage: "cancelling" });
    expect(entryView(h.entry() as TrackedExport)).toMatchObject({ text: "Cancelando…", busy: true });
    await cancelling;

    expect(h.calls).toEqual(["release dest-1", `delete ${id}`]);
    expect(h.toasts).toEqual([{ tone: "warning", title: "Exportação de pedido cancelada. Nenhum arquivo foi gravado.", description: undefined, action: undefined }]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("cancelar durante a entrega solta o destino (o processo principal para a cópia): `canceled` dá o aviso de cancelada; `delivered` chegou antes, e o de sucesso sai", async () => {
    let answer: (reply: DeliverReply) => void = () => {};
    const h = harness();
    // A entrega fica presa até a resposta escolhida abaixo.
    const realDeliver = new Promise<DeliverReply>((resolve) => (answer = resolve));
    const tracker = createTransferTracker({
      getTransfer: async () => ok(job({ state: "done", rows: 2 })),
      forget: async () => ok(undefined),
      deliver: () => realDeliver,
      copy: async () => ({ status: "copied" }),
      chooseDestination: async () => ({ status: "canceled" }),
      release: async (destinationId) => void h.calls.push(`release ${destinationId}`),
      reveal: () => {},
      notify: { success: (title) => h.toasts.push({ tone: "success", title }), warning: (title) => h.toasts.push({ tone: "warning", title }), error: (title) => h.toasts.push({ tone: "error", title }) },
      schedule: (run) => (queueMicrotask(run), () => {}),
    });
    tracker.start(added());
    await settle();
    expect(tracker.snapshot()[0]).toMatchObject({ stage: "delivering" });

    await tracker.cancel(id);
    expect(h.calls).toContain("release dest-1");
    answer({ status: "canceled" });
    await settle();
    expect(h.toasts).toEqual([{ tone: "warning", title: "Exportação de pedido cancelada. Nenhum arquivo foi gravado." }]);
    expect(tracker.snapshot()).toEqual([]);
  });

  it("a exportação segura o bloqueio do começo até a entrega; as saídas confirmadas cancelam todas (DELETE e destinos soltos), sem aviso", async () => {
    const h = harness();
    h.tracker.start(added());
    h.tracker.start(added({ id: other, destinationId: "dest-9" }));
    expect(h.tracker.holdsLock()).toBe(true);
    expect(h.tracker.count()).toBe(2);

    await h.tracker.cancelAll();

    expect(h.calls.sort()).toEqual(["delete " + id, "delete " + other, "release dest-1", "release dest-9"].sort());
    expect(h.tracker.snapshot()).toEqual([]);
    expect(h.toasts).toEqual([]);
    expect(h.tracker.holdsLock()).toBe(false);
  });

  it("o cofre que fecha por outro caminho (o bloqueio) só solta os destinos: a API já cancelou e esqueceu os trabalhos", async () => {
    const h = harness();
    h.tracker.start(added());
    await h.tracker.vaultClosed();
    expect(h.calls).toEqual(["release dest-1"]);
    expect(h.tracker.snapshot()).toEqual([]);
  });

  it("a área de trabalho que desmonta (o cofre fechou) esquece tudo e para a consulta; a resposta que chega depois não age, e a próxima entrada começa do zero", async () => {
    const h = harness();
    h.tracker.start(added());
    h.tracker.reset();
    await settle();
    expect(h.calls).toEqual(["release dest-1"]);
    expect(h.tracker.snapshot()).toEqual([]);
    expect(h.scheduled()).toBe(false);

    h.tracker.start(added({ id: other }));
    expect(h.tracker.snapshot().map((entry) => entry.id)).toEqual([other]);
  });
});

describe("o que a barra mostra", () => {
  const base = (change: Partial<TrackedExport>): TrackedExport => ({ ...added(), seq: 1, stage: "running", phase: "reading", rows: 0, total: null, bytes: 0, failure: null, busy: false, ...change });

  it("sem o total, as linhas e o tamanho, com a barra sem medida; com mais linhas que o total, o mesmo", () => {
    expect(entryView(base({ rows: 12345, bytes: 3_565_158 }))).toEqual({ text: "Exportando pedido… 12.345 linhas · 3,4 MB", hint: "Exportando pedido… 12.345 linhas · 3,4 MB", percent: null, busy: false });
    expect(entryView(base({ rows: 13, total: 12, bytes: 10 })).percent).toBeNull();
    expect(entryView(base({ rows: 1, bytes: 10 })).text).toBe("Exportando pedido… 1 linha · 10 bytes");
  });

  it("a porcentagem é arredondada para baixo e para em 99% até o fim", () => {
    expect(entryView(base({ rows: 99_999, total: 100_000 })).percent).toBe(99);
    expect(entryView(base({ rows: 100_000, total: 100_000 })).percent).toBe(99);
    expect(entryView(base({ rows: 1, total: 3 })).percent).toBe(33);
  });

  it("as fases: contando, terminando, gravando (com o nome do arquivo)", () => {
    expect(entryView(base({ phase: "counting" })).text).toBe("Exportando pedido… contando as linhas");
    expect(entryView(base({ phase: "finishing" })).text).toBe("Exportando pedido… terminando");
    expect(entryView(base({ stage: "delivering" })).text).toBe("Gravando pedido_2026-10-16_143005.csv…");
  });

  it("a barra mostra a que pede ação (a entrega que falhou mais antiga); sem nenhuma, a mais antiga", () => {
    const a = base({ id: "a", seq: 1 });
    const b = base({ id: "b", seq: 2, stage: "deliveryFailed" });
    const c = base({ id: "c", seq: 3, stage: "deliveryFailed" });
    expect(featuredExport([c, a, b])?.id).toBe("b");
    expect(featuredExport([base({ id: "z", seq: 9 }), a])?.id).toBe("a");
    expect(featuredExport([])).toBeNull();
  });

  it("o tamanho, como o do arquivo no Importar conexões: bytes, KB, MB com uma casa abaixo de 10, GB", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(14 * 1024)).toBe("14 KB");
    expect(formatFileSize(3_565_158)).toBe("3,4 MB");
    expect(formatFileSize(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatFileSize(1.25 * 1024 * 1024 * 1024)).toBe("1,3 GB");
  });
});
