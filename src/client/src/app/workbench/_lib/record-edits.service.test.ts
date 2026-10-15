import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editTargetOrRefuse, previewEditsOrRefuse, saveEditsOrRefuse } from "./record-edits.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

const target = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [{ table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null }],
  rowOperations: true,
  oneAtATime: false,
};

/** Troca o `fetch` por um que devolve a resposta dada e guarda o que recebeu. */
function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string, extensions: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, detail: "mensagem do banco", ...extensions }), { status, headers: { "Content-Type": "application/problem+json" } });

const request = (fake: ReturnType<typeof fetchAnswers>) => {
  const [url, init] = fake.mock.calls[0];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
};

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("edit-target (seção 22)", () => {
  it("pede pelo resultado da página e pela sessão da árvore da mesma conexão, e lê as tabelas e as colunas", async () => {
    const fake = fetchAnswers(json(target));

    expect(await editTargetOrRefuse("s 1", "r1", "arvore")).toEqual({ ok: true, data: target });
    expect(request(fake)).toEqual({ url: `${base}/api/user/database-sessions/s%201/queries/edit-target`, method: "POST", body: { resultID: "r1", catalogSessionID: "arvore" } });
  });

  it("sem a sessão da árvore, o corpo leva só o resultado", async () => {
    const fake = fetchAnswers(json(target));

    await editTargetOrRefuse("s1", "r1", null);

    expect(request(fake).body).toEqual({ resultID: "r1" });
  });

  it("o resultado só leitura volta como valor, com o motivo; a API fora do ar lança e vai ao aviso central", async () => {
    fetchAnswers(refusal(422, "RESULT_NOT_EDITABLE", { reason: "DISTINCT" }));
    expect(await editTargetOrRefuse("s1", "r1", null)).toMatchObject({ ok: false, error: { code: "RESULT_NOT_EDITABLE", extensions: { reason: "DISTINCT" } } });

    fetchAnswers(refusal(500, "INTERNAL_SERVER_ERROR"));
    await expect(editTargetOrRefuse("s1", "r1", null)).rejects.toMatchObject({ error: { code: "INTERNAL_SERVER_ERROR" } });
  });

  it("uma resposta fora do formato não vira alvo", async () => {
    fetchAnswers(json({ tables: "x" }));

    await expect(editTargetOrRefuse("s1", "r1", null)).rejects.toMatchObject({ error: { code: "RESPONSE_INVALID" } });
  });
});

describe("edits e edits/preview (seção 22)", () => {
  const changes = [{ kind: "update" as const, table: 0, key: ["1"], set: [{ column: 1, value: null }] }];

  it("o Salvar manda o resultado e as alterações, e lê quantas foram gravadas", async () => {
    const fake = fetchAnswers(json({ applied: 1 }));

    expect(await saveEditsOrRefuse("s1", "r1", changes)).toEqual({ ok: true, data: { applied: 1 } });
    expect(request(fake)).toEqual({ url: `${base}/api/user/database-sessions/s1/queries/edits`, method: "POST", body: { resultID: "r1", changes } });
  });

  it.each(["EDIT_ROW_MISMATCH", "EDIT_INVALID", "SQL_EXECUTION_FAILED", "RESULT_CHANGED", "RESULT_NOT_EDITABLE", "SESSION_BUSY", "DATABASE_SESSION_NOT_FOUND"])("a recusa %s do Salvar volta como valor: a faixa a mostra", async (code) => {
    fetchAnswers(refusal(code === "RESULT_CHANGED" || code === "SESSION_BUSY" ? 409 : code === "DATABASE_SESSION_NOT_FOUND" ? 404 : 422, code, { change: 0 }));

    expect(await saveEditsOrRefuse("s1", "r1", changes)).toMatchObject({ ok: false, error: { code, detail: "mensagem do banco", extensions: { change: 0 } } });
  });

  it("o Ver SQL manda o mesmo pedido à rota dele e lê os comandos", async () => {
    const preview = { statements: [{ sql: "UPDATE \"loja\".\"pedido\" SET \"status\" = NULL WHERE \"id\" = 1", values: [] }], oneAtATime: false };
    const fake = fetchAnswers(json(preview));

    expect(await previewEditsOrRefuse("s1", "r1", changes)).toEqual({ ok: true, data: preview });
    expect(request(fake)).toEqual({ url: `${base}/api/user/database-sessions/s1/queries/edits/preview`, method: "POST", body: { resultID: "r1", changes } });
  });
});
