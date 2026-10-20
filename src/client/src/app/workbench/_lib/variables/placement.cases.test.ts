import { describe, expect, test } from "vitest";

import { loadCases, type Case } from "./cases-runner";
import { scriptItemAt, scriptItemCount, splitScript } from "./script-items";

type PlacementCase = Case & { blankLines?: boolean; cursors?: { offset: number; item: [string, string] | null }[]; count?: number };

// Os casos de `placement.cases.json`: onde a declaração vale (RN-VAR-001), nos três bancos. `value` são os itens do script, `[espécie, texto]`.
describe("placement", () => {
  test.each(loadCases<PlacementCase>("placement"))("$name", (c) => {
    const options = { blankLines: c.blankLines ?? true };
    const engine = c.engine ?? undefined;

    expect(splitScript(c.input, engine, options).map((item) => [item.kind, item.text])).toEqual(c.value);
    for (const { offset, item } of c.cursors ?? []) {
      const found = scriptItemAt(c.input, offset, engine, options);
      expect(found === null ? null : [found.kind, found.text], `o cursor em ${offset}`).toEqual(item);
    }
    if (c.count !== undefined) expect(scriptItemCount(c.input, engine)).toBe(c.count);
  });
});
