import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScriptOrRefuse, deleteScript, getScript, listScripts, renameScriptOrRefuse, overwriteScriptOrRefuse } from "./scripts.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const id = "0199c3a0-0000-7000-8000-000000000001";
const connectionID = "0199c3a0-0000-7000-8000-000000000002";
const summary = { id, name: "Fechamento", connectionID, database: "vendas", updatedAt: "2026-10-13T12:00:00Z" };

function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, errors: { Name: ["mensagem"] } }), { status, headers: { "Content-Type": "application/problem+json" } });

const request = (fake: ReturnType<typeof fetchAnswers>) => {
  const [url, init] = fake.mock.calls[0];
  return { url, method: init.method, body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) };
};

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("as rotas dos scripts (seção 23)", () => {
  it("a lista vem sem o SQL", async () => {
    const fake = fetchAnswers(json([summary, { ...summary, id: connectionID, connectionID: null, database: null }]));

    expect(await listScripts()).toEqual({ ok: true, data: [summary, { ...summary, id: connectionID, connectionID: null, database: null }] });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/scripts`, method: "GET" });
  });

  it("um item da lista com o SQL dentro é recusado: a lista não carrega o texto", async () => {
    fetchAnswers(json([{ ...summary, sql: "SELECT 1" }]));

    expect(await listScripts()).toMatchObject({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });

  it("o item vem com o SQL", async () => {
    const fake = fetchAnswers(json({ ...summary, sql: "SELECT * FROM pedidos" }));

    expect(await getScript(id)).toEqual({ ok: true, data: { ...summary, sql: "SELECT * FROM pedidos" } });
    expect(request(fake).url).toBe(`${base}/api/user/scripts/${id}`);
  });

  it("salvar a primeira vez manda o nome, o SQL e o lugar da aba", async () => {
    const fake = fetchAnswers(json(summary, 201));

    expect(await createScriptOrRefuse({ name: "Fechamento", sql: "SELECT 1", connectionID, database: "vendas" })).toEqual({ ok: true, data: summary });
    expect(request(fake)).toEqual({ url: `${base}/api/user/scripts`, method: "POST", body: { name: "Fechamento", sql: "SELECT 1", connectionID, database: "vendas" } });
  });

  it("gravar por cima manda o SQL e o lugar; renomear manda só o nome", async () => {
    let fake = fetchAnswers(json(summary));
    await overwriteScriptOrRefuse({ id, sql: "SELECT 2", connectionID: null, database: null });
    expect(request(fake)).toEqual({ url: `${base}/api/user/scripts`, method: "PATCH", body: { id, sql: "SELECT 2", connectionID: null, database: null } });

    fake = fetchAnswers(json(summary));
    await renameScriptOrRefuse(id, "Novo nome");
    expect(request(fake)).toEqual({ url: `${base}/api/user/scripts`, method: "PATCH", body: { id, name: "Novo nome" } });
  });

  it("excluir é o DELETE do item, e o 204 é sucesso", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));

    expect(await deleteScript(id)).toEqual({ ok: true, data: undefined });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/scripts/${id}`, method: "DELETE" });
  });

  it.each([
    [409, "SCRIPT_ALREADY_EXISTS"],
    [422, "SCRIPT_NAME_INVALID"],
    [422, "SCRIPT_TOO_LARGE"],
  ])("ao salvar, %s %s volta como valor, para o diálogo mostrar no lugar", async (status, code) => {
    fetchAnswers(refusal(status, code));

    expect(await createScriptOrRefuse({ name: "a", sql: "", connectionID: null, database: null })).toMatchObject({ ok: false, error: { code } });
    fetchAnswers(refusal(status, code));
    expect(await renameScriptOrRefuse(id, "a")).toMatchObject({ ok: false, error: { code } });
  });

  it("gravar por cima de um script que outra janela excluiu volta como valor (a tela pede o nome de novo); o resto lança e vai ao aviso central", async () => {
    fetchAnswers(refusal(404, "SCRIPT_NOT_FOUND"));
    expect(await overwriteScriptOrRefuse({ id, sql: "", connectionID: null, database: null })).toMatchObject({ ok: false, error: { code: "SCRIPT_NOT_FOUND" } });

    fetchAnswers(refusal(503, "VAULT_UNAVAILABLE"));
    await expect(createScriptOrRefuse({ name: "a", sql: "", connectionID: null, database: null })).rejects.toMatchObject({ error: { code: "VAULT_UNAVAILABLE" } });
  });
});
