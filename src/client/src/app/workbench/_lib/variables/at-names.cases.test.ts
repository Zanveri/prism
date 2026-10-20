import { describe, expect, test } from "vitest";

import { findAtReferences } from "./at-names";
import { loadCases, type Case } from "./cases-runner";

type AtCase = Case & { declared: string[]; hints?: [string, string][]; inBody?: boolean };

// Os casos de `at-names.cases.json` (RN-VAR-015 e 016): onde o `@nome` é variável e onde continua sendo SQL, nos três bancos. `input` é o comando, `declared` são os nomes
// declarados no script, `value` são os `@nome` (ou `@nome.campo`) que viram variável, e `hints` os que ficaram SQL e o editor avisa (`[espécie, texto]`).
describe("at-names", () => {
  test.each(loadCases<AtCase>("at-names"))("$name", (c) => {
    const scan = findAtReferences(c.input, c.engine ?? undefined, new Set(c.declared.map((name) => name.normalize("NFC"))));

    expect(scan.references.map((reference) => c.input.slice(reference.start, reference.field === null ? reference.end : reference.field.end))).toEqual(c.value);
    if (c.hints !== undefined) expect(scan.hints.map((hint) => [hint.kind, c.input.slice(hint.start, hint.end)])).toEqual(c.hints);
    expect(scan.inBody).toBe(c.inBody ?? false);
  });
});
