import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sqlTargetOf } from "./record-edits.schema";
import { countWholeColumnOrRefuse, editTargetOrRefuse, previewEditsOrRefuse, saveEditsOrRefuse, sqlTargetOrRefuse } from "./record-edits.service";

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

describe("edit-target do Gerar SQL (RN-GRADE-020)", () => {
  const sqlTarget = { ...target, tables: [{ ...target.tables[0], kind: "table", keyColumns: ["id"] }] };

  it("pede com purpose sql, e lê o tipo e a chave pelo nome de cada tabela", async () => {
    const fake = fetchAnswers(json(sqlTarget));

    expect(await sqlTargetOrRefuse("s1", "r1", "arvore")).toEqual({ ok: true, data: sqlTarget });
    expect(request(fake).body).toEqual({ resultID: "r1", catalogSessionID: "arvore", purpose: "sql" });
  });

  it("sem a sessão da árvore, o corpo leva o resultado e o pedido; o tipo que a tela não conhece vale other", async () => {
    const fake = fetchAnswers(json({ ...sqlTarget, tables: [{ ...sqlTarget.tables[0], kind: "sinônimo" }] }));

    const answer = await sqlTargetOrRefuse("s1", "r1", null);

    expect(request(fake).body).toEqual({ resultID: "r1", purpose: "sql" });
    expect(answer.ok ? answer.data.tables[0].kind : null).toBe("other");
  });

  it("a resposta sem o keyColumns não serve ao Gerar SQL", async () => {
    fetchAnswers(json(target));

    await expect(sqlTargetOrRefuse("s1", "r1", null)).rejects.toMatchObject({ error: { code: "RESPONSE_INVALID" } });
  });

  it("o resultado só leitura e o que mudou voltam como valor; a API fora do ar lança e vai ao aviso central", async () => {
    fetchAnswers(refusal(422, "RESULT_NOT_EDITABLE", { reason: "DISTINCT" }));
    expect(await sqlTargetOrRefuse("s1", "r1", null)).toMatchObject({ ok: false, error: { code: "RESULT_NOT_EDITABLE" } });
    fetchAnswers(refusal(409, "RESULT_CHANGED"));
    expect(await sqlTargetOrRefuse("s1", "r1", null)).toMatchObject({ ok: false, error: { code: "RESULT_CHANGED" } });

    fetchAnswers(refusal(500, "INTERNAL_SERVER_ERROR"));
    await expect(sqlTargetOrRefuse("s1", "r1", null)).rejects.toMatchObject({ error: { code: "INTERNAL_SERVER_ERROR" } });
  });

  it("o alvo que a edição já pediu serve ao Gerar SQL quando traz o tipo e a chave pelo nome; o de antes, sem eles, não", async () => {
    fetchAnswers(json(sqlTarget));
    const edit = await editTargetOrRefuse("s1", "r1", null);

    expect(edit.ok ? sqlTargetOf(edit.data) : null).toEqual(sqlTarget);
    expect(sqlTargetOf(target)).toBeNull();
    expect(sqlTargetOf(null)).toBeNull();
  });
});

describe("a coluna inteira nas rotas da edição (RN-EDIT-019 e 023)", () => {
  const updateAll = { kind: "updateAll" as const, table: 0, set: [{ column: 2, value: "10.00" }] };

  it("a contagem vai por `queries/edits/count`, com só a coluna inteira, e lê as linhas", async () => {
    const fake = fetchAnswers(json({ rows: 1234, transaction: { mode: "autocommit" } }));

    expect(await countWholeColumnOrRefuse("s1", "r1", [updateAll])).toEqual({ ok: true, data: { rows: 1234 } });
    expect(request(fake)).toEqual({ url: `${base}/api/user/database-sessions/s1/queries/edits/count`, method: "POST", body: { resultID: "r1", changes: [updateAll] } });
  });

  it("as recusas da contagem voltam como valor, com o motivo da coluna inteira e o desfecho do cancelamento", async () => {
    fetchAnswers(refusal(422, "EDIT_ALL_ROWS_NOT_SUPPORTED", { change: 0, column: 0, reason: "id é da chave de pedido" }));
    expect(await countWholeColumnOrRefuse("s1", "r1", [updateAll])).toMatchObject({ ok: false, error: { code: "EDIT_ALL_ROWS_NOT_SUPPORTED", extensions: { reason: "id é da chave de pedido" } } });

    fetchAnswers(refusal(422, "SQL_EXECUTION_FAILED", { outcome: "canceled" }));
    expect(await countWholeColumnOrRefuse("s1", "r1", [updateAll])).toMatchObject({ ok: false, error: { code: "SQL_EXECUTION_FAILED", extensions: { outcome: "canceled" } } });

    for (const code of ["RESULT_CHANGED", "TRANSACTION_FAILED", "SESSION_BUSY"]) {
      fetchAnswers(refusal(409, code));
      expect(await countWholeColumnOrRefuse("s1", "r1", [updateAll])).toMatchObject({ ok: false, error: { code } });
    }
    fetchAnswers(json({ rows: -1 }));
    await expect(countWholeColumnOrRefuse("s1", "r1", [updateAll])).rejects.toMatchObject({ error: { code: "RESPONSE_INVALID" } });
  });

  it("o Salvar leva a coluna inteira com o `rows` contado, e recebe a recusa dela como valor; o preview lê a nota de cada comando", async () => {
    const fake = fetchAnswers(json({ applied: 2 }));
    await saveEditsOrRefuse("s1", "r1", [{ ...updateAll, rows: 1234 }]);
    expect(request(fake).body).toEqual({ resultID: "r1", changes: [{ ...updateAll, rows: 1234 }] });

    fetchAnswers(refusal(422, "EDIT_ALL_ROWS_NOT_SUPPORTED", { change: 0, reason: "x" }));
    expect(await saveEditsOrRefuse("s1", "r1", [updateAll])).toMatchObject({ ok: false, error: { code: "EDIT_ALL_ROWS_NOT_SUPPORTED" } });

    fetchAnswers(json({ statements: [{ sql: "SELECT COUNT(*) FROM t", values: [], note: "A contagem confere." }, { sql: "UPDATE t SET c = 1", values: [] }, { sql: "x", values: [], note: 3 }], oneAtATime: false }));
    const preview = await previewEditsOrRefuse("s1", "r1", [updateAll]);
    expect(preview).toEqual({ ok: true, data: { statements: [{ sql: "SELECT COUNT(*) FROM t", values: [], note: "A contagem confere." }, { sql: "UPDATE t SET c = 1", values: [] }, { sql: "x", values: [], note: null }], oneAtATime: false } });
  });
});
