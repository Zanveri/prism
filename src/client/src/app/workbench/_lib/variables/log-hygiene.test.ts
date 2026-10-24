import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { reportInternalError } from "./boundary";
import { handleEvaluateRequest } from "./evaluator-service";
import { phrase } from "./variables.copy";
import type { EvaluateMessage, EvaluateRequest } from "./wire";

/** A higiene do que vai ao console (RN-VAR-036): nunca o texto do script, o valor de uma variável nem a mensagem de um erro. */

const secret = "SEGREDO-do-cliente-4711";

const request = (extra: Partial<EvaluateRequest> = {}): EvaluateRequest => ({
  id: 1,
  kind: "evaluate",
  source: `const senha = '${secret}'\nconst b = senha + 'x'`,
  engine: null,
  blankLines: true,
  indices: [0, 1],
  tab: [],
  counter: 0,
  seed: [1, 2, 3, 4],
  now: 0,
  ...extra,
});

describe("higiene do console", () => {
  const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) => ({ method, spy: vi.spyOn(console, method).mockImplementation(() => undefined) }));
  beforeEach(() => spies.forEach(({ spy }) => spy.mockClear()));
  afterEach(() => spies.forEach(({ spy }) => spy.mockClear()));

  const everything = () => JSON.stringify(spies.flatMap(({ spy }) => spy.mock.calls));

  test("a avaliação que corre bem não escreve nada", () => {
    const messages: EvaluateMessage[] = [];
    handleEvaluateRequest(request(), (message) => messages.push(message));
    expect(messages.at(-1)?.kind).toBe("done");
    expect(everything()).toBe("[]");
  });

  test("o erro do usuário (a frase na tela) não vai ao console", () => {
    const messages: EvaluateMessage[] = [];
    handleEvaluateRequest(request({ source: `const senha = '${secret}'\nconst b = [1][random.int(3, 3)]`, indices: [0, 1] }), (message) => messages.push(message));
    expect(JSON.stringify(messages)).toContain("não existe");
    expect(everything()).toBe("[]");
  });

  test("o defeito interno vai ao console só com o tipo do erro, nunca com o texto nem a mensagem", () => {
    const messages: EvaluateMessage[] = [];
    // A semente de quatro zeros faz o gerador lançar: um defeito, e não um erro do script.
    handleEvaluateRequest(request({ seed: [0, 0, 0, 0] }), (message) => messages.push(message));
    expect(messages).toEqual([{ id: 1, kind: "failed", message: phrase.internal("o script") }]);

    const logged = everything();
    expect(logged).toContain("RangeError");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("quatro zeros");
    expect(JSON.stringify(messages)).not.toContain(secret);
  });

  test("a aba malformada com o segredo dentro também só deixa o tipo", () => {
    const messages: EvaluateMessage[] = [];
    handleEvaluateRequest(request({ tab: [{ name: secret, value: { k: "x", v: secret } as never, type: { t: "number" }, declared: { t: "number" }, origin: "literal", at: 0, ms: 0, text: secret, order: 1 }] }), (message) => messages.push(message));
    expect(messages.at(-1)).toMatchObject({ kind: "failed", message: phrase.internal("o script") });
    expect(everything()).not.toContain(secret);
    expect(JSON.stringify(messages)).not.toContain(secret);
  });

  test("reportInternalError não repete a mensagem do erro", () => {
    expect(reportInternalError("x", new Error(secret))).toBe(phrase.internal("x"));
    expect(reportInternalError("x", secret)).toBe(phrase.internal("x"));
    expect(reportInternalError("x", { message: secret })).toBe(phrase.internal("x"));
    expect(everything()).not.toContain(secret);
    expect(everything()).toContain("Error");
  });
});

describe("a linguagem só escreve no console pela fronteira", () => {
  test("nenhum arquivo da linguagem, fora o boundary.ts, usa o console", () => {
    const folder = new URL("./", import.meta.url);
    const files = readdirSync(folder).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== "boundary.ts");
    expect(files.length).toBeGreaterThan(20);
    for (const name of files) expect(readFileSync(new URL(name, folder), "utf8"), name).not.toMatch(/\bconsole\s*[.[]/);
  });
});
