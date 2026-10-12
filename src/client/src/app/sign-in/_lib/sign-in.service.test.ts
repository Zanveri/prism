import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowRefusal, ApiRequestError, userActionDeadlineMs } from "@/lib/api/prism-api";
import { errorToastFor } from "@/lib/api/query-client";
import { vaultLock } from "@/lib/api/vault-lock";

import { signInCopy } from "./sign-in.copy";
import { createUser, signInOrRefuse, signOut } from "./sign-in.service";

const bridge = { getApiConfig: async () => ({ baseUrl: "http://127.0.0.1:51234", token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const problem = (status: number, type: string) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status }), { status, headers: { "Content-Type": "application/problem+json" } });

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => {
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("signInOrRefuse: as recusas que o formulário de entrada mostra no próprio lugar", () => {
  const credentials = { userName: "ana", password: "uma-senha-qualquer" };

  it("INVALID_CREDENTIALS volta como valor (RN-COFRE-006)", async () => {
    vi.stubGlobal("fetch", async () => problem(401, "INVALID_CREDENTIALS"));

    expect(await signInOrRefuse(credentials)).toMatchObject({ ok: false, error: { status: 401, code: "INVALID_CREDENTIALS" } });
  });

  it("VAULT_FORMAT_UNSUPPORTED (409, cofre de um Prism mais novo) também volta como valor, e não vira aviso de erro (RN-VERSAO-005)", async () => {
    vi.stubGlobal("fetch", async () => problem(409, "VAULT_FORMAT_UNSUPPORTED"));

    expect(await signInOrRefuse(credentials)).toMatchObject({ ok: false, error: { status: 409, code: "VAULT_FORMAT_UNSUPPORTED" } });
  });

  it("qualquer outra recusa lança, para chegar ao aviso central (RN-AVISO-004)", async () => {
    vi.stubGlobal("fetch", async () => problem(503, "VAULT_UNAVAILABLE"));

    await expect(signInOrRefuse(credentials)).rejects.toMatchObject({ error: { code: "VAULT_UNAVAILABLE" } });
  });

  it("a frase de cofre mais novo manda atualizar o Prism, e não diz que a senha está errada", () => {
    expect(signInCopy.signIn.vaultFormatUnsupported).toBe("Este cofre foi criado por uma versão mais nova do Prism. Atualize o Prism para abri-lo.");
  });
});

describe("entrar e sair com o Prism bloqueado por inatividade (RN-SEG-001)", () => {
  it("são as saídas da tela de bloqueio: saem na hora, sem esperar o desbloqueio que elas mesmas fazem", async () => {
    const fetched = vi.fn(async (_url: string, init: RequestInit) => (init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ unlocked: true, userName: "ana" })));
    vi.stubGlobal("fetch", fetched);
    vaultLock.lock();

    expect(await signInOrRefuse({ userName: "ana", password: "uma-senha-qualquer" })).toEqual({ ok: true, data: { unlocked: true, userName: "ana" } });
    expect(await signOut()).toEqual({ ok: true, data: undefined });
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});

describe("signOut com prazo (o fechamento do cofre no bloqueio, RN-SEG-001)", () => {
  it("leva o sinal ao pedido: cancelado, o pedido volta como NETWORK_ERROR (ninguém fica esperando uma API que não responde)", async () => {
    const controller = new AbortController();
    const fetched = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetched);

    expect(await signOut(controller.signal)).toEqual({ ok: true, data: undefined });
    expect(fetched.mock.calls[0][1].signal).toBe(controller.signal);

    controller.abort();
    expect(await signOut(controller.signal)).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });
});

/** Um fetch que espera até o sinal cancelar, como o de verdade: com o sinal já cancelado ele rejeita na hora. */
const hangUntilAborted = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const fail = () => reject(new DOMException("timeout", "TimeoutError"));
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener("abort", fail);
  });

describe("o prazo das chamadas que a pessoa espera: Sair e Desbloquear (rodada 3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("o prazo tem folga para a derivação da senha (10 s ou mais) e devolve a tela logo quando a API para de responder (30 s, no máximo)", () => {
    expect(userActionDeadlineMs).toBeGreaterThanOrEqual(10_000);
    expect(userActionDeadlineMs).toBeLessThanOrEqual(30_000);
  });

  it("signOut sem sinal tem o prazo das chamadas da pessoa: AbortSignal.timeout com userActionDeadlineMs, e o sinal chega ao pedido (o \"Sair\" da barra superior e o da tela de bloqueio)", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetched = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetched);

    await signOut();

    expect(timeout).toHaveBeenCalledExactlyOnceWith(userActionDeadlineMs);
    expect(fetched.mock.calls[0][1]?.signal).toBe(signal);
  });

  it("estourado o prazo, o pedido é cancelado e volta como NETWORK_ERROR: ninguém fica esperando uma API que não responde", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", hangUntilAborted);

    const pending = signOut();
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });

  it("com sinal próprio (o fechamento do cofre no bloqueio, que repete e tem o prazo dele) signOut não cria outro prazo", async () => {
    const own = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetched = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetched);

    await signOut(own);

    expect(timeout).not.toHaveBeenCalled();
    expect(fetched.mock.calls[0][1]?.signal).toBe(own);
  });

  it("signInOrRefuse com sinal próprio (o Desbloquear da tela de bloqueio dá o dele) leva esse sinal ao pedido e não cria outro prazo", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetched = vi.fn<typeof fetch>(async () => Response.json({ unlocked: true, userName: "ana" }));
    vi.stubGlobal("fetch", fetched);

    await signInOrRefuse({ userName: "ana", password: "uma-senha-qualquer" }, signal);

    expect(timeout).not.toHaveBeenCalled();
    expect(fetched.mock.calls[0][1]?.signal).toBe(signal);
  });

  it("o prazo estourado no desbloqueio lança (NETWORK_ERROR): a tela diz que o serviço não respondeu, em vez de ficar em Desbloqueando…", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", hangUntilAborted);

    const pending = signInOrRefuse({ userName: "ana", password: "uma-senha-qualquer" }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ error: { code: "NETWORK_ERROR" } });
  });
});

describe("o prazo de 'Entrar' e de 'Criar usuário': com a API sem responder, o formulário não fica esperando para sempre", () => {
  const credentials = { userName: "ana", password: "uma-senha-qualquer" };

  afterEach(() => vi.restoreAllMocks());

  it("signInOrRefuse sem sinal (o formulário de entrada) tem o prazo das chamadas da pessoa, e o sinal chega ao pedido", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetched = vi.fn<typeof fetch>(async () => Response.json({ unlocked: true, userName: "ana" }));
    vi.stubGlobal("fetch", fetched);

    await signInOrRefuse(credentials);

    expect(timeout).toHaveBeenCalledExactlyOnceWith(userActionDeadlineMs);
    expect(fetched.mock.calls[0][1]?.signal).toBe(signal);
  });

  it("estourado o prazo, 'Entrar' lança NETWORK_ERROR: o botão volta a aceitar o clique e o aviso central diz que a API não respondeu", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", hangUntilAborted);

    const pending = signInOrRefuse(credentials);
    controller.abort();

    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toMatchObject({ error: { code: "NETWORK_ERROR" } });
    expect(errorToastFor(failure)).toEqual({ tone: "error", title: "Sem resposta da API." });
  });

  it("createUser sem sinal (o formulário de criar usuário) tem o mesmo prazo, e o sinal chega ao pedido", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetched = vi.fn<typeof fetch>(async () => Response.json({ unlocked: true, userName: "ana" }));
    vi.stubGlobal("fetch", fetched);

    expect(await createUser(credentials)).toEqual({ ok: true, data: { unlocked: true, userName: "ana" } });

    expect(timeout).toHaveBeenCalledExactlyOnceWith(userActionDeadlineMs);
    expect(fetched.mock.calls[0][1]?.signal).toBe(signal);
  });

  it("estourado o prazo, 'Criar usuário' volta como NETWORK_ERROR, que não é recusa de campo: o formulário a lança ao aviso central", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", hangUntilAborted);

    const pending = createUser(credentials);
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
    // O que o formulário faz com o resultado (`allowRefusal` com as três recusas de campo): esta não é uma delas.
    expect(() => allowRefusal(result, "USER_ALREADY_EXISTS", "USERNAME_INVALID", "PASSWORD_INVALID")).toThrow(ApiRequestError);
  });

  it("com sinal próprio, createUser não cria outro prazo", async () => {
    const own = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetched = vi.fn<typeof fetch>(async () => Response.json({ unlocked: true, userName: "ana" }));
    vi.stubGlobal("fetch", fetched);

    await createUser(credentials, own);

    expect(timeout).not.toHaveBeenCalled();
    expect(fetched.mock.calls[0][1]?.signal).toBe(own);
  });
});
