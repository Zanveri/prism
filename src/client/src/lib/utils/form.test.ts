import { describe, expect, it } from "vitest";
import { z } from "zod";

import { apiFieldErrors, fieldAria, firstFieldErrors, hasUnshownFieldErrors } from "./form";

describe("firstFieldErrors", () => {
  it("devolve a primeira mensagem de cada campo recusado, na ordem do schema", () => {
    const result = z.object({ userName: z.string().min(3, "curto").regex(/^a/, "letra"), password: z.string().min(1, "vazia") }).safeParse({ userName: "b", password: "" });

    expect(!result.success && firstFieldErrors(result.error)).toEqual({ userName: "curto", password: "vazia" });
  });

  it("o erro de um refine fica no campo do `path`", () => {
    const result = z
      .object({ a: z.string(), b: z.string() })
      .refine((value) => value.a === value.b, { path: ["b"], message: "diferente" })
      .safeParse({ a: "1", b: "2" });

    expect(!result.success && firstFieldErrors(result.error)).toEqual({ b: "diferente" });
  });
});

describe("apiFieldErrors", () => {
  it("fica com a primeira mensagem de cada campo que a API recusou", () => {
    expect(apiFieldErrors({ name: ["curto", "outra"], port: ["fora da faixa"] })).toEqual({ name: "curto", port: "fora da faixa" });
  });

  it("sem `errors`, nenhum campo", () => {
    expect(apiFieldErrors(null)).toEqual({});
  });
});

describe("hasUnshownFieldErrors", () => {
  const fields = ["name", "host", "port"];

  it("chaves que não casam com nenhum campo do formulário: a mensagem se perderia", () => {
    expect(hasUnshownFieldErrors({ Unknown: "x", other: "y" }, fields)).toBe(true);
  });

  it("todas as chaves casam com campos: o campo mostra, nada mais a fazer", () => {
    expect(hasUnshownFieldErrors({ name: "curto", port: "fora da faixa" }, fields)).toBe(false);
  });

  it("uma chave que casa e outra que não: a que não casa também se perderia", () => {
    expect(hasUnshownFieldErrors({ name: "curto", unknown: "x" }, fields)).toBe(true);
  });

  it("sem erro de campo, nada a mostrar", () => {
    expect(hasUnshownFieldErrors({}, fields)).toBe(false);
  });
});

describe("fieldAria", () => {
  it("com erro, marca o campo como inválido e o liga à mensagem `<id>-error`", () => {
    expect(fieldAria("cx-host", "Informe o host.")).toEqual({ "aria-invalid": true, "aria-describedby": "cx-host-error" });
  });

  it("sem erro, não põe nenhum atributo", () => {
    expect(fieldAria("cx-host", undefined)).toEqual({ "aria-invalid": undefined, "aria-describedby": undefined });
  });
});
