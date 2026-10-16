import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelExports, exportsInProgress, forgetTransfer, getTransfer, isGone, listTransfers, startExport } from "./transfers.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };
const id = "0f8fad5b-d9cb-469f-a165-70867728950e";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status }), { status, headers: { "Content-Type": "application/problem+json" } });

/** Um item como a seção 6 o descreve: toda chave vem, nula quando não se aplica. */
const item = (change: Record<string, unknown> = {}) => ({
  id,
  kind: "export",
  connectionID: "c1",
  targetConnectionID: null,
  windowID: 1,
  state: "running",
  phase: "reading",
  rows: 10,
  committed: null,
  total: null,
  bytes: 512,
  size: null,
  uncertain: null,
  summary: null,
  error: null,
  reason: null,
  startedAt: "2026-10-16T14:30:05Z",
  finishedAt: null,
  ...change,
});

function answering(...responses: Response[]) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => responses.shift() ?? json({}));
  vi.stubGlobal("fetch", fake);
  return fake;
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("as rotas dos trabalhos (RN-EXPORT-016, seção 6)", () => {
  it("começar é o POST com o pedido, e o 202 traz o id", async () => {
    const fake = answering(json({ id }, 202));
    const request = { source: { kind: "table" as const, connectionID: "c1", schema: "s", table: "t" }, columns: [{ position: 0, name: "id" }], count: true, format: "csv" as const, options: {}, output: { bom: true, zip: false, clipboard: false }, windowID: 1 };

    expect(await startExport(request)).toEqual({ ok: true, data: { id } });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe(`${base}/api/user/transfers/exports`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it("o item tolera o que a tela não lê (os campos da importação) e uma fase que ela não conhece; o estado fora da lista é recusado", async () => {
    answering(json(item({ phase: "outra", summary: { rows: 1, bytes: 2, sheets: null, cutValues: 0, removedCharacters: 0, skippedRows: 0 } })));
    expect(await getTransfer(id)).toMatchObject({ ok: true, data: { id, state: "running", phase: null, rows: 10, bytes: 512, summary: { rows: 1 } } });

    answering(json(item({ state: "pausado" })));
    expect(await getTransfer(id)).toMatchObject({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });

  it("a lista deixa de fora o item que não confere, sem derrubar os outros; esquecer é o DELETE, e o 404 é `isGone`", async () => {
    answering(json([item(), { id: "x" }, item({ id: "outro", state: "done" })]));
    expect(await listTransfers()).toMatchObject({ ok: true, data: [{ id }, { id: "outro" }] });

    const fake = answering(refusal(404, "TRANSFER_NOT_FOUND"));
    const forgotten = await forgetTransfer(id);
    expect(isGone(forgotten)).toBe(true);
    expect(fake.mock.calls[0][0]).toBe(`${base}/api/user/transfers/${id}`);
    expect(fake.mock.calls[0][1].method).toBe("DELETE");
  });

  it("as em andamento para as saídas: as exportações que rodam e as prontas não entregues, de uma conexão quando pedida; sem resposta, nenhuma", async () => {
    answering(json([item(), item({ id: "b", state: "done", connectionID: "c2" }), item({ id: "c", state: "failed" }), item({ id: "d", kind: "import" })]));
    expect((await exportsInProgress()).map((transfer) => transfer.id)).toEqual([id, "b"]);

    answering(json([item(), item({ id: "b", state: "done", connectionID: "c2" })]));
    expect((await exportsInProgress("c2")).map((transfer) => transfer.id)).toEqual(["b"]);

    answering(refusal(500, "INTERNAL_SERVER_ERROR"));
    expect(await exportsInProgress()).toEqual([]);
  });

  it("cancelar várias manda um DELETE por trabalho e espera todos", async () => {
    const fake = answering(new Response(null, { status: 204 }), refusal(404, "TRANSFER_NOT_FOUND"));
    await cancelExports([{ id: "a" }, { id: "b" }]);
    expect(fake.mock.calls.map(([url, init]) => `${init.method} ${url}`).sort()).toEqual([`DELETE ${base}/api/user/transfers/a`, `DELETE ${base}/api/user/transfers/b`]);
  });
});
