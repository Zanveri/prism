import { afterEach, describe, expect, it } from "vitest";

import { resultFocus } from "./result-slots";

// O foco que espera a área de resultado chegar ao lugar novo (RN-ABAS-012 e 014). A regra do foco das abas (RN-ABAS-019) só olha o pedido, sem levá-lo:
// quem o pediu (o F6, a troca do lugar) o leva quando puder, e ela cede.
afterEach(() => resultFocus.forgetExcept(new Set()));

describe("resultFocus.pending: só olha", () => {
  it("diz se a aba tem um pedido esperando, sem levá-lo: quem o pediu ainda o leva", () => {
    expect(resultFocus.pending("a")).toBe(false);

    resultFocus.request("a", "result");

    expect(resultFocus.pending("a")).toBe(true);
    expect(resultFocus.pending("a")).toBe(true);
    expect(resultFocus.pending("b")).toBe(false);
    expect(resultFocus.take("a", ["result"])).toBe("result");
    expect(resultFocus.pending("a")).toBe(false);
  });

  it("vale qualquer alvo, também o que o painel da consulta não leva (o botão de lugar)", () => {
    resultFocus.request("a", "placeButton");

    expect(resultFocus.pending("a")).toBe(true);
    expect(resultFocus.take("a", ["editor"])).toBeNull();
    expect(resultFocus.pending("a")).toBe(true);
  });

  it("a aba que saiu leva o pedido dela", () => {
    resultFocus.request("a", "editor");
    resultFocus.forgetExcept(new Set(["b"]));

    expect(resultFocus.pending("a")).toBe(false);
  });
});
