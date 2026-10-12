import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changePasswordOrRefuse } from "./account.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const input = { currentPassword: "senha-atual-secreta", newPassword: "senha-nova-secreta" };

/** Troca o `fetch` por um que devolve a resposta dada e guarda o que recebeu. */
function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const refusal = (status: number, type: string) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status }), { status, headers: { "Content-Type": "application/problem+json" } });

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("trocar a senha (PUT api/user/password, RN-COFRE-013)", () => {
  it("envia a senha atual e a nova, e mais nada, com o token de lançamento; 204 é a senha trocada", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));

    expect(await changePasswordOrRefuse(input)).toEqual({ ok: true, data: undefined });

    const [url, init] = fake.mock.calls[0];
    expect(url).toBe(`${base}/api/user/password`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: "senha-atual-secreta", newPassword: "senha-nova-secreta" });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-de-teste");
  });

  it.each([
    [422, "INVALID_PASSWORD"],
    [422, "PASSWORD_INVALID"],
    [422, "PASSWORD_UNCHANGED"],
    [401, "VAULT_LOCKED"],
  ])("%i %s volta como valor: o formulário mostra no próprio lugar (ou o aviso do quinto erro)", async (status, code) => {
    fetchAnswers(refusal(status, code));

    expect(await changePasswordOrRefuse(input)).toMatchObject({ ok: false, error: { status, code } });
  });

  it("qualquer outra falha lança e vai ao aviso central: o disco que falhou, a API fora do ar", async () => {
    fetchAnswers(refusal(503, "VAULT_UNAVAILABLE"));

    await expect(changePasswordOrRefuse(input)).rejects.toMatchObject({ error: { status: 503, code: "VAULT_UNAVAILABLE" } });
  });

  it("nenhuma senha vai parar no erro: nem na recusa que volta como valor, nem na falha que lança", async () => {
    fetchAnswers(refusal(422, "INVALID_PASSWORD"));
    const refused = await changePasswordOrRefuse(input);

    fetchAnswers(refusal(503, "VAULT_UNAVAILABLE"));
    const thrown = await changePasswordOrRefuse(input).catch((error: unknown) => error);

    for (const outcome of [refused, thrown]) expect(JSON.stringify(outcome, Object.getOwnPropertyNames(Object(outcome)))).not.toMatch(/senha-atual-secreta|senha-nova-secreta/);
  });
});
