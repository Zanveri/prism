import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelDriverInstall, driversQuery, installDriver, listDrivers, removeDriver } from "./drivers.service";
import type { Driver } from "./drivers.schema";
import { resetDriversPolling } from "./drivers.polling";
import { watchDriverTransitions } from "./drivers.watch";

// O TanStack decide se está num servidor (e então não agenda `refetchInterval`) quando o módulo é carregado, olhando `window`:
// no Electron ele existe, e para o teste ele existir antes dos imports.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Call = { method: string; path: string; body: unknown };

/** O `fetch` trocado por um que responde, na ordem, o que o teste combinou para cada rota. */
function fakeApi() {
  const calls: Call[] = [];
  const answers: { route: string; answer: () => Response }[] = [];

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", path: url.replace(`${base}/`, ""), body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined };
    calls.push(call);

    const route = `${call.method} ${call.path}`;
    const index = answers.findIndex((candidate) => candidate.route === route);
    if (index < 0) throw new Error(`Sem resposta combinada para ${route}`);
    // A última resposta combinada para a rota vale para as chamadas seguintes.
    return (answers.filter((candidate) => candidate.route === route).length > 1 ? answers.splice(index, 1)[0] : answers[index]).answer();
  });

  return { calls, on: (route: string, answer: () => Response) => void answers.push({ route, answer }) };
}

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state: "available",
  version: "12.1.3",
  sizeBytes: 115343360,
  license: { name: "Licença", url: "https://exemplo.local/licenca" },
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
  ...overrides,
});
const list = (...items: Record<string, unknown>[]) => () => Response.json(items);

beforeEach(() => {
  vi.stubGlobal("window", { prism: bridge });
  resetDriversPolling();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("as rotas de api/user/drivers (seção 16)", () => {
  it("lista com GET e valida a resposta", async () => {
    const api = fakeApi();
    api.on("GET api/user/drivers", list(item()));

    const result = await listDrivers();

    expect(result.ok && result.data[0]).toMatchObject({ id: "ibm-data-server", state: "available" });
    expect(api.calls).toEqual([{ method: "GET", path: "api/user/drivers", body: undefined }]);
  });

  it("uma resposta que não é a lista é RESPONSE_INVALID", async () => {
    const api = fakeApi();
    api.on("GET api/user/drivers", () => Response.json({ drivers: [] }));

    expect(await listDrivers()).toMatchObject({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });

  it("instalar é POST em /install com o aceite da licença", async () => {
    const api = fakeApi();
    api.on("POST api/user/drivers/ibm-data-server/install", () => new Response(null, { status: 202 }));

    expect(await installDriver("ibm-data-server", true)).toEqual({ ok: true, data: undefined });
    expect(api.calls).toEqual([{ method: "POST", path: "api/user/drivers/ibm-data-server/install", body: { acceptedLicense: true } }]);
  });

  it("o corpo leva o aceite que a pessoa deu, e não um `true` fixo (RN-DRIVER-003)", async () => {
    const api = fakeApi();
    api.on("POST api/user/drivers/ibm-data-server/install", () => new Response(null, { status: 202 }));

    await installDriver("ibm-data-server", false);

    expect(api.calls[0].body).toEqual({ acceptedLicense: false });
  });

  it("cancelar é DELETE em /install, e remover é DELETE no driver; o identificador vai codificado", async () => {
    const api = fakeApi();
    api.on("DELETE api/user/drivers/ibm%2Fx/install", () => new Response(null, { status: 204 }));
    api.on("DELETE api/user/drivers/ibm%2Fx", () => new Response(null, { status: 204 }));

    expect((await cancelDriverInstall("ibm/x")).ok).toBe(true);
    expect((await removeDriver("ibm/x")).ok).toBe(true);
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["DELETE api/user/drivers/ibm%2Fx/install", "DELETE api/user/drivers/ibm%2Fx"]);
  });

  it("uma recusa chega com o código da API", async () => {
    const api = fakeApi();
    api.on("POST api/user/drivers/ibm-data-server/install", () => new Response(JSON.stringify({ type: "DRIVER_LICENSE_NOT_ACCEPTED", title: "Aceite a licença.", status: 422 }), { status: 422 }));

    expect(await installDriver("ibm-data-server", true)).toMatchObject({ ok: false, error: { status: 422, code: "DRIVER_LICENSE_NOT_ACCEPTED", title: "Aceite a licença." } });
  });
});

describe("a consulta periódica da lista (item D)", () => {
  it("consulta de novo a cada segundo enquanto baixa e PARA quando nenhum driver baixa mais", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const installing = item({ state: "installing", progress: { receivedBytes: 10, totalBytes: 100 } });
    api.on("GET api/user/drivers", list(installing));
    api.on("GET api/user/drivers", list(installing));
    api.on("GET api/user/drivers", list(item({ state: "installed", restartRequired: true })));

    const client = new QueryClient();
    const unsubscribe = new QueryObserver(client, driversQuery).subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(api.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.calls).toHaveLength(3);

    // Instalado: ninguém baixa mais, e nenhuma consulta nova sai, por mais que o tempo passe.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.calls).toHaveLength(3);
    expect(client.getQueryData<Driver[]>(driversQuery.queryKey)?.[0]).toMatchObject({ state: "installed", restartRequired: true });

    unsubscribe();
  });

  it("sem nenhum driver baixando desde o começo, é uma consulta só", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    api.on("GET api/user/drivers", list(item(), item({ id: "pg", state: "bundled" })));

    const unsubscribe = new QueryObserver(new QueryClient(), driversQuery).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.calls).toHaveLength(1);
    unsubscribe();
  });
});

describe("watchDriverTransitions: o que o cache de drivers viu mudar (itens D, E e F)", () => {
  const handlers = () => ({ onRestartRequired: vi.fn(), onInstallFailed: vi.fn() });
  const parsed = (...items: Record<string, unknown>[]): Driver[] => items as unknown as Driver[];

  it("avisa que o reinício é necessário quando a instalação termina", () => {
    const client = new QueryClient();
    const seen = handlers();
    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installing" })));
    const stop = watchDriverTransitions(client, seen);

    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installed", restartRequired: true })));

    expect(seen.onRestartRequired).toHaveBeenCalledTimes(1);
    expect(seen.onInstallFailed).not.toHaveBeenCalled();
    stop();
  });

  it("avisa da falha, com o driver e a causa, uma vez só", () => {
    const client = new QueryClient();
    const seen = handlers();
    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installing" })));
    const stop = watchDriverTransitions(client, seen);

    const failed = parsed(item({ state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão caiu." } }));
    client.setQueryData(driversQuery.queryKey, failed);
    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão caiu." } })));

    expect(seen.onInstallFailed).toHaveBeenCalledTimes(1);
    expect(seen.onInstallFailed.mock.calls[0][0]).toMatchObject({ id: "ibm-data-server", error: { detail: "A conexão caiu." } });
    expect(seen.onRestartRequired).not.toHaveBeenCalled();
    stop();
  });

  it("a primeira lista que chega, mesmo com reinício pendente, não é uma transição; depois de parar de observar, nada é avisado", () => {
    const client = new QueryClient();
    const seen = handlers();
    const stop = watchDriverTransitions(client, seen);

    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installed", restartRequired: true })));
    expect(seen.onRestartRequired).not.toHaveBeenCalled();

    stop();
    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installed", restartRequired: false })));
    client.setQueryData(driversQuery.queryKey, parsed(item({ state: "installed", restartRequired: true })));
    expect(seen.onRestartRequired).not.toHaveBeenCalled();
  });

  it("outras consultas do cache não são o que ele observa", () => {
    const client = new QueryClient();
    const seen = handlers();
    const stop = watchDriverTransitions(client, seen);

    client.setQueryData(["folders"], []);
    client.setQueryData(["connections"], []);

    expect(seen.onRestartRequired).not.toHaveBeenCalled();
    stop();
  });
});
