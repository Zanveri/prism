import { describe, expect, it } from "vitest";

import { environmentTextColor } from "./environment-pill";

describe("environmentTextColor", () => {
  it("texto escuro sobre as seis cores do canvas, que são claras", () => {
    for (const color of ["#FF8A7A", "#F2B644", "#5ED3A3", "#7DB2FF", "#B79CFF", "#AEB7C4"]) expect(environmentTextColor(color)).toBe("#14181D");
  });

  it("texto claro sobre uma cor escura", () => {
    expect(environmentTextColor("#1E3A8A")).toBe("#FFFFFF");
    expect(environmentTextColor("#000000")).toBe("#FFFFFF");
  });

  it("não depende da caixa da cor", () => {
    expect(environmentTextColor("#ff8a7a")).toBe("#14181D");
  });
});
