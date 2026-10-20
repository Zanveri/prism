import { describe, expect, it } from "vitest";

import { declarationOffset } from "./use-tab-variables";
import { readScript } from "./variables/script";

describe("declarationOffset: “Ir para a declaração” (RN-VAR-024)", () => {
  const text = "// o cliente\nlet cliente_id = 7\n\nconst inicio = 'x'\nselect @cliente_id;";
  const model = readScript(text, undefined, { blankLines: true });

  it("leva ao começo do nome na declaração", () => {
    expect(declarationOffset(model, "cliente_id")).toBe(text.indexOf("cliente_id"));
    expect(declarationOffset(model, "inicio")).toBe(text.indexOf("inicio"));
  });

  it("a variável que o texto não declara mais não tem para onde ir", () => {
    expect(declarationOffset(model, "sumiu")).toBeNull();
  });
});
