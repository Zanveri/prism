import { describe, expect, it } from "vitest";

import { canClose, closesFromBackdrop, describedByOf } from "./dialog";

describe("canClose: o que fecha um diálogo por fora (Esc, clique fora e o X)", () => {
  it("fecha, por padrão", () => {
    expect(canClose({ pending: false, dismissible: true })).toBe(true);
  });

  it("não fecha enquanto a ação roda", () => {
    expect(canClose({ pending: true, dismissible: true })).toBe(false);
  });

  it("o diálogo que só se resolve por um botão dele (o de reinício dos drivers) não fecha por fora", () => {
    expect(canClose({ pending: false, dismissible: false })).toBe(false);
    expect(canClose({ pending: true, dismissible: false })).toBe(false);
  });
});

describe("closesFromBackdrop: o clique no fundo escurecido", () => {
  const backdrop = {};
  const panel = {};
  const click = (button: number, target: object = backdrop) => ({ button, target, currentTarget: backdrop });
  const open = { pending: false, dismissible: true };

  it("o botão principal no fundo fecha o diálogo", () => {
    expect(closesFromBackdrop(click(0), open)).toBe(true);
  });

  it("o botão direito e o do meio não fecham: o diálogo sumiria e o menu de contexto que vem logo depois cairia no que estava por baixo dele", () => {
    expect(closesFromBackdrop(click(2), open)).toBe(false);
    expect(closesFromBackdrop(click(1), open)).toBe(false);
  });

  it("o clique que começou dentro do painel não fecha, qualquer que seja o botão", () => {
    expect(closesFromBackdrop(click(0, panel), open)).toBe(false);
  });

  it("e continua valendo o que `canClose` diz: a ação rodando e o diálogo que só se resolve por um botão não fecham por fora", () => {
    expect(closesFromBackdrop(click(0), { pending: true, dismissible: true })).toBe(false);
    expect(closesFromBackdrop(click(0), { pending: false, dismissible: false })).toBe(false);
  });
});

describe("describedByOf: o que o leitor de tela ouve com o título (o aria-describedby do painel)", () => {
  it("a descrição do cabeçalho, quando há, e o que o corpo aponta (o aviso de confirmação, RN-PROT-001), nessa ordem", () => {
    expect(describedByOf(":r2:", undefined)).toBe(":r2:");
    expect(describedByOf(null, ":r1:-faz :r1:-comando")).toBe(":r1:-faz :r1:-comando");
    expect(describedByOf(":r2:", ":r1:-resumo")).toBe(":r2: :r1:-resumo");
  });

  it("sem nenhum dos dois, não há aria-describedby", () => {
    expect(describedByOf(null, undefined)).toBeUndefined();
    expect(describedByOf(null, "")).toBeUndefined();
  });
});
