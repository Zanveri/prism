import { describe, expect, test } from "vitest";

import { bindCaseOutcome, evaluateCase, loadCases, type Case } from "./cases-runner";
import { splitScript } from "./script-items";

type InterfaceCase = Case & { check?: "itens" | "troca"; sent?: string };

// Os casos de `interfaces.cases.json` (RN-VAR-001, 002, 004, 011 e 016), escritos à mão: onde a `interface` e o `type Nome =` são itens, o valor na forma do tipo e a
// troca do `@c.endereco.cidade`. `check` diz o que o caso confere: os itens do script, a troca do último comando ou, sem ele, a última variável atribuída.
describe("interfaces e type", () => {
  test.each(loadCases<InterfaceCase>("interfaces"))("$name", (c) => {
    if (c.check === "itens") {
      expect(splitScript(c.input, c.engine ?? undefined, { blankLines: true }).map((item) => [item.kind, item.text])).toEqual(c.value);
      return;
    }
    const outcome = c.check === "troca" ? bindCaseOutcome(c) : evaluateCase(c);
    if (c.error !== undefined) {
      expect(outcome).toEqual({ error: c.error });
      return;
    }
    expect(outcome).not.toHaveProperty("error");
    if (c.check === "troca") {
      const got = outcome as { value: unknown; sent: string };
      expect(got.value).toEqual(c.value);
      if (c.sent !== undefined) expect(got.sent).toBe(c.sent);
    } else expect(outcome).toEqual({ value: c.value, type: c.type });
  });
});
