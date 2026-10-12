import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import type { Driver } from "./drivers.schema";
import { pollInterval, resetDriversPolling } from "./drivers.polling";
import { driversKey } from "./drivers.service";
import { createInstallFlow } from "./install-driver-flow";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const ibm: Driver = {
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state: "available",
  version: "12.1.3",
  sizeBytes: 115343360,
  license: { name: "IBM International Program License Agreement", url: "https://exemplo.local/licenca-ibm" },
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
};

type Call = { method: string; path: string; body: unknown };

/** Troca o `fetch` por um que responde o que o teste combinou para a rota de instalar, e guarda as chamadas. */
function fakeApi(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", path: url.replace(`${base}/`, ""), body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined });
    return answer();
  });
  return calls;
}

const accepted = () => new Response(null, { status: 202 });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });

function setup(driver: Driver = ibm) {
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const queryClient: QueryClient = createQueryClient(toast);
  queryClient.setQueryData(driversKey, [driver]);
  const onClose = vi.fn();
  const flow = createInstallFlow({ driver, queryClient, toast, onClose });
  return { flow, toast, onClose, queryClient };
}

beforeEach(() => {
  vi.stubGlobal("window", { prism: bridge });
  resetDriversPolling();
});
afterEach(() => vi.unstubAllGlobals());

describe("o diálogo de instalação, com estado (item C)", () => {
  it("começa sem aceite, sem pedido em andamento e sem recusa", () => {
    expect(setup().flow.getState()).toEqual({ accepted: false, pending: false, refusal: null });
  });

  it("confirmar SEM o aceite não envia nada: o atributo `disabled` não é a única barreira (RN-DRIVER-003)", async () => {
    const calls = fakeApi(accepted);
    const { flow, onClose } = setup();

    await flow.confirm();

    expect(calls).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marcar e desmarcar o aceite vale até confirmar: desmarcado, nada é enviado", async () => {
    const calls = fakeApi(accepted);
    const { flow } = setup();

    flow.setAccepted(true);
    flow.setAccepted(false);
    await flow.confirm();

    expect(flow.getState().accepted).toBe(false);
    expect(calls).toEqual([]);
  });

  it("marcado e confirmado: POST com o aceite, aviso, a lista marcada para buscar de novo, a consulta ligada e o diálogo fecha", async () => {
    const calls = fakeApi(accepted);
    const { flow, toast, onClose, queryClient } = setup();

    flow.setAccepted(true);
    await flow.confirm();

    expect(calls).toEqual([{ method: "POST", path: "api/user/drivers/ibm-data-server/install", body: { acceptedLicense: true } }]);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Download do driver IBM Data Server iniciado.");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(driversKey)?.isInvalidated).toBe(true);
    // Rede de segurança: a lista ainda pode trazer `available` logo depois do 202, e a consulta fica ligada.
    expect(pollInterval([ibm])).toBe(1000);
  });

  it("enquanto o pedido roda o estado é 'pendente', e um segundo confirmar não envia outro", async () => {
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => (release = resolve));
    const calls = fakeApi(() => gate);
    const { flow } = setup();
    flow.setAccepted(true);

    const first = flow.confirm();
    expect(flow.getState().pending).toBe(true);
    await flow.confirm();
    flow.setAccepted(false);
    expect(flow.getState().accepted).toBe(true);

    release(accepted());
    await first;

    expect(calls).toHaveLength(1);
  });

  it("recusa da API por regra da seção 16: a mensagem dela fica no diálogo, que continua aberto, e o envio não se repete com o estado velho", async () => {
    const calls = fakeApi(() => problem(409, "DRIVER_INSTALL_IN_PROGRESS", { detail: "Aguarde o fim da instalação." }));
    const { flow, toast, onClose } = setup();
    flow.setAccepted(true);

    await flow.confirm();

    expect(flow.getState()).toEqual({ accepted: true, pending: false, refusal: "Aguarde o fim da instalação." });
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // A recusa vale até o diálogo fechar: nem confirmar de novo, nem desmarcar e marcar destravam.
    await flow.confirm();
    flow.setAccepted(false);
    flow.setAccepted(true);
    await flow.confirm();
    expect(calls).toHaveLength(1);
  });

  it.each(["DRIVER_LICENSE_NOT_ACCEPTED", "DRIVER_UNAVAILABLE", "DRIVER_ALREADY_INSTALLED", "DRIVER_INSTALL_IN_PROGRESS", "DRIVER_NOT_FOUND"])("%s é recusa mostrada no diálogo, sem aviso central", async (code) => {
    fakeApi(() => problem(code === "DRIVER_NOT_FOUND" ? 404 : 409, code));
    const { flow, toast } = setup();
    flow.setAccepted(true);

    await flow.confirm();

    expect(flow.getState().refusal).toBe(`Título de ${code}`);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("outra falha (500): o aviso central, sem recusa no diálogo, e dá para tentar de novo", async () => {
    let answers = [problem(500, "INTERNAL_SERVER_ERROR"), accepted()];
    const calls = fakeApi(() => answers.shift() ?? accepted());
    const { flow, toast, onClose } = setup();
    flow.setAccepted(true);

    await flow.confirm();

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de INTERNAL_SERVER_ERROR", undefined);
    expect(flow.getState()).toEqual({ accepted: true, pending: false, refusal: null });
    expect(onClose).not.toHaveBeenCalled();

    await flow.confirm();
    expect(calls).toHaveLength(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    answers = [];
  });

  it("sem licença no catálogo nada é enviado, nem com o aceite", async () => {
    const calls = fakeApi(accepted);
    const { flow } = setup({ ...ibm, license: null });
    flow.setAccepted(true);

    await flow.confirm();

    expect(calls).toEqual([]);
  });

  it("quem observa é avisado de cada mudança", async () => {
    fakeApi(accepted);
    const { flow } = setup();
    const listener = vi.fn();
    const stop = flow.subscribe(listener);

    flow.setAccepted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await flow.confirm();
    // Marcar, e o pedido a caminho. Aceito, o estado fica em "pendente" até o diálogo desmontar: não há segundo envio.
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    const seen = listener.mock.calls.length;
    flow.setAccepted(false);
    expect(listener).toHaveBeenCalledTimes(seen);
  });
});

describe("Copiar link", () => {
  it("copia o endereço da licença e avisa", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { flow, toast } = setup();

    await flow.copyLink();

    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://exemplo.local/licenca-ibm");
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Link copiado.");
  });

  it("se a área de transferência recusa, o aviso manda selecionar e copiar", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("negado"))) } });
    const { flow, toast } = setup();

    await flow.copyLink();

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith("Não foi possível copiar. Selecione o endereço e copie com Ctrl+C.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sem licença não há o que copiar", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { flow } = setup({ ...ibm, license: null });

    await flow.copyLink();

    expect(writeText).not.toHaveBeenCalled();
  });
});
