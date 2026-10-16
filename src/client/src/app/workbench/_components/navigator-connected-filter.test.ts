import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { navigatorCopy } from "../_lib/navigator.copy";
import { NavigatorConnectedFilter, NavigatorFilteredEmpty } from "./navigator-connected-filter";

const copy = navigatorCopy.connectedFilter;

function drawn(count: number, on: boolean, onToggle: () => void = () => {}) {
  const all = elementsOf(NavigatorConnectedFilter({ count, on, onToggle }));
  const button = all.find((element) => element.type === "button") as Found;
  const texts = all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
  return { button, texts };
}

describe("o botão “Só as conectadas” do navegador (RN-NAV-013)", () => {
  it("é um botão de alternar que diz quantas estão conectadas, ligado ou não, e o leitor de tela ouve o rótulo antes da conta", () => {
    const off = drawn(3, false);
    const on = drawn(3, true);

    expect(off.button.props).toMatchObject({ type: "button", "aria-pressed": false, title: copy.showOnly });
    expect(on.button.props).toMatchObject({ "aria-pressed": true, title: copy.showAll });
    expect(off.texts).toEqual([`${copy.label}: `, "3 conectadas"]);
    expect(on.texts).toEqual([`${copy.label}: `, "3 conectadas"]);
  });

  it("diz “1 conectada” e, sem nenhuma, “Nenhuma conectada”", () => {
    expect(drawn(1, false).texts).toContain("1 conectada");
    expect(drawn(0, false).texts).toContain("Nenhuma conectada");
    expect(copy.count(1200)).toBe("1.200 conectadas");
  });

  it("o clique (e o Enter e o Espaço, que um <button> já traduz em clique) alterna", () => {
    const onToggle = vi.fn();
    (drawn(2, false, onToggle).button.props.onClick as () => void)();

    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("a árvore vazia pelos filtros do navegador (RN-NAV-010 e 013)", () => {
  function empty(environment: string | null | undefined, onlyConnected: boolean, onShowAll: () => void = () => {}) {
    const all = elementsOf(NavigatorFilteredEmpty({ environment, onlyConnected, onShowAll }));
    const status = all.find((element) => element.props.role === "status") as Found;
    return { status: status.props.children, showAll: all.find((element) => element.type === Button) };
  }

  it("com “Só as conectadas” ligado e nenhuma conectada: “Nenhuma conexão conectada.” e “Mostrar todas”, que o desliga", () => {
    const onShowAll = vi.fn();
    const { status, showAll } = empty(undefined, true, onShowAll);
    (showAll!.props.onClick as () => void)();

    expect(status).toBe("Nenhuma conexão conectada.");
    expect(showAll!.props.children).toBe("Mostrar todas");
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("com um ambiente escolhido também, a frase diz o ambiente", () => {
    expect(empty("Produção", true).status).toBe("Nenhuma conexão conectada em Produção.");
    expect(empty(null, true).status).toBe("Nenhuma conexão conectada sem ambiente.");
  });

  it("só com o seletor de ambiente, a frase de antes, sem o “Mostrar todas”", () => {
    expect(empty("Produção", false)).toEqual({ status: "Nenhuma conexão em Produção.", showAll: undefined });
    expect(empty(null, false)).toEqual({ status: "Nenhuma conexão sem ambiente.", showAll: undefined });
  });
});
