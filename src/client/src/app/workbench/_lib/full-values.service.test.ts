import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resultCells } from "./full-values.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, detail: "o resultado mudou" }), { status, headers: { "Content-Type": "application/problem+json" } });

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("o valor completo das células cortadas (RN-SQL-017)", () => {
  it("pede pela sessão e pelo resultado da página, com as células na ordem, e devolve os valores na mesma ordem", async () => {
    const fake = fetchAnswers(
      json({
        values: [
          { row: 205, column: 1, value: "x".repeat(50_000) },
          { row: 3, column: 2, value: null },
        ],
      }),
    );
    const cells = [
      { row: 205, column: 1 },
      { row: 3, column: 2 },
    ];

    const answer = await resultCells("s 1", "r1", cells, new AbortController().signal);

    expect(answer).toEqual({ ok: true, data: ["x".repeat(50_000), null] });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe(`${base}/api/user/database-sessions/s%201/results/r1/cells`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ cells });
  });

  it("uma célula que a resposta não traz fica sem valor completo, e não toma o valor de outra", async () => {
    fetchAnswers(json({ values: [{ row: 3, column: 2, value: "do outro" }] }));

    const answer = await resultCells(
      "s1",
      "r1",
      [
        { row: 205, column: 1 },
        { row: 3, column: 2 },
      ],
      new AbortController().signal,
    );

    expect(answer).toEqual({ ok: true, data: [null, "do outro"] });
  });

  it("a recusa volta como valor, com o código: quem chama decide", async () => {
    fetchAnswers(refusal(404, "RESULT_NOT_FOUND"));

    const answer = await resultCells("s1", "r1", [{ row: 0, column: 0 }], new AbortController().signal);

    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.code).toBe("RESULT_NOT_FOUND");
  });
});
