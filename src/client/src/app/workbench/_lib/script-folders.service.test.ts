import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScriptFolderOrRefuse, deleteScriptFolder, listScriptFolders, moveScriptFolder, renameScriptFolderOrRefuse } from "./script-folders.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const id = "0199ec00-0000-7000-8000-000000000001";
const parentID = "0199ec00-0000-7000-8000-000000000002";
const folder = { id, parentID: null, name: "Fechamento", createdAt: "2026-10-16T12:00:00Z", updatedAt: "2026-10-16T12:00:00Z" };

function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string, detail = "detalhe") => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, detail }), { status, headers: { "Content-Type": "application/problem+json" } });

const request = (fake: ReturnType<typeof fetchAnswers>) => {
  const [url, init] = fake.mock.calls[0];
  return { url, method: init.method, body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) };
};

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("as rotas das pastas de scripts (seção 33, RN-SCRIPT-007 a 009)", () => {
  it("a lista traz as pastas de todos os níveis", async () => {
    const fake = fetchAnswers(json([folder, { ...folder, id: parentID, parentID: id, name: "Mensal" }]));

    expect(await listScriptFolders()).toMatchObject({ ok: true, data: [{ id }, { id: parentID, parentID: id }] });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/script-folders`, method: "GET" });
  });

  it("criar manda o nome e a pasta pai; renomear manda a pasta pai que ela tem; mover manda o nome que ela tem", async () => {
    let fake = fetchAnswers(json(folder, 201));
    await createScriptFolderOrRefuse({ name: "Fechamento", parentID: null });
    expect(request(fake)).toEqual({ url: `${base}/api/user/script-folders`, method: "POST", body: { name: "Fechamento", parentID: null } });

    fake = fetchAnswers(json(folder));
    await renameScriptFolderOrRefuse({ id, parentID }, "Novo nome");
    expect(request(fake)).toEqual({ url: `${base}/api/user/script-folders`, method: "PATCH", body: { id, name: "Novo nome", parentID } });

    fake = fetchAnswers(json(folder));
    await moveScriptFolder({ id, name: "Fechamento" }, null);
    expect(request(fake)).toEqual({ url: `${base}/api/user/script-folders`, method: "PATCH", body: { id, name: "Fechamento", parentID: null } });
  });

  it("excluir é o DELETE do item, e o 204 é sucesso", async () => {
    const fake = fetchAnswers(new Response(null, { status: 204 }));

    expect(await deleteScriptFolder(id)).toEqual({ ok: true, data: undefined });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/script-folders/${id}`, method: "DELETE" });
  });

  it.each([
    [409, "SCRIPT_FOLDER_ALREADY_EXISTS"],
    [422, "SCRIPT_FOLDER_NAME_INVALID"],
  ])("ao criar e ao renomear, %s %s volta como valor, para o campo do nome", async (status, code) => {
    fetchAnswers(refusal(status, code));
    expect(await createScriptFolderOrRefuse({ name: "a", parentID: null })).toMatchObject({ ok: false, error: { code } });
    fetchAnswers(refusal(status, code));
    expect(await renameScriptFolderOrRefuse({ id, parentID: null }, "a")).toMatchObject({ ok: false, error: { code } });
  });

  it("a pasta pai que outra janela excluiu lança, com o detalhe da API: vai ao aviso central, e não ao campo", async () => {
    fetchAnswers(refusal(404, "SCRIPT_FOLDER_NOT_FOUND", "A pasta pai não existe mais."));

    await expect(createScriptFolderOrRefuse({ name: "a", parentID })).rejects.toMatchObject({ error: { code: "SCRIPT_FOLDER_NOT_FOUND", detail: "A pasta pai não existe mais." } });
  });

  it("a recusa da pasta que não está vazia volta com as contagens, que a tela não precisa ler", async () => {
    fetchAnswers(new Response(JSON.stringify({ type: "SCRIPT_FOLDER_NOT_EMPTY", title: "Pasta não está vazia.", status: 409, detail: "A pasta Fechamento tem 1 script.", folders: 0, scripts: 1 }), { status: 409, headers: { "Content-Type": "application/problem+json" } }));

    expect(await deleteScriptFolder(id)).toMatchObject({ ok: false, error: { code: "SCRIPT_FOLDER_NOT_EMPTY", detail: "A pasta Fechamento tem 1 script.", extensions: { folders: 0, scripts: 1 } } });
  });
});
