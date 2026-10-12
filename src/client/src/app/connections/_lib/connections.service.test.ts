import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runConnectionTest } from "./connections.service";
import type { ConnectionInput } from "./connections.schema";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const input: ConnectionInput = { engine: 2, name: "MES", folderID: null, host: "srv", port: 50000, database: "mes", userName: "u", password: "s", environmentName: null, environmentColor: null };

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
