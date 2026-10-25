import { describe, expect, test } from "vitest";

import { evaluateCase, loadCases } from "./cases-runner";

// Os casos de `reader.cases.json` (escritos à mão, nunca regerados do código).
describe("reader", () => {
  test.each(loadCases("reader"))("$name", (c) => {
    const outcome = evaluateCase(c);
    if (c.error !== undefined) expect(outcome).toEqual({ error: c.error });
    else {
      expect(outcome).toMatchObject({ value: c.value, type: c.type });
      if (typeof c.exact === "string") expect(outcome).toHaveProperty("exact", c.exact);
    }
  });
});
