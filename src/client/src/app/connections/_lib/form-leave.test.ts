import { describe, expect, it } from "vitest";

import { hasChanges, snapshotOf } from "./form-leave";

const entries = (values: Record<string, string>) => Object.entries(values);

describe("snapshotOf: o que o formulário tem agora, como texto", () => {
  it("cada campo pelo nome; o que não é texto (um arquivo) não entra", () => {
    expect(snapshotOf([...entries({ name: "MES", port: "5432" }), ["anexo", new Blob() as unknown as string]])).toEqual({ name: "MES", port: "5432" });
  });
});

describe("hasChanges: há o que perder ao fechar o diálogo (RN-NAV-004: cancelar e Esc perguntam só quando há)", () => {
  const initial = { engine: "1", name: "", host: "", port: "5432", password: "", environmentColor: "" };

  it("nada digitado: não há", () => {
    expect(hasChanges(initial, { ...initial })).toBe(false);
  });

  it("um campo digitado, a senha, outro banco, outra porta ou uma cor: há", () => {
    for (const change of [{ name: "M" }, { password: "x" }, { engine: "2" }, { port: "5433" }, { environmentColor: "#FF8A7A" }]) expect(hasChanges(initial, { ...initial, ...change })).toBe(true);
  });

  it("um campo que apareceu ou sumiu também conta", () => {
    expect(hasChanges(initial, { ...initial, extra: "" })).toBe(true);
    expect(hasChanges(initial, Object.fromEntries(Object.entries(initial).filter(([name]) => name !== "host")))).toBe(true);
  });

  it("apagar o que foi digitado volta a não haver", () => {
    expect(hasChanges(initial, { ...initial, name: "" })).toBe(false);
  });

  it("sem a foto de quando abriu (ainda não montou), não há o que perder", () => {
    expect(hasChanges(null, initial)).toBe(false);
  });
});
