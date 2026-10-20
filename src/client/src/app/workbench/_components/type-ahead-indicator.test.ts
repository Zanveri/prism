import { describe, expect, it } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { navigatorCopy } from "../_lib/navigator.copy";
import { TypeAheadIndicator } from "./type-ahead-indicator";

/** Os elementos de verdade do indicador (sem o fragmento que os agrupa): a região do leitor de tela e, com texto, o chip. */
const parts = (shown: { text: string; found: boolean } | null) => elementsOf(TypeAheadIndicator({ shown })).filter((element) => typeof element.type === "string");

describe("o indicador de ir ao item pelas primeiras letras (RN-ARVORE-009)", () => {
  it("sem texto, só a região do leitor de tela, vazia: ela já está montada quando a próxima mensagem chegar", () => {
    const [region, ...others] = parts(null);

    expect(others).toEqual([]);
    expect(region.props["aria-live"]).toBe("polite");
    expect(region.props.className).toBe("sr-only");
    expect(region.props.children).toBe("");
  });

  it("com item achado, mostra o texto digitado e não anuncia nada: o foco já anuncia o item", () => {
    const [region, chip] = parts({ text: "bat", found: true });

    expect(region.props.children).toBe("");
    expect(chip.props["aria-hidden"]).toBe(true);
    expect(chip.props.children).toBe(navigatorCopy.typeAhead.typed("bat"));
    expect(chip.props.children).toBe("Ir para: bat");
  });

  it("o chip não tira espaço da lista nem pega o mouse: fica sobre ela, no canto", () => {
    const [, chip] = parts({ text: "bat", found: true });

    expect(String(chip.props.className)).toEqual(expect.stringContaining("absolute"));
    expect(String(chip.props.className)).toEqual(expect.stringContaining("pointer-events-none"));
  });

  it("sem item que comece pelo texto, mostra e anuncia o aviso, com o texto como foi digitado", () => {
    const [region, chip] = parts({ text: "xYz", found: false });

    expect(region.props.children).toBe("Nenhum item começa com “xYz”");
    expect(chip.props.children).toBe("Nenhum item começa com “xYz”");
    expect(String(chip.props.className)).toEqual(expect.stringContaining("text-danger"));
  });
});
