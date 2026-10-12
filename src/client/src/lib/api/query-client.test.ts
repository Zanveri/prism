import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, type ApiError } from "./prism-api";
import { createQueryClient, errorToastFor } from "./query-client";
import { vaultLock } from "./vault-lock";

function apiError(error: Partial<ApiError>) {
  return new ApiRequestError({ status: 409, code: "FOLDER_NOT_EMPTY", title: "A pasta não está vazia.", detail: null, errors: null, extensions: {}, ...error });
}

describe("errorToastFor (RN-AVISO-004)", () => {
  it("errorToastFor de ApiRequestError devolve tom error com title e detail da API", () => {
    expect(errorToastFor(apiError({ detail: "Exclua ou mova o conteúdo antes." }))).toEqual({ tone: "error", title: "A pasta não está vazia.", description: "Exclua ou mova o conteúdo antes." });
    expect(errorToastFor(apiError({}))).toEqual({ tone: "error", title: "A pasta não está vazia." });
  });

  it("errorToastFor com meta.silent devolve null", () => {
    expect(errorToastFor(apiError({}), { silent: true })).toBeNull();
    expect(errorToastFor(new Error("qualquer"), { silent: true })).toBeNull();
  });

  it("errorToastFor de erro com errors de campo devolve null", () => {
    expect(errorToastFor(apiError({ status: 422, code: "CONNECTION_INVALID", title: "Conexão inválida.", errors: { name: ["Informe o nome."] } }))).toBeNull();
  });

  it('errorToastFor de VAULT_LOCKED devolve tom warning "Cofre fechado. Entre de novo."', () => {
    expect(errorToastFor(apiError({ status: 401, code: "VAULT_LOCKED", title: "Cofre fechado." }))).toEqual({ tone: "warning", title: "Cofre fechado. Entre de novo." });
  });

  it('errorToastFor de NETWORK_ERROR devolve "Sem resposta da API."', () => {
    expect(errorToastFor(apiError({ status: 0, code: "NETWORK_ERROR", title: "fetch failed" }))).toEqual({ tone: "error", title: "Sem resposta da API." });
  });

  it('errorToastFor de um Error qualquer devolve "Erro inesperado."', () => {
    expect(errorToastFor(new Error("Cannot read properties of undefined"))).toEqual({ tone: "error", title: "Erro inesperado." });
    expect(errorToastFor("texto solto")).toEqual({ tone: "error", title: "Erro inesperado." });
  });
});

describe("createQueryClient com o Prism bloqueado por inatividade (RN-SEG-001)", () => {
  afterEach(() => vaultLock.reset());

  const failing = () => Promise.reject(apiError({ status: 401, code: "VAULT_LOCKED", title: "Cofre fechado." }));

  it("a falha de uma consulta vira aviso, como sempre", async () => {
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    await createQueryClient(toast).fetchQuery({ queryKey: ["q"], queryFn: failing }).catch(() => undefined);

    expect(toast.warning).toHaveBeenCalledWith("Cofre fechado. Entre de novo.", undefined);
  });

  it("bloqueado, a falha não vira aviso: ninguém o vê, e ele apareceria já velho depois do desbloqueio", async () => {
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    vaultLock.lock();

    await createQueryClient(toast).fetchQuery({ queryKey: ["q"], queryFn: failing }).catch(() => undefined);

    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("createQueryClient sem rede no computador: a API é local (127.0.0.1), e a rede não tem nada a ver com ela", () => {
  // O navegador diz "sem rede" quando o computador perde o Wi-Fi ou o cabo. Por padrão a biblioteca então PÁRA toda consulta e toda mutação à espera
  // dela, e o Prism, que só fala com a própria API, ficaria sem responder a nada até a rede voltar.
  beforeEach(() => onlineManager.setOnline(false));
  afterEach(() => {
    onlineManager.setOnline(true);
    vaultLock.reset();
  });

  /** Espera um pouco e diz que a chamada seguia parada. */
  const stillWaiting = (ms: number) => new Promise<string>((resolve) => setTimeout(() => resolve("parada"), ms));

  const toast = () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() });

  it("a consulta sai do mesmo jeito e devolve o que a API respondeu", async () => {
    const client = createQueryClient(toast());

    const result = await Promise.race([client.fetchQuery({ queryKey: ["q"], queryFn: () => Promise.resolve("respondeu") }), stillWaiting(200)]);

    expect(result).toBe("respondeu");
  });

  it("a mutação, sem opção nenhuma, também sai: herda o padrão do cliente", async () => {
    const client = createQueryClient(toast());
    const observer = new MutationObserver<string, Error, void>(client, { mutationFn: () => Promise.resolve("respondeu") });

    const result = await Promise.race([observer.mutate(), stillWaiting(200)]);

    expect(result).toBe("respondeu");
  });

  it("a falha de uma chamada vira o aviso de sempre, e não fica à espera da rede", async () => {
    const messages = toast();
    const failing = () => Promise.reject(apiError({ status: 0, code: "NETWORK_ERROR", title: "fetch failed" }));

    await Promise.race([createQueryClient(messages).fetchQuery({ queryKey: ["q"], queryFn: failing }).catch(() => undefined), stillWaiting(200)]);

    expect(messages.error).toHaveBeenCalledWith("Sem resposta da API.", undefined);
  });

  it("as opções padrão dizem networkMode always nas consultas e nas mutações, e a consulta segue sem repetir", () => {
    const defaults = createQueryClient(toast()).getDefaultOptions();

    expect(defaults.queries).toMatchObject({ networkMode: "always", retry: false });
    expect(defaults.mutations).toMatchObject({ networkMode: "always" });
  });
});
