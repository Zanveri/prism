import { describe, expect, test } from "vitest";

import { bindCaseOutcome, loadCases, type BindingCase } from "./cases-runner";

// Os casos de `binding.cases.json` (RN-VAR-017 e 018): a troca dos `@nome` pelos marcadores de cada banco, os parâmetros com o tipo e o "SQL enviado". O script do caso
// tem as declarações e, no fim, o comando que se troca; `value` é `{ sql, params: [[tipo, valor, variável]] }` (ou `paramCount`), e `sent`, o texto do "SQL enviado".
describe("binding", () => {
  test.each(loadCases<BindingCase>("binding"))("$name", (c) => {
    const outcome = bindCaseOutcome(c);
    if (c.error !== undefined) expect(outcome).toEqual({ error: c.error });
    else {
      expect(outcome).not.toHaveProperty("error");
      const value = c.value as { sql: string; params?: unknown[]; paramCount?: number };
      const got = outcome as { value: { sql: string; params: unknown[] }; sent: string; header: string | null; rows: unknown[] };
      expect(got.value.sql).toBe(value.sql);
      if (value.params !== undefined) expect(got.value.params).toEqual(value.params);
      if (value.paramCount !== undefined) expect(got.value.params.length).toBe(value.paramCount);
      if (c.sent !== undefined) expect(got.sent).toBe(c.sent);
      if (c.sentHeader !== undefined) expect(got.header).toBe(c.sentHeader);
    }
  });
});
