import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiRequestError, allowRefusal, apiRequest, onVaultLocked, unwrap, type ApiError } from "./prism-api";
import { vaultLock } from "./vault-lock";

const bridge = {
  getApiConfig: async () => ({ baseUrl: "http://127.0.0.1:51234", token: "token-de-teste" }),
  onApiExit: () => () => {},
  restartApi: async () => {},
};

/** Troca o `fetch` por um que devolve a resposta dada, ou falha com o erro dado. */
function fetchAnswers(answer: Response | Error) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

function problem(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ status, ...body }), { status, headers: { "Content-Type": "application/problem+json" } });
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => {
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("envia Authorization: Bearer com o token da ponte", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));

    await apiRequest("api/public/sessions", { method: "DELETE" });

    const [url, init] = fake.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:51234/api/public/sessions");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-de-teste");
  });

  it("envia o corpo em JSON com o método PUT (a troca de senha)", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));

    expect(await apiRequest("api/user/password", { method: "PUT", body: { currentPassword: "a", newPassword: "b" } })).toEqual({ ok: true, data: undefined });

    const [, init] = fake.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: "a", newPassword: "b" });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("resposta 200 que não passa no schema vira erro RESPONSE_INVALID, sem lançar", async () => {
    fetchAnswers(Response.json({ unlocked: "sim" }));

    const result = await apiRequest("api/public/sessions", { schema: z.object({ unlocked: z.boolean() }) });

    expect(result).toMatchObject({ ok: false, error: { status: 200, code: "RESPONSE_INVALID" } });
  });

  it("resposta 204 devolve ok sem dados", async () => {
    fetchAnswers(new Response(null, { status: 204 }));

    expect(await apiRequest("api/public/sessions", { method: "DELETE" })).toEqual({ ok: true, data: undefined });
  });

  it("erro em problem+json vira ApiError com code = type, title, detail e errors", async () => {
    fetchAnswers(problem(422, { type: "CONNECTION_INVALID", title: "Conexão inválida.", detail: "Confira os campos.", errors: { Name: ["Informe o nome."], Port: ["A porta vai de 1 a 65535."] } }));

    const result = await apiRequest("api/user/connections", { method: "POST", body: { name: "" } });

    // As chaves de `errors` chegam com o nome da propriedade em C# e saem na caixa que o formulário usa.
    expect(result).toEqual({
      ok: false,
      error: { status: 422, code: "CONNECTION_INVALID", title: "Conexão inválida.", detail: "Confira os campos.", errors: { name: ["Informe o nome."], port: ["A porta vai de 1 a 65535."] }, extensions: {} },
    });
  });

  it("erro sem detail nem errors vira ApiError com os dois nulos", async () => {
    fetchAnswers(problem(409, { type: "FOLDER_NOT_EMPTY", title: "A pasta não está vazia." }));

    expect(await apiRequest("api/user/folders/1", { method: "DELETE" })).toEqual({ ok: false, error: { status: 409, code: "FOLDER_NOT_EMPTY", title: "A pasta não está vazia.", detail: null, errors: null, extensions: {} } });
  });

  it("os campos extras do corpo de erro ficam em extensions, sem os do próprio problem+json", async () => {
    fetchAnswers(problem(422, { type: "SQL_EXECUTION_FAILED", title: "O banco recusou o comando.", detail: "ERROR: syntax error at or near \"form\"", instance: "/api/user/database-sessions/s1/queries", sqlState: "42601", position: 10 }));

    const result = await apiRequest("api/user/database-sessions/s1/queries", { method: "POST", body: { sql: "select 1 form t" } });

    expect(result).toEqual({
      ok: false,
      error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "O banco recusou o comando.", detail: "ERROR: syntax error at or near \"form\"", errors: null, extensions: { sqlState: "42601", position: 10 } },
    });
  });

  it("erro cujo corpo não é problem+json vira RESPONSE_INVALID com o status da resposta", async () => {
    fetchAnswers(new Response("<html>Bad Gateway</html>", { status: 502 }));

    expect(await apiRequest("api/user/folders")).toMatchObject({ ok: false, error: { status: 502, code: "RESPONSE_INVALID" } });
  });

  it("401 VAULT_LOCKED chama os ouvintes de onVaultLocked", async () => {
    const listener = vi.fn();
    const stop = onVaultLocked(listener);

    fetchAnswers(problem(401, { type: "AUTHENTICATION_REQUIRED", title: "Autenticação necessária." }));
    await apiRequest("api/user/folders");
    expect(listener).not.toHaveBeenCalled();

    fetchAnswers(problem(401, { type: "VAULT_LOCKED", title: "Cofre fechado." }));
    await apiRequest("api/user/folders");
    expect(listener).toHaveBeenCalledOnce();

    stop();
    fetchAnswers(problem(401, { type: "VAULT_LOCKED", title: "Cofre fechado." }));
    await apiRequest("api/user/folders");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("falha de rede vira ApiError com code NETWORK_ERROR", async () => {
    fetchAnswers(new TypeError("fetch failed"));

    expect(await apiRequest("api/user/folders")).toMatchObject({ ok: false, error: { status: 0, code: "NETWORK_ERROR", errors: null } });
  });
});

describe("unwrap", () => {
  it("unwrap devolve data quando ok e lança ApiRequestError com o ApiError quando não", () => {
    const error: ApiError = { status: 409, code: "FOLDER_NOT_EMPTY", title: "A pasta não está vazia.", detail: null, errors: null, extensions: {} };

    expect(unwrap({ ok: true, data: { id: 7 } })).toEqual({ id: 7 });

    let thrown: unknown;
    try {
      unwrap({ ok: false, error });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect((thrown as ApiRequestError).error).toBe(error);
  });
});

describe("allowRefusal", () => {
  const refusal: ApiError = { status: 401, code: "INVALID_CREDENTIALS", title: "Usuário ou senha inválidos.", detail: null, errors: null, extensions: {} };

  it("código permitido volta como valor, para o formulário mostrar no lugar", () => {
    const result = { ok: false, error: refusal } as const;

    expect(allowRefusal(result, "INVALID_CREDENTIALS")).toBe(result);
  });

  it("código que não está na lista lança ApiRequestError com o ApiError, para o aviso central", () => {
    const unavailable: ApiError = { status: 503, code: "VAULT_UNAVAILABLE", title: "O cofre não pôde ser lido.", detail: null, errors: null, extensions: {} };

    let thrown: unknown;
    try {
      allowRefusal({ ok: false, error: unavailable }, "INVALID_CREDENTIALS", "USER_ALREADY_EXISTS");
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect((thrown as ApiRequestError).error).toBe(unavailable);
  });

  it("sucesso passa direto, mesmo sem código nenhum", () => {
    const result = { ok: true, data: { unlocked: true } } as const;

    expect(allowRefusal(result)).toBe(result);
  });
});

describe("apiRequest com o Prism bloqueado por inatividade (RN-SEG-001)", () => {
  it("o pedido espera o desbloqueio, e só então sai: o cofre está fechado e a resposta seria 401", async () => {
    const fake = fetchAnswers(Response.json([]));
    vaultLock.lock();

    const result = apiRequest("api/user/folders");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake).not.toHaveBeenCalled();

    vaultLock.unlock();

    expect(await result).toEqual({ ok: true, data: undefined });
    expect(fake).toHaveBeenCalledOnce();
  });

  it("entrar e sair (whileLocked) saem na hora: são o caminho da tela de bloqueio", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));
    vaultLock.lock();

    expect(await apiRequest("api/public/sessions", { method: "DELETE", whileLocked: true })).toEqual({ ok: true, data: undefined });
    expect(fake).toHaveBeenCalledOnce();
  });

  it("o pedido cancelado enquanto espera volta como NETWORK_ERROR, sem chamar a API", async () => {
    const fake = fetchAnswers(Response.json([]));
    vaultLock.lock();
    const controller = new AbortController();

    const result = apiRequest("api/user/folders", { signal: controller.signal });
    controller.abort();

    expect(await result).toMatchObject({ ok: false, error: { status: 0, code: "NETWORK_ERROR" } });
    expect(fake).not.toHaveBeenCalled();
  });

  it("um 401 VAULT_LOCKED que chega depois do bloqueio (um pedido que já estava a caminho) não manda ao login: o cofre fechou de propósito", async () => {
    const heard = vi.fn();
    const stop = onVaultLocked(heard);
    vaultLock.lock();

    fetchAnswers(problem(401, { type: "VAULT_LOCKED", title: "Cofre fechado." }));
    const result = await apiRequest("api/user/folders", { whileLocked: true });

    expect(result).toMatchObject({ ok: false, error: { status: 401, code: "VAULT_LOCKED" } });
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
