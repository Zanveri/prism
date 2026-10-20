import { describe, expect, it } from "vitest";

import {
  closeReasonSchema,
  resultWindowClosedSchema,
  resultWindowFocusSchema,
  resultWindowNameOf,
  resultWindowNamePattern,
  resultWindowNamedSchema,
  resultWindowReplySchema,
  resultWindowRequestSchema,
  resultWindowStateSchema,
  resultWindowTitleSchema,
} from "./result-window-messages";

const id = "0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e";
const name = resultWindowNameOf(id);

describe("o nome da janela do resultado (RN-ABAS-017)", () => {
  it("é `prism-result-` e o id da aba, e só esse formato casa, com âncora nas duas pontas", () => {
    expect(name).toBe(`prism-result-${id}`);
    expect(resultWindowNamePattern.test(name)).toBe(true);

    for (const bad of ["", "prism-result-", `prism-result-${id} `, ` prism-result-${id}`, `xprism-result-${id}`, `prism-result-${id}x`, `prism-result-${id.toUpperCase()}`, `prism-result-${id}\nx`, "prism-result-1234", "_blank", "prism-result-../etc"]) {
      expect(resultWindowNamePattern.test(bad)).toBe(false);
    }
  });
});

describe("o pedido da janela do resultado (prism:result-window-request)", () => {
  it("aceita o nome, o modo e o ponto (ou nulo)", () => {
    expect(resultWindowRequestSchema.safeParse({ name, mode: "focus", at: null }).success).toBe(true);
    expect(resultWindowRequestSchema.safeParse({ name, mode: "background", at: { x: 10, y: -20 } }).success).toBe(true);
  });

  it("recusa campo a mais, modo que não existe, nome fora do formato e ponto que não é número", () => {
    expect(resultWindowRequestSchema.safeParse({ name, mode: "focus", at: null, extra: 1 }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse({ name, mode: "front", at: null }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse({ name: "prism-result-x", mode: "focus", at: null }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse({ name, mode: "focus", at: { x: Number.NaN, y: 0 } }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse({ name, mode: "focus", at: { x: Number.POSITIVE_INFINITY, y: 0 } }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse({ name, mode: "focus" }).success).toBe(false);
    expect(resultWindowRequestSchema.safeParse(null).success).toBe(false);
  });

  it("a resposta é só se pode abrir", () => {
    expect(resultWindowReplySchema.safeParse({ ok: true }).success).toBe(true);
    expect(resultWindowReplySchema.safeParse({ ok: true, path: "/x" }).success).toBe(false);
  });
});

describe("os outros canais da janela do resultado", () => {
  it("pronta e fechar levam só o nome", () => {
    expect(resultWindowNamedSchema.safeParse({ name }).success).toBe(true);
    expect(resultWindowNamedSchema.safeParse({ name, extra: true }).success).toBe(false);
    expect(resultWindowNamedSchema.safeParse({ name: "outra" }).success).toBe(false);
  });

  it("trazer à frente leva o nome e, se quiser, qual das duas janelas", () => {
    expect(resultWindowFocusSchema.safeParse({ name }).success).toBe(true);
    expect(resultWindowFocusSchema.safeParse({ name, target: "opener" }).success).toBe(true);
    expect(resultWindowFocusSchema.safeParse({ name, target: "everyone" }).success).toBe(false);
  });

  it("o título é texto não vazio e limitado", () => {
    expect(resultWindowTitleSchema.safeParse({ name, title: "Resultado · consulta-2.sql — Prism" }).success).toBe(true);
    expect(resultWindowTitleSchema.safeParse({ name, title: "" }).success).toBe(false);
    expect(resultWindowTitleSchema.safeParse({ name, title: "x".repeat(501) }).success).toBe(false);
  });

  it("o aviso de que fechou diz quem fechou, e o de estado, se minimizou", () => {
    expect(closeReasonSchema.options).toEqual(["user", "host"]);
    expect(resultWindowClosedSchema.safeParse({ name, reason: "user" }).success).toBe(true);
    expect(resultWindowClosedSchema.safeParse({ name, reason: "system" }).success).toBe(false);
    expect(resultWindowStateSchema.safeParse({ name, minimized: true }).success).toBe(true);
    expect(resultWindowStateSchema.safeParse({ name, minimized: "yes" }).success).toBe(false);
  });
});
