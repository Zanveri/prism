import { describe, expect, test } from "vitest";

import { loadCases, positionOutcome, type PositionCase } from "./cases-runner";

// Os casos de `positions.cases.json` (RN-SQL-009): a posição do erro do banco, que é a do texto enviado (com os marcadores), levada ao texto do editor. `sentSql` é o texto
// que foi ao banco, `dbPosition` a posição que o banco deu (em caracteres, de 1 em diante) e `value` a posição no editor (em unidades UTF-16, de 0 em diante).
describe("positions", () => {
  test.each(loadCases<PositionCase>("positions"))("$name", (c) => {
    const outcome = positionOutcome(c);
    expect(outcome.sql).toBe(c.sentSql);
    expect(outcome.offset).toBe(c.value);
    if (typeof c.at === "string") expect(c.input.slice(outcome.offset).startsWith(c.at)).toBe(true);
  });
});
