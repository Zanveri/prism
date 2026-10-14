import { describe, expect, it } from "vitest";

import { createWorkspaceHub, saveWorkspaceThroughApi, workspaceSaveDelayMs } from "./workspace-hub";
import { savedWorkspaceSchema, type SavedTab, type SavedWorkspace } from "./workspace-messages";

const connection = "0199dd00-0000-7000-8000-000000000002";

const query = (sql: string, extra: Partial<Extract<SavedTab, { kind: "query" }>> = {}): SavedTab => ({ kind: "query", connectionID: connection, database: null, sql, scriptID: null, dirty: false, sqlTooLarge: false, ...extra });
const table = (name: string): SavedTab => ({ kind: "table", connectionID: connection, database: null, schema: "loja", table: name, view: "data" });
const workspace = (tabs: SavedTab[], activeIndex: number | null = tabs.length === 0 ? null : 0): SavedWorkspace => ({ tabs, activeIndex });

/** Um centro com relógio de mentira (os temporizadores só disparam por `tick`) e uma API de mentira que anota o que recebeu. */
function setup({ live = [1, 2], answer = true }: { live?: number[]; answer?: boolean } = {}) {
  const saved: SavedWorkspace[] = [];
  const logs: string[] = [];
  let timers: { at: number; run: () => void }[] = [];
  let now = 0;
  const windows = { live };
  let respond = answer;

  const hub = createWorkspaceHub({
    save: async (sent) => {
      saved.push(sent);
      return respond;
    },
    schedule(run, ms) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    liveWindows: () => windows.live,
    log: (message) => void logs.push(message),
  });

  async function tick(ms: number) {
    now += ms;
    const due = timers.filter((timer) => timer.at <= now);
    timers = timers.filter((timer) => timer.at > now);
    for (const timer of due) timer.run();
    await hub.flushed();
  }

  return { hub, saved, logs, tick, windows, failFromNowOn: () => (respond = false), pending: () => timers.length };
}

describe("o centro da área de trabalho no processo principal (RN-ABAS-006)", () => {
  it("só a janela principal (a primeira das vivas) reabre as abas, e uma vez por entrada", () => {
    const { hub } = setup({ live: [1, 2] });

    expect(hub.claim(2)).toBe(false);
    expect(hub.claim(1)).toBe(true);
    expect(hub.claim(1)).toBe(false);
  });

  it("nada é gravado antes de a janela principal contar as abas que reabriu: as das outras janelas não apagam o que estava gravado", async () => {
    const { hub, saved, tick } = setup();
    hub.claim(1);

    hub.report(2, { workspace: workspace([query("SELECT 2")]), urgent: true });
    await tick(workspaceSaveDelayMs);
    expect(saved).toEqual([]);

    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: false });
    await tick(workspaceSaveDelayMs);
    expect(saved).toEqual([workspace([query("SELECT 1"), query("SELECT 2")], 0)]);
  });

  it("grava alguns segundos depois da mudança, uma vez só para várias mudanças seguidas, e a espera não recomeça a cada uma", async () => {
    const { hub, saved, tick } = setup({ live: [1] });
    hub.claim(1);

    hub.report(1, { workspace: workspace([query("S")]), urgent: false });
    await tick(workspaceSaveDelayMs - 1000);
    hub.report(1, { workspace: workspace([query("SE")]), urgent: false });
    await tick(500);
    hub.report(1, { workspace: workspace([query("SEL")]), urgent: false });
    expect(saved).toEqual([]);

    await tick(500);
    expect(saved).toEqual([workspace([query("SEL")])]);
  });

  it("a mesma área de trabalho não é gravada de novo", async () => {
    const { hub, saved, tick } = setup({ live: [1] });
    hub.claim(1);

    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: true });
    await tick(0);
    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: false });
    await tick(workspaceSaveDelayMs);
    await hub.flush();

    expect(saved).toHaveLength(1);
  });

  it("fechar uma aba grava na hora, sem esperar", async () => {
    const { hub, saved, tick, pending } = setup({ live: [1] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("A"), query("B")]), urgent: false });

    hub.report(1, { workspace: workspace([query("A")]), urgent: true });
    await tick(0);

    expect(saved).toEqual([workspace([query("A")])]);
    expect(pending()).toBe(0);
  });

  it("antes de o cofre fechar grava o que há e espera a gravação terminar", async () => {
    const { hub, saved } = setup({ live: [1] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: false });

    await hub.flush();

    expect(saved).toEqual([workspace([query("SELECT 1")])]);
  });

  it("junta as janelas em ordem, a principal primeiro, e a ativa é a da principal (ou a da primeira janela que tem uma)", async () => {
    const { hub, saved } = setup({ live: [1, 2, 3] });
    hub.claim(1);
    hub.report(3, { workspace: workspace([query("C")], 0), urgent: false });
    hub.report(2, { workspace: workspace([table("b1"), table("b2")], 1), urgent: false });
    hub.report(1, { workspace: workspace([]), urgent: false });

    await hub.flush();

    expect(saved).toEqual([workspace([table("b1"), table("b2"), query("C")], 1)]);
  });

  it("a falha da gravação não passa calada nem para tudo: a mudança seguinte grava de novo", async () => {
    const { hub, saved, failFromNowOn } = setup({ live: [1] });
    hub.claim(1);
    failFromNowOn();
    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: true });
    await hub.flushed();

    await hub.flush();

    expect(saved).toHaveLength(2);
  });

  it("o que não tem a forma de uma área de trabalho é ignorado", async () => {
    const { hub, saved } = setup({ live: [1] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("SELECT 1")]), urgent: false });

    hub.report(1, { workspace: { tabs: [{ kind: "grafico" }], activeIndex: 0 }, urgent: true });
    hub.report(1, { workspace: workspace([query("SELECT 1")], 3), urgent: true });
    hub.report(1, "texto");
    await hub.flush();

    expect(saved).toEqual([workspace([query("SELECT 1")])]);
  });

  it("a janela que sai do cofre (o 'Sair') deixa de contar; quando todas saíram, a próxima entrada reabre as abas de novo e nada mais se grava até lá", async () => {
    const { hub, saved, tick } = setup({ live: [1, 2] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("A")]), urgent: false });
    hub.report(2, { workspace: workspace([query("B")]), urgent: false });

    hub.withdraw(1);
    hub.withdraw(2);
    await tick(workspaceSaveDelayMs);
    await hub.flush();

    expect(saved).toEqual([]);
    expect(hub.claim(1)).toBe(true);
  });

  it("a principal que recarrega com outra janela aberta não reabre as abas de novo (elas estão nas duas janelas)", () => {
    const { hub } = setup({ live: [1, 2] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("A")]), urgent: false });
    hub.report(2, { workspace: workspace([query("B")]), urgent: false });

    hub.withdraw(1);

    expect(hub.claim(1)).toBe(false);
  });

  it("fechar uma janela que não é a última tira as abas dela do que volta, na hora; a principal que fecha passa a vez à seguinte", async () => {
    const { hub, saved, windows } = setup({ live: [1, 2] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("A")]), urgent: false });
    hub.report(2, { workspace: workspace([query("B")]), urgent: false });

    windows.live = [2];
    hub.windowClosed(1, { last: false });
    await hub.flushed();

    expect(saved).toEqual([workspace([query("B")])]);
  });

  it("fechar a última janela (o app vai sair) guarda as abas dela, e a gravação de antes de sair as leva", async () => {
    const { hub, saved, windows } = setup({ live: [1] });
    hub.claim(1);
    hub.report(1, { workspace: workspace([query("A"), query("B")], 1), urgent: false });

    windows.live = [];
    hub.windowClosed(1, { last: true });
    await hub.flush();

    expect(saved).toEqual([workspace([query("A"), query("B")], 1)]);
  });
});

describe("o schema da área de trabalho gravada", () => {
  it("aceita o texto de 1 MB exato e recusa o de 1 MB mais um byte de UTF-8, e a aba marcada como grande demais tem de vir vazia", () => {
    expect(savedWorkspaceSchema.safeParse(workspace([query("a".repeat(1024 * 1024))])).success).toBe(true);
    expect(savedWorkspaceSchema.safeParse(workspace([query("é".repeat(512 * 1024 + 1))])).success).toBe(false);
    expect(savedWorkspaceSchema.safeParse(workspace([query("", { sqlTooLarge: true })])).success).toBe(true);
    expect(savedWorkspaceSchema.safeParse(workspace([query("SELECT 1", { sqlTooLarge: true })])).success).toBe(false);
  });

  it("recusa o índice da ativa fora da lista e a aba de tabela sem conexão", () => {
    expect(savedWorkspaceSchema.safeParse(workspace([query("A")], 1)).success).toBe(false);
    expect(savedWorkspaceSchema.safeParse(workspace([], 0)).success).toBe(false);
    expect(savedWorkspaceSchema.safeParse(workspace([{ ...table("t"), connectionID: null } as unknown as SavedTab])).success).toBe(false);
  });
});

describe("a gravação pela API", () => {
  it("manda o PUT com o token e diz o que a API respondeu, sem o conteúdo", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    };

    const outcome = await saveWorkspaceThroughApi({ baseUrl: "http://127.0.0.1:5000", token: "t0k3n" }, workspace([query("SELECT 'segredo'")]), { fetch: fetcher, timeoutMs: 1000 });

    expect(outcome).toEqual({ ok: true, outcome: "a API respondeu 204" });
    expect(calls[0].url).toBe("http://127.0.0.1:5000/api/user/workspace");
    expect(calls[0].init.method).toBe("PUT");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer t0k3n");
    expect(JSON.parse(String(calls[0].init.body))).toEqual(workspace([query("SELECT 'segredo'")]));
    expect(outcome.outcome).not.toContain("segredo");
  });

  it("o cofre fechado (401) e a API que não responde não lançam: voltam como falha", async () => {
    const locked = await saveWorkspaceThroughApi({ baseUrl: "http://127.0.0.1:5000", token: "t" }, workspace([]), { fetch: async () => new Response("{}", { status: 401 }), timeoutMs: 1000 });
    const down = await saveWorkspaceThroughApi({ baseUrl: "http://127.0.0.1:5000", token: "t" }, workspace([]), {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      timeoutMs: 1000,
    });

    expect(locked).toEqual({ ok: false, outcome: "a API respondeu 401" });
    expect(down.ok).toBe(false);
  });
});
