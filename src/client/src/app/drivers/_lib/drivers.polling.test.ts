import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { driversQuery } from "./drivers.service";
import { isPollingSuspended, keepPollingAfterInstall, pollFailed, pollInterval, pollSucceeded, resetDriversPolling, resumePolling, subscribePolling } from "./drivers.polling";
import type { Driver } from "./drivers.schema";

// O TanStack decide se está num servidor (e então não agenda `refetchInterval`) quando o módulo é carregado, olhando `window`.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const item = (state: Driver["state"], extra: Partial<Driver> = {}): Driver => ({
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state,
  version: "12.1.3",
  sizeBytes: 115343360,
  license: { name: "Licença", url: "https://exemplo.local/licenca" },
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
  ...extra,
});

/** Um `fetch` que responde sempre o que `answer` devolve, e conta as consultas à lista. */
function listApi(answer: () => Response) {
  const state = { gets: 0 };
  vi.stubGlobal("fetch", async () => {
    state.gets += 1;
    return answer();
  });
  return state;
}

const problem500 = () => new Response(JSON.stringify({ type: "INTERNAL_SERVER_ERROR", title: "Erro do servidor.", status: 500 }), { status: 500 });
const available = () => Response.json([item("available")]);

beforeEach(() => {
  vi.stubGlobal("window", { prism: bridge });
  vi.useFakeTimers();
  resetDriversPolling();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pollInterval", () => {
  const drivers = (state: Driver["state"]) => [item(state)];

  it("1 s com um driver baixando, e nada sem ele", () => {
    expect(pollInterval(drivers("installing"))).toBe(1000);
    expect(pollInterval(drivers("installed"))).toBe(false);
    expect(pollInterval(drivers("available"))).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("depois de um 202 a consulta fica ligada por 10 s, ainda que a lista não diga 'installing'", () => {
    keepPollingAfterInstall(5000);

    expect(pollInterval(drivers("available"), 5001)).toBe(1000);
    expect(pollInterval(drivers("available"), 14999)).toBe(1000);
    expect(pollInterval(drivers("available"), 15000)).toBe(false);
  });
});

describe("subscribePolling: a tela é avisada quando a consulta periódica para ou volta", () => {
  it("avisa quando o terceiro erro seguido suspende a consulta, e quando ela volta", () => {
    const listener = vi.fn();
    const stop = subscribePolling(listener);

    pollFailed();
    pollFailed();
    expect(isPollingSuspended()).toBe(false);
    pollFailed();
    expect(isPollingSuspended()).toBe(true);
    const afterSuspend = listener.mock.calls.length;
    expect(afterSuspend).toBeGreaterThanOrEqual(1);

    resumePolling();
    expect(isPollingSuspended()).toBe(false);
    expect(listener.mock.calls.length).toBeGreaterThan(afterSuspend);
    stop();
  });

  it("uma resposta boa depois de erros também avisa; sem erros antes, não há o que avisar", () => {
    const listener = vi.fn();
    const stop = subscribePolling(listener);

    pollSucceeded();
    expect(listener).not.toHaveBeenCalled();

    pollFailed();
    pollFailed();
    pollFailed();
    const before = listener.mock.calls.length;
    pollSucceeded();
    expect(isPollingSuspended()).toBe(false);
    expect(listener.mock.calls.length).toBeGreaterThan(before);
    stop();
  });

  it("quem deixou de observar não é mais avisado", () => {
    const listener = vi.fn();
    subscribePolling(listener)();

    pollFailed();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("a consulta periódica na tela (item D)", () => {
  it("depois de um 202 com a lista ainda em 'available': consulta por cerca de 10 s e para (rede de segurança)", async () => {
    const api = listApi(available);
    keepPollingAfterInstall();

    const stop = new QueryObserver(new QueryClient(), driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(9_500);
    const during = api.gets;
    expect(during).toBeGreaterThanOrEqual(9);

    await vi.advanceTimersByTimeAsync(2_500);
    const afterGrace = api.gets;
    expect(afterGrace).toBeLessThanOrEqual(12);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.gets).toBe(afterGrace);
    stop();
  });

  it("sem o 202, a lista em 'available' é uma consulta só", async () => {
    const api = listApi(available);

    const stop = new QueryObserver(new QueryClient(), driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.gets).toBe(1);
    stop();
  });

  it("sair da tela com um download em andamento para a consulta", async () => {
    const api = listApi(() => Response.json([item("installing", { progress: { receivedBytes: 10, totalBytes: 100 } })]));

    const stop = new QueryObserver(new QueryClient(), driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(3_500);
    const whileOpen = api.gets;
    expect(whileOpen).toBeGreaterThanOrEqual(3);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(api.gets).toBe(whileOpen);
  });

  it("com a API respondendo erro: para depois de 3 erros seguidos, com um aviso só", async () => {
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const client = createQueryClient(toast);
    client.setQueryData(driversQuery.queryKey, [item("installing", { progress: { receivedBytes: 10, totalBytes: 100 } })]);
    const api = listApi(problem500);

    const stop = new QueryObserver(client, driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.gets).toBe(3);
    expect(isPollingSuspended()).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
    stop();
  });

  it("volta quando o usuário atualiza a lista e ela responde", async () => {
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const client = createQueryClient(toast);
    client.setQueryData(driversQuery.queryKey, [item("installing", { progress: { receivedBytes: 10, totalBytes: 100 } })]);
    let healthy = false;
    const api = listApi(() => (healthy ? Response.json([item("installing", { progress: { receivedBytes: 10, totalBytes: 100 } })]) : problem500()));

    const observer = new QueryObserver(client, driversQuery);
    const stop = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.gets).toBe(3);

    // "Atualizar a lista": recomeça a contagem e busca de novo; a API voltou, e o ritmo também.
    healthy = true;
    resumePolling();
    await observer.refetch();
    await vi.advanceTimersByTimeAsync(3_500);

    expect(isPollingSuspended()).toBe(false);
    expect(api.gets).toBeGreaterThanOrEqual(6);
    stop();
  });

  it("o erro que volta a acontecer depois de uma resposta boa conta de novo do zero e avisa de novo", async () => {
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const client = createQueryClient(toast);
    client.setQueryData(driversQuery.queryKey, [item("installing", { progress: { receivedBytes: 10, totalBytes: 100 } })]);
    const answers = [problem500, problem500, () => Response.json([item("installing", { progress: { receivedBytes: 20, totalBytes: 100 } })]), problem500];
    const api = listApi(() => (answers.shift() ?? problem500)());

    const stop = new QueryObserver(client, driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(3_500);

    // 500, 500 (calado), bom (zera), 500 (avisa de novo): 4 consultas, 2 avisos.
    expect(api.gets).toBeGreaterThanOrEqual(4);
    expect(toast.error).toHaveBeenCalledTimes(2);
    stop();
  });
});
