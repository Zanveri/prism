import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { databaseSessionKey, treeKey } from "./database-sessions.service";
import { structureKey } from "./table-structure.service";
import { createQueryRunner } from "./use-query-runner";
import { anyRunnerBusy, createLockHandles, discardForLock } from "./workbench-lock";
import type { QueryTab } from "./workbench-model";

// O descarte do bloqueio com executores de verdade e a API trocada (RN-SEG-001): o que o painel vê depois dele.

const base = "http://127.0.0.1:51234/";
const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };
const sessions = "api/user/database-sessions";

/** Troca o `fetch` por uma API que abre sessão e devolve uma página de linhas; o teste pode segurar a resposta da consulta. */
function fakeApi() {
  const calls: string[] = [];
  let holdQuery: Promise<void> | null = null;
  let sessionCount = 0;

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const route = `${init.method ?? "GET"} ${url.replace(base, "")}`;
    calls.push(route);
    if (route === `POST ${sessions}`) return Response.json({ id: `s${++sessionCount}`, database: "mes" }, { status: 201 });

    if (holdQuery !== null) await holdQuery;
    return Response.json({ columns: [{ name: "id", type: "int8", kind: "number" }], rows: [["1"]], hasMore: false, elapsedMs: 1, truncatedCells: [], rowsAffected: null });
  });

  return {
    calls,
    hold() {
      let release!: () => void;
      holdQuery = new Promise<void>((resolve) => (release = resolve));
      return () => {
        holdQuery = null;
        release();
      };
    },
  };
}

function workbench(tabs: QueryTab[]) {
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const queryClient = createQueryClient(toast);
  const createRunner = (tab: Pick<QueryTab, "id" | "connectionId">) => createQueryRunner({ connectionId: tab.connectionId, queryClient, toast, onSession: () => {} });
  const runners = new Map(tabs.map((tab) => [tab.id, createRunner(tab)]));
  const setTabs = vi.fn();
  return { queryClient, runners, setTabs, createRunner, discard: () => discardForLock({ runners, tabs, createRunner, setTabs, queryClient }) };
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

// SQL digitado e ainda não executado: nenhuma aba tem sessão. É o estado mais comum, e o que o atalho de identidade deixava sem redesenhar.
const typed: QueryTab = { id: "a", title: "consulta-1.sql", connectionId: "c1", sessionId: null, sql: "update t set a = 1" };
const other: QueryTab = { id: "b", title: "public.clientes", connectionId: "c2", sessionId: null, sql: "", table: { schema: "public", name: "clientes", view: "data" } };

describe("discardForLock: o descarte do bloqueio chega à tela mesmo sem nenhuma aba com sessão", () => {
  it("(i) o que o painel recebe é novo: a lista de abas muda de identidade e o executor do mapa não é o de antes", () => {
    const { runners, setTabs, discard } = workbench([typed]);
    const before = runners.get("a");

    discard();

    expect(runners.get("a")).toBeDefined();
    expect(runners.get("a")).not.toBe(before);
    // O provedor publica o resultado da atualização: tem de ser outra lista, e não a mesma, para os painéis redesenharem.
    expect(setTabs).toHaveBeenCalledOnce();
    const update = setTabs.mock.calls[0][0] as (tabs: QueryTab[]) => QueryTab[];
    const current = [typed];
    expect(update(current)).not.toBe(current);
  });

  it("(ii) o executor velho recusa executar: nenhuma chamada à API, e nenhum comando órfão", async () => {
    const api = fakeApi();
    const { runners, discard } = workbench([typed]);
    const old = runners.get("a")!;

    discard();
    await old.run({ sql: "update t set a = 1", offset: 0 });

    expect(api.calls).toEqual([]);
    expect(old.getState()).toEqual({ status: "idle" });
  });

  it("(iii) uma aba com linhas na tela e sessionId nulo (como depois de Desconectar) fica sem linhas, no executor novo e no velho", async () => {
    fakeApi();
    const { runners, discard } = workbench([typed]);
    const old = runners.get("a")!;
    await old.run({ sql: "select 1", offset: 0 });
    expect(old.getState().status).toBe("rows");

    discard();

    expect(runners.get("a")!.getState()).toEqual({ status: "idle" });
    expect(old.getState()).toEqual({ status: "idle" });
  });

  it("(iv) o bloqueio por inatividade enxerga o comando que roda depois do desbloqueio: ele roda no executor do mapa", async () => {
    const api = fakeApi();
    const { runners, discard } = workbench([typed]);
    discard();
    expect(anyRunnerBusy(runners)).toBe(false);

    const release = api.hold();
    const running = runners.get("a")!.run({ sql: "update t set a = 1", offset: 0 });
    await vi.waitFor(() => expect(api.calls).toContain(`POST ${sessions}/s1/queries`));
    expect(anyRunnerBusy(runners)).toBe(true);

    release();
    await running;
    expect(anyRunnerBusy(runners)).toBe(false);
  });

  it("o executor novo abre uma sessão própria na primeira execução, e o velho não abre nenhuma", async () => {
    const api = fakeApi();
    const { runners, discard } = workbench([typed]);
    const old = runners.get("a")!;
    await old.run({ sql: "select 1", offset: 0 });
    const calls = api.calls.length;

    discard();
    await old.run({ sql: "select 2", offset: 0 });
    expect(api.calls).toHaveLength(calls);

    await runners.get("a")!.run({ sql: "select 3", offset: 0 });
    expect(api.calls.slice(calls)).toEqual([`POST ${sessions}`, `POST ${sessions}/s2/queries`]);
  });

  it("troca o executor de cada aba, e só os executores: duas abas, dois executores novos, as mesmas chaves", () => {
    const { runners, discard } = workbench([typed, other]);
    const before = [...runners.values()];

    discard();

    expect([...runners.keys()]).toEqual(["a", "b"]);
    for (const runner of runners.values()) expect(before).not.toContain(runner);
  });

  it("tira do cache o dado de banco (a sessão da árvore, os níveis e a estrutura) e deixa o que não é: o que o desbloqueio vai buscar de novo", () => {
    const { queryClient, discard } = workbench([typed]);
    for (const queryKey of [databaseSessionKey("c1"), treeKey({ type: "database", connectionId: "c1" }), structureKey("c1", "public", "t", "columns"), ["connections"], ["session"]]) queryClient.setQueryData(queryKey, { dado: 1 });

    discard();

    expect(queryClient.getQueryCache().getAll().map((cached) => JSON.stringify(cached.queryKey)).sort()).toEqual([JSON.stringify(["connections"]), JSON.stringify(["session"])].sort());
  });
});

describe("createLockHandles: os dois ganchos que o provedor entrega ao bloqueio (a montagem)", () => {
  it("o descarte age sobre o MESMO mapa de executores (a identidade que o chamador segura) e sobre as abas correntes, e publica a lista nova", () => {
    const { runners, setTabs, createRunner, queryClient } = workbench([typed, other]);
    const before = new Map(runners);
    const created = vi.fn(createRunner);
    const { discard } = createLockHandles({ runners, tabs: [typed, other], createRunner: created, setTabs, queryClient });

    discard();

    // As abas correntes: um executor novo para cada uma, e só para elas.
    expect(created.mock.calls.map(([tab]) => tab.id)).toEqual(["a", "b"]);
    // O mapa que o chamador segura foi o trocado: cada chave tem o executor que a fábrica acabou de criar, e não o de antes.
    expect([...runners.keys()]).toEqual(["a", "b"]);
    created.mock.results.forEach((result, index) => {
      const id = index === 0 ? "a" : "b";
      expect(runners.get(id)).toBe(result.value);
      expect(runners.get(id)).not.toBe(before.get(id));
    });
    expect(setTabs).toHaveBeenCalledOnce();
    const update = setTabs.mock.calls[0][0] as (tabs: QueryTab[]) => QueryTab[];
    const current = [typed, other];
    expect(update(current)).not.toBe(current);
  });

  it("'há comando em andamento' olha o mapa a cada chamada: o executor de qualquer aba, inclusive o de uma aba que entrou depois da montagem", async () => {
    const api = fakeApi();
    const { runners, setTabs, createRunner, queryClient } = workbench([typed]);
    const { isBusy } = createLockHandles({ runners, tabs: [typed], createRunner, setTabs, queryClient });
    expect(isBusy()).toBe(false);

    const release = api.hold();
    const running = runners.get("a")!.run({ sql: "update t set a = 1", offset: 0 });
    await vi.waitFor(() => expect(isBusy()).toBe(true));
    release();
    await running;
    expect(isBusy()).toBe(false);

    runners.set("late", createRunner(other));
    const releaseLate = api.hold();
    const runningLate = runners.get("late")!.run({ sql: "select 1", offset: 0 });
    await vi.waitFor(() => expect(isBusy()).toBe(true));
    releaseLate();
    await runningLate;
  });
});
