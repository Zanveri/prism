import { describe, expect, test } from "vitest";

import { evaluateCase, loadCases } from "./cases-runner";

/** Uma impressão do que um ataque poderia mudar no ambiente: as propriedades de `Object.prototype` e de `Array.prototype` (nome, espécie e, nos dados, o valor) e os globais. */
function fingerprint(): string {
  const describeProperties = (target: object) =>
    Object.getOwnPropertyNames(target)
      .sort()
      .map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        const kind = descriptor && "value" in descriptor ? typeof descriptor.value : "accessor";
        return `${name}:${kind}:${descriptor?.writable}:${descriptor?.enumerable}:${descriptor?.configurable}${kind === "string" || kind === "number" ? `=${String(descriptor?.value)}` : ""}`;
      })
      .join("|");
  return [describeProperties(Object.prototype), describeProperties(Array.prototype), Object.getOwnPropertyNames(globalThis).sort().join("|")].join("\n");
}

// Os casos de `attacks.cases.json` (RN-VAR-014): cada ataque é recusado com a frase, e nada muda no ambiente (`Object.prototype`, `Array.prototype`, os globais).
describe("attacks", () => {
  test.each(loadCases("attacks"))("$name", (c) => {
    const before = fingerprint();
    const outcome = evaluateCase(c);

    if (c.error !== undefined) expect(outcome).toEqual({ error: c.error });
    else expect(outcome).toMatchObject({ value: c.value, type: c.type });

    expect(fingerprint()).toBe(before);
    expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
