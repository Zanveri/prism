import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError, type ApiError } from "@/lib/api/prism-api";

import { createCredentialsRequests, credentialsHint, credentialsMissingCode, credentialsMissingField, missingCredentials, watchCredentialsMissing } from "./credentials-missing";

// A recusa de abrir a sessão da conexão sem usuário ou sem senha (RN-TRANSF-016): 422 no campo que falta, na forma do erro de campo.
const refusal = (field: "userName" | "password"): ApiError => ({
  status: 422,
  code: credentialsMissingCode,
  title: "Faltam o usuário ou a senha da conexão.",
  detail: null,
  errors: { [field]: [field === "userName" ? "Esta conexão não tem usuário gravado." : "Esta conexão não tem senha gravada."] },
  extensions: {},
});

describe("credentialsMissingField: o campo que falta, na recusa (RN-TRANSF-016)", () => {
  it("`userName` sem usuário, `password` com o usuário e sem a senha, no valor ou no erro lançado", () => {
    expect(credentialsMissingField(refusal("userName"))).toBe("userName");
    expect(credentialsMissingField(refusal("password"))).toBe("password");
    expect(credentialsMissingField(new ApiRequestError(refusal("userName")))).toBe("userName");
  });

  it("outra recusa, ou o que não é recusa da API, não é esta", () => {
    expect(credentialsMissingField({ ...refusal("userName"), code: "DATABASE_CONNECTION_FAILED" })).toBeNull();
    expect(credentialsMissingField(new Error("rede"))).toBeNull();
    expect(credentialsMissingField(null)).toBeNull();
  });
});

describe("a conexão gravada sem usuário e senha (RN-TRANSF-015)", () => {
  it("o que falta: o usuário (e a senha junto), só a senha, ou nada", () => {
    expect(missingCredentials({ userName: "", hasPassword: false })).toBe("userName");
    expect(missingCredentials({ userName: "datafix", hasPassword: false })).toBe("password");
    expect(missingCredentials({ userName: "datafix", hasPassword: true })).toBeNull();
  });

  it("a dica da linha ganha o fim; a linha não ganha marca", () => {
    expect(credentialsHint({ userName: "", hasPassword: false })).toBe(" · sem usuário e senha");
    expect(credentialsHint({ userName: "datafix", hasPassword: false })).toBe(" · sem senha");
    expect(credentialsHint({ userName: "datafix", hasPassword: true })).toBe("");
  });
});

describe("createCredentialsRequests: o pedido de abrir o “Editar conexão”", () => {
  it("um pedido só, o último; atendido, sai, se ainda é o mesmo", () => {
    const requests = createCredentialsRequests();
    const listener = vi.fn();
    const unsubscribe = requests.subscribe(listener);

    requests.request("c1");
    const first = requests.pending();
    expect(first).toEqual({ connectionId: "c1", seq: 1 });
    expect(requests.pending()).toBe(first);

    requests.request("c2");
    requests.take(1);
    expect(requests.pending()).toEqual({ connectionId: "c2", seq: 2 });
    requests.take(2);
    expect(requests.pending()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    requests.request("c3");
    requests.clear();
    expect(requests.pending()).toBeNull();
    unsubscribe();
  });
});

describe("watchCredentialsMissing: as sessões da árvore no cache (RN-TRANSF-016)", () => {
  async function failSession(queryClient: QueryClient, queryKey: readonly unknown[], error: unknown) {
    await queryClient
      .fetchQuery({
        queryKey,
        queryFn: () => {
          throw error;
        },
        retry: false,
      })
      .catch(() => undefined);
  }

  it("a sessão de qualquer banco da conexão recusada por faltar o usuário ou a senha pede o “Editar conexão” dela", async () => {
    const queryClient = new QueryClient();
    const requests = createCredentialsRequests();
    const stop = watchCredentialsMissing(queryClient, requests);

    await failSession(queryClient, ["database-session", "c1"], new ApiRequestError(refusal("userName")));
    expect(requests.pending()).toMatchObject({ connectionId: "c1" });

    await failSession(queryClient, ["database-session", "c2", { database: "outro" }], new ApiRequestError(refusal("password")));
    expect(requests.pending()).toMatchObject({ connectionId: "c2" });
    stop();
  });

  it("a falha de outro motivo, ou de outra consulta, não pede nada; parado, não observa mais", async () => {
    const queryClient = new QueryClient();
    const requests = createCredentialsRequests();
    const stop = watchCredentialsMissing(queryClient, requests);

    await failSession(queryClient, ["database-session", "c1"], new ApiRequestError({ ...refusal("userName"), code: "DATABASE_CONNECTION_FAILED", errors: null }));
    await failSession(queryClient, ["tree", "c1", "schemas"], new ApiRequestError(refusal("userName")));
    expect(requests.pending()).toBeNull();

    stop();
    await failSession(queryClient, ["database-session", "c3"], new ApiRequestError(refusal("userName")));
    expect(requests.pending()).toBeNull();
  });
});
