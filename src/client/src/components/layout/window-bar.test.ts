import { describe, expect, it } from "vitest";

import { hexOf } from "./window-bar";

describe("a cor dos botões da janela (RN-JANELA-001)", () => {
  it("a cor calculada do tema vai como #rrggbb, que é a única forma que o processo principal aceita", () => {
    expect(hexOf("rgb(180, 188, 200)")).toBe("#b4bcc8");
    expect(hexOf("rgb(0, 5, 255)")).toBe("#0005ff");
  });

  it("o que não é rgb() opaco não vai", () => {
    for (const color of ["rgba(0, 0, 0, 0.5)", "oklch(0.7 0.1 250)", "", "#b4bcc8"]) expect(hexOf(color)).toBeNull();
  });
});
