import { describe, expect, it } from "vitest";

import { draftErrorDelayMs, draftErrorVisible, escapeDiscardsDraft } from "./use-draft";

describe("quando o erro de um campo digitado aparece", () => {
  it("o atraso é o de um instante: o '1' de '13' não pisca um erro", () => {
    expect(draftErrorDelayMs).toBeGreaterThanOrEqual(400);
    expect(draftErrorDelayMs).toBeLessThanOrEqual(1000);
  });

  it("texto válido nunca mostra erro", () => {
    expect(draftErrorVisible({ invalid: false, text: "13", settledFor: "13" })).toBe(false);
    expect(draftErrorVisible({ invalid: false, text: "13", settledFor: null })).toBe(false);
  });

  it("texto inválido só mostra o erro depois que o atraso passou PARA ESTE texto", () => {
    expect(draftErrorVisible({ invalid: true, text: "1", settledFor: null })).toBe(false);
    expect(draftErrorVisible({ invalid: true, text: "99", settledFor: "99" })).toBe(true);
  });

  it("um texto novo esconde o erro de novo, mesmo que o atraso do anterior tenha passado", () => {
    expect(draftErrorVisible({ invalid: true, text: "999", settledFor: "99" })).toBe(false);
  });
});

describe("o que o Esc faz num campo digitado", () => {
  it("com texto inválido, o primeiro Esc só descarta o rascunho (a tela não fecha)", () => {
    expect(escapeDiscardsDraft({ key: "Escape", invalid: true })).toBe(true);
  });

  it("com texto válido (já vale), o Esc segue para a tela, que fecha", () => {
    expect(escapeDiscardsDraft({ key: "Escape", invalid: false })).toBe(false);
  });

  it("outras teclas nunca descartam", () => {
    expect(escapeDiscardsDraft({ key: "Enter", invalid: true })).toBe(false);
    expect(escapeDiscardsDraft({ key: "a", invalid: true })).toBe(false);
  });
});
