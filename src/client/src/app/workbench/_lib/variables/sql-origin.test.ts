import { describe, expect, test } from "vitest";

import { checkScript } from "./run";
import { readScript } from "./script";

// RN-VAR-004: o `sql` não pode vir, direta ou indiretamente, de uma consulta. A variável de consulta ainda é recusada com a frase provisória na linha dela, e por isso
// este arquivo olha todos os erros da conferência, e não só o primeiro (a tabela de casos mostra um só).
const errorsOf = (script: string) => checkScript(readScript(script, undefined, { blankLines: true }), () => 0, () => 0).map((error) => [error.line, error.column, error.message]);

describe("sql que vem de uma consulta", () => {
  const refusal = "Um valor sql não pode vir de uma consulta.";

  test("por uma variável", () => {
    expect(errorsOf("let n = (SELECT count(*) FROM pedido)\nconst t: sql = n")).toContainEqual([2, 16, refusal]);
  });

  test("por duas variáveis, numa conta", () => {
    expect(errorsOf("let n = (SELECT count(*) FROM pedido)\nconst m = n + 1\nconst t: sql = 'ped' + m")).toContainEqual([3, 16, refusal]);
  });

  test("por uma reatribuição", () => {
    expect(errorsOf("let n = 1\nn = (SELECT count(*) FROM pedido)\nconst t: sql = n")).toContainEqual([3, 16, refusal]);
  });

  test("uma variável que não vem de uma consulta não é recusada", () => {
    expect(errorsOf("const n = 'pedido'\nconst t: sql = n").map((error) => error[2])).not.toContain(refusal);
  });
});
