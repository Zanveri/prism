import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWorkspace } from "./workspace.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const connectionID = "0199c3a0-0000-7000-8000-000000000002";

function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** As abas como a API as devolve: cada uma com todos os campos, os do outro tipo nulos. */
const apiQuery = (sql: string) => ({ kind: "query", connectionID, database: null, sql, scriptID: null, dirty: false, sqlTooLarge: false, schema: null, table: null, view: null });
const apiTable = (table: string) => ({ kind: "table", connectionID, database: "vendas", sql: null, scriptID: null, dirty: false, sqlTooLarge: false, schema: "loja", table, view: "structure" });

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("a leitura das abas gravadas (GET api/user/workspace, RN-ABAS-006)", () => {
  it("lê as abas na ordem, cada uma só com os campos do tipo dela, e a ativa", async () => {
    const fake = fetchAnswers(json({ tabs: [apiQuery("SELECT 1"), apiTable("pedidos")], activeIndex: 1 }));

    expect(await getWorkspace()).toEqual({
      ok: true,
      data: {
        tabs: [
          { kind: "query", connectionID, database: null, sql: "SELECT 1", scriptID: null, dirty: false, sqlTooLarge: false },
          { kind: "table", connectionID, database: "vendas", schema: "loja", table: "pedidos", view: "structure" },
        ],
        activeIndex: 1,
      },
    });
    expect(fake.mock.calls[0][0]).toBe(`${base}/api/user/workspace`);
  });

  it("nada gravado é a lista vazia", async () => {
    fetchAnswers(json({ tabs: [], activeIndex: null }));

    expect(await getWorkspace()).toEqual({ ok: true, data: { tabs: [], activeIndex: null } });
  });

  it("a aba que não confere fica de fora, e a ativa continua apontando para a mesma aba (ou para a vizinha, se era ela)", async () => {
    fetchAnswers(json({ tabs: [{ kind: "grafico" }, apiQuery("SELECT 1"), apiTable("pedidos")], activeIndex: 2 }));
    expect(await getWorkspace()).toMatchObject({ ok: true, data: { activeIndex: 1 } });

    fetchAnswers(json({ tabs: [apiQuery("SELECT 1"), { ...apiQuery("x"), connectionID: "não é id" }, apiTable("pedidos")], activeIndex: 1 }));
    expect(await getWorkspace()).toMatchObject({ ok: true, data: { tabs: [{ kind: "query" }, { kind: "table" }], activeIndex: 1 } });
  });

  it("a resposta sem a forma de uma área de trabalho é recusada por inteiro", async () => {
    fetchAnswers(json([apiQuery("SELECT 1")]));

    expect(await getWorkspace()).toMatchObject({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });
});
