import { describe, expect, it } from "vitest";

import { stripTags, withoutCursor } from "./text";

describe("stripTags", () => {
  it("deixa só o texto, também quando uma marca sobra dentro de outra", () => {
    expect(stripTags('<a href="/x">Área <b>de</b> trabalho</a>')).toBe("Área de trabalho");
    expect(stripTags("<<b>script>x")).toBe("script>x");
    expect(stripTags("sem marcas")).toBe("sem marcas");
  });
});

describe("withoutCursor", () => {
  it("tira só o marcador do cursor e diz onde ele estava, sem mexer no operador ||", () => {
    expect(withoutCursor("select |a || b")).toEqual({ doc: "select a || b", at: 7 });
    expect(withoutCursor("a ||| b")).toEqual({ doc: "a || b", at: 2 });
  });

  it("sem marcador, devolve o texto e -1", () => {
    expect(withoutCursor("select 1")).toEqual({ doc: "select 1", at: -1 });
  });
});
