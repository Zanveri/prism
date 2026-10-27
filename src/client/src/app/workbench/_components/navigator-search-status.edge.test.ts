import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import { NavigatorSearchStatus } from "./navigator-search-status";

type Props = Parameters<typeof NavigatorSearchStatus>[0];
const quiet: Props = { loading: 0, cut: false, truncated: [], failures: [], leftOut: 0, withoutCredentials: 0, onSearchThem: () => {} };

const markup = (props: Partial<Props>) => renderToStaticMarkup(createElement(NavigatorSearchStatus, { ...quiet, ...props }));
const buttonsOf = (props: Partial<Props>) => elementsOf(NavigatorSearchStatus({ ...quiet, ...props })).filter((element) => element.type === Button);

describe("a linha de estado da busca, nas bordas (RN-BUSCA-002)", () => {
  it.each([
    { name: "nada", props: {} },
    { name: "carregando zero", props: { loading: 0 } },
    { name: "carregando negativo", props: { loading: -1 } },
    { name: "de fora zero", props: { leftOut: 0 } },
    { name: "de fora negativo", props: { leftOut: -2 } },
    { name: "sem credencial sem as de fora", props: { leftOut: 0, withoutCredentials: 3 } },
  ])("$name: não desenha nada", ({ props }) => {
    expect(markup(props)).toBe("");
  });

  it("a mensagem do banco vai como TEXTO: o que parece marcação é escapado, não interpretado", () => {
    const html = markup({ failures: [{ key: "a", name: "Prod › erp", message: '<img src=x onerror="alert(1)"> & "aspas"', onRetry: () => {} }] });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;aspas&quot;");
    expect(html).toContain('role="status"');
  });

  it("a mensagem do banco com várias linhas e espaços chega inteira, como veio (RN-SQL-009)", () => {
    const message = "ERROR:  relation \"x\" does not exist\nLINE 1: select * from x\n                      ^";
    const html = markup({ failures: [{ key: "a", name: "Prod › erp", message, onRetry: () => {} }] });

    expect(html).toContain(message.replace(/"/g, "&quot;"));
  });

  it("o botão fica FORA das regiões vivas no HTML de verdade: nenhum <button> dentro de um role=status", () => {
    const html = markup({
      loading: 2,
      cut: true,
      truncated: [{ key: "t", name: "Prod › erp" }],
      failures: [{ key: "f", name: "Homolog › erp", message: "caiu", onRetry: () => {} }],
      leftOut: 3,
      withoutCredentials: 1,
    });

    const regions = [...html.matchAll(/<p [^>]*role="status"[^>]*>([\s\S]*?)<\/p>/g)];
    expect(regions).toHaveLength(5);
    for (const [, inner] of regions) expect(inner).not.toContain("<button");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });

  it("o 'Tentar de novo' de cada banco leva o nome do banco no nome acessível, e o texto visível continua sendo 'Tentar de novo'", () => {
    const html = markup({
      failures: [
        { key: "a", name: "Prod › erp", message: "um", onRetry: () => {} },
        { key: "b", name: "Prod › arquivo", message: "dois", onRetry: () => {} },
      ],
    });

    expect(html).toContain('aria-label="Tentar de novo: Prod › erp"');
    expect(html).toContain('aria-label="Tentar de novo: Prod › arquivo"');
    expect(html.match(/>Tentar de novo</g)).toHaveLength(2);
  });

  it("os números grandes levam o ponto de milhar, no singular e no plural", () => {
    const html = markup({ leftOut: 1200, withoutCredentials: 1200, loading: 1200 });

    expect(html).toContain("Buscando nas tabelas e visões de 1.200 bancos…");
    expect(html).toContain("1.200 conexões não estão conectadas e ficaram de fora da busca. 1.200 sem usuário ou senha gravada ficaram de fora.");
  });

  it("o 'Buscar nelas também' existe quando sobra ao menos uma conexão que pode ser aberta, e some quando todas as de fora são sem usuário ou senha", () => {
    expect(buttonsOf({ leftOut: 5, withoutCredentials: 4 })).toHaveLength(1);
    expect(buttonsOf({ leftOut: 5, withoutCredentials: 5 })).toHaveLength(0);
    expect(buttonsOf({ leftOut: 5, withoutCredentials: 0 })).toHaveLength(1);
    expect(buttonsOf({ leftOut: 5, withoutCredentials: 9 })).toHaveLength(0);
  });

  it("o 'Buscar nelas também' chama o gesto uma vez por clique, sem argumentos, e o 'Tentar de novo' chama só o do próprio banco", () => {
    const onSearchThem = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const buttons = buttonsOf({
      leftOut: 2,
      onSearchThem,
      failures: [
        { key: "a", name: "A", message: "x", onRetry: first },
        { key: "b", name: "B", message: "y", onRetry: second },
      ],
    });

    expect(buttons).toHaveLength(3);
    (buttons[2].props.onClick as () => void)();
    (buttons[0].props.onClick as () => void)();
    (buttons[0].props.onClick as () => void)();

    expect(onSearchThem).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
  });

  it("os bancos de uma mesma frase têm uma região viva cada, na ordem em que vieram", () => {
    const html = markup({ truncated: [{ key: "a", name: "A › x" }, { key: "b", name: "B › y" }] });

    expect([...html.matchAll(/<p [^>]*role="status"[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner]) => inner.split(" ")[0])).toEqual(["A", "B"]);
  });

  it("nenhuma cor fixa na marcação (#, rgb, hsl, style): só as classes do tema", () => {
    const html = markup({ loading: 1, cut: true, truncated: [{ key: "t", name: "x" }], failures: [{ key: "f", name: "y", message: "z", onRetry: () => {} }], leftOut: 2 });

    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|style=/);
  });
});
