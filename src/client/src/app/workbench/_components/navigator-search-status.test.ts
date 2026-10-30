import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { workbenchCopy } from "../_lib/workbench.copy";
import { NavigatorSearchStatus } from "./navigator-search-status";

const copy = workbenchCopy.navigator.search;

type Props = Parameters<typeof NavigatorSearchStatus>[0];
const quiet: Props = { loading: 0, cut: false, truncated: [], failures: [], leftOut: 0, withoutCredentials: 0, onSearchThem: () => {} };

/** O que a linha de estado desenha: os textos (cada um na própria região viva) e os botões. */
function drawn(props: Partial<Props>) {
  const tree = NavigatorSearchStatus({ ...quiet, ...props });
  const all = elementsOf(tree);
  const statuses = all.filter((element) => element.props.role === "status");
  return {
    tree,
    texts: statuses.map((element) => element.props.children as string),
    buttons: all.filter((element) => element.type === Button),
    statuses,
  };
}

describe("a linha de estado da busca (RN-BUSCA-002)", () => {
  it("sem nada a dizer, não desenha nada", () => {
    expect(NavigatorSearchStatus(quiet)).toBeNull();
  });

  it("enquanto o índice vem: 'Buscando nas tabelas e visões de 3 bancos…', e 'de 1 banco…' no singular", () => {
    expect(drawn({ loading: 3 }).texts).toEqual(["Buscando nas tabelas e visões de 3 bancos…"]);
    expect(drawn({ loading: 1 }).texts).toEqual(["Buscando nas tabelas e visões de 1 banco…"]);
    expect(drawn({ loading: 1200 }).texts).toEqual(["Buscando nas tabelas e visões de 1.200 bancos…"]);
  });

  it("com o corte: as 200 primeiras de cada banco, e escrever mais do nome", () => {
    expect(drawn({ cut: true }).texts).toEqual(["Muitos resultados: cada banco mostra as 200 primeiras tabelas e visões. Escreva mais do nome para ver as outras."]);
  });

  it("com o índice cortado na API: o nome do banco e o limite de 50.000", () => {
    expect(drawn({ truncated: [{ key: "a", name: "Prod › erp" }] }).texts).toEqual(["Prod › erp tem mais de 50.000 tabelas e visões: a busca olhou as 50.000 primeiras e o que já está aberto na árvore."]);
  });

  it("cada banco cortado na API tem a sua frase", () => {
    expect(drawn({ truncated: [{ key: "a", name: "Prod › erp" }, { key: "b", name: "Prod › arquivo" }] }).texts).toHaveLength(2);
  });

  it("com a falha: a mensagem do banco como veio, e o 'Tentar de novo' fora da região viva", () => {
    const onRetry = vi.fn();
    const { texts, buttons, statuses } = drawn({ failures: [{ key: "a", name: "Prod › erp", message: 'permission denied for table "pg_class"', onRetry }] });

    expect(texts).toEqual(['Não foi possível buscar em Prod › erp: permission denied for table "pg_class"']);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.children).toBe("Tentar de novo");
    expect(buttons[0].props["aria-label"]).toBe("Tentar de novo: Prod › erp");
    expect(buttons[0].props.type).toBe("button");
    for (const status of statuses) expect(typeof status.props.children).toBe("string");

    (buttons[0].props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("uma falha por banco, cada uma com o botão dela", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { buttons, texts } = drawn({
      failures: [
        { key: "a", name: "Prod › erp", message: "um", onRetry: first },
        { key: "b", name: "Prod › arquivo", message: "dois", onRetry: second },
      ],
    });

    expect(texts).toEqual(["Não foi possível buscar em Prod › erp: um", "Não foi possível buscar em Prod › arquivo: dois"]);
    (buttons[1].props.onClick as () => void)();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("com conexões de fora: quantas, no singular e no plural, e o 'Buscar nelas também', que as abre", () => {
    const onSearchThem = vi.fn();
    const two = drawn({ leftOut: 2, onSearchThem });
    const one = drawn({ leftOut: 1 });

    expect(two.texts).toEqual(["2 conexões não estão conectadas e ficaram de fora da busca."]);
    expect(one.texts).toEqual(["1 conexão não está conectada e ficou de fora da busca."]);
    expect(two.buttons).toHaveLength(1);
    expect(two.buttons[0].props.children).toBe("Buscar nelas também");
    (two.buttons[0].props.onClick as () => void)();
    expect(onSearchThem).toHaveBeenCalledOnce();
  });

  it("as sem usuário ou senha gravada ganham a frase delas na mesma região, no singular e no plural", () => {
    expect(drawn({ leftOut: 2, withoutCredentials: 1 }).texts).toEqual(["2 conexões não estão conectadas e ficaram de fora da busca. 1 sem usuário ou senha gravada ficou de fora."]);
    expect(drawn({ leftOut: 3, withoutCredentials: 2 }).texts).toEqual(["3 conexões não estão conectadas e ficaram de fora da busca. 2 sem usuário ou senha gravada ficaram de fora."]);
  });

  it("se nenhuma das de fora pode ser aberta (todas sem usuário ou senha), o botão não existe: não faria nada", () => {
    const { texts, buttons } = drawn({ leftOut: 1, withoutCredentials: 1 });

    expect(texts).toEqual(["1 conexão não está conectada e ficou de fora da busca. 1 sem usuário ou senha gravada ficou de fora."]);
    expect(buttons).toEqual([]);
  });

  it("o botão fica fora da região viva: texto em role=status, botão irmão dele, nunca filho", () => {
    const { statuses, buttons } = drawn({ leftOut: 2, failures: [{ key: "a", name: "Prod › erp", message: "x", onRetry: () => {} }] });

    expect(statuses.length).toBeGreaterThan(0);
    expect(buttons).toHaveLength(2);
    // O filho de cada região é só o texto: nenhum botão (nem outro elemento) mora dentro dela.
    for (const status of statuses) expect(typeof status.props.children).toBe("string");
  });

  it("tudo junto, na ordem: o índice a caminho, o corte, o corte da API, a falha e as de fora", () => {
    const { texts } = drawn({
      loading: 2,
      cut: true,
      truncated: [{ key: "t", name: "Prod › erp" }],
      failures: [{ key: "f", name: "Homolog › erp", message: "caiu", onRetry: () => {} }],
      leftOut: 1,
    });

    expect(texts.map((text) => text.split(" ").slice(0, 2).join(" "))).toEqual(["Buscando nas", "Muitos resultados:", "Prod ›", "Não foi", "1 conexão"]);
  });

  it("o texto que a tela do 'nada encontrado' explica agora fala dos bancos conectados e do que já está aberto", () => {
    expect(copy.onlyLoaded).toBe("A busca olha as tabelas e visões dos bancos conectados e o que já está aberto na árvore.");
  });

  it("a conta para o leitor de tela quando o corte deixa achados de fora: '1.234 resultados, 600 à vista'", () => {
    expect(copy.resultsShown(1234, 600)).toBe("1.234 resultados, 600 à vista");
    expect(copy.resultsShown(1, 1)).toBe("1 resultado, 1 à vista");
  });
});

describe("a linha de estado, vista como elemento", () => {
  it("cada texto é um <p role=status> e o conjunto é uma só caixa abaixo dos filtros", () => {
    const tree = NavigatorSearchStatus({ ...quiet, loading: 1, cut: true }) as Found;
    const paragraphs = elementsOf(tree).filter((element) => element.type === "p");

    expect(tree.type).toBe("div");
    expect(paragraphs.map((element) => element.props.role)).toEqual(["status", "status"]);
  });
});
