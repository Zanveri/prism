import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { duplicateConnection, runConnectionTest, updateConnection, updateFolder } from "./connections.service";
import { newVerification, unprotected, type ConnectionInput } from "./connections.schema";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const input: ConnectionInput = { engine: 2, name: "MES", folderID: null, host: "srv", port: 50000, database: "mes", userName: "u", password: "s", environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification };

const answer = (status: number, type: string, detail?: string) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...(detail === undefined ? {} : { detail }) }), { status }));

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("runConnectionTest: as recusas que o formulário mostra no lugar", () => {
  it.each(["CONNECTION_INVALID", "DATABASE_CONNECTION_FAILED", "DRIVER_NOT_INSTALLED"])("%s volta como valor, para o formulário mostrar", async (code) => {
    answer(422, code, "mensagem");

    expect(await runConnectionTest(input)).toMatchObject({ ok: false, error: { status: 422, code, detail: "mensagem" } });
  });

  it("qualquer outra recusa lança, e vai ao aviso central", async () => {
    answer(404, "CONNECTION_NOT_FOUND");

    await expect(runConnectionTest(input)).rejects.toMatchObject({ error: { code: "CONNECTION_NOT_FOUND" } });
  });

  it("204 é a conexão testada", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));

    expect(await runConnectionTest(input)).toEqual({ ok: true, data: undefined });
  });
});

describe("duplicateConnection: \"Duplicar conexão\" (RN-CONN-016)", () => {
  const copy = { id: "0199e0a2-0000-7000-8000-000000000002", folderID: "0199e0a2-0000-7000-8000-0000000000f1", name: "MES (cópia)", engine: 2, host: "srv", port: 50000, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: "2026-10-13T12:00:00Z", updatedAt: "2026-10-13T12:00:00Z" };

  it("é um POST na rota da conexão, sem corpo (a senha é copiada dentro do cofre e não passa pela tela), e devolve a cópia", async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(copy), { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    expect(await duplicateConnection("c 1")).toEqual({ ok: true, data: copy });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${base}/api/user/connections/c%201/duplicate`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("a conexão que não existe mais volta como recusa (CONNECTION_NOT_FOUND)", async () => {
    answer(404, "CONNECTION_NOT_FOUND");

    expect(await duplicateConnection("c1")).toMatchObject({ ok: false, error: { status: 404, code: "CONNECTION_NOT_FOUND" } });
  });
});

describe("o PATCH da conexão e da pasta com a senha do somente leitura (RN-PROT-003)", () => {
  const saved = { ...copyOf(), id: "0199e0a2-0000-7000-8000-000000000001" };
  const folder = { id: "0199e0a2-0000-7000-8000-0000000000f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: "irreversible", readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "irreversible", confirmCommandsFolderID: null }, createdAt: "2026-10-15T12:00:00Z", updatedAt: "2026-10-15T12:00:00Z" };

  function copyOf() {
    return { folderID: null, name: "MES", engine: 2, host: "srv", port: 50000, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: true, ...newVerification, protections: { ...unprotected, readOnly: true }, createdAt: "2026-10-15T12:00:00Z", updatedAt: "2026-10-15T12:00:00Z" };
  }

  function sent(answerBody: unknown) {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(answerBody), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return () => JSON.parse(String(fetch.mock.calls[0][1].body)) as Record<string, unknown>;
  }

  it("a conexão vai por inteiro, com as proteções e a verificação, e a senha do usuário só quando foi pedida", async () => {
    const body = sent(saved);
    await updateConnection(saved.id, { ...input, readOnly: true }, "minha-senha");

    expect(body()).toMatchObject({ id: saved.id, confirmCommands: null, readOnly: true, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, userPassword: "minha-senha" });

    const without = sent(saved);
    await updateConnection(saved.id, input);
    expect(without()).not.toHaveProperty("userPassword");
  });

  it("a pasta vai por inteiro, com as proteções, e a senha do usuário só quando foi pedida", async () => {
    const body = sent(folder);
    await updateFolder(folder.id, { name: "Fábrica", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: "irreversible", readOnly: false }, "minha-senha");

    expect(body()).toEqual({ id: folder.id, name: "Fábrica", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: "irreversible", readOnly: false, userPassword: "minha-senha" });

    const without = sent(folder);
    await updateFolder(folder.id, { name: "Fábrica", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: "irreversible", readOnly: true });
    expect(without()).not.toHaveProperty("userPassword");
  });
});
