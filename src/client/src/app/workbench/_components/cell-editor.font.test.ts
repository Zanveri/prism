import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CellEditor } from "./cell-editor";

// O campo de edição da célula é da grade e, como ela, está na fonte da interface (RN-CONFIG-008, seção 42): ele não escolhe fonte, herda a da caixa que rola
// (o preflight põe `font: inherit` na área de texto). Escolher a mono ali o deixaria diferente das células que ele cobre.

const noop = () => {};
const render = (number: boolean, hint: string | null = null) => renderToStaticMarkup(createElement(CellEditor, { label: "preco, linha 1", draft: "10", hint, number, onDraft: noop, onCommit: noop, onCancel: noop }));

const fontClasses = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(" ")).filter((name) => /^font-(mono|editor)$/.test(name));

describe("o campo de edição da célula herda a fonte da grade", () => {
  it.each([
    ["texto", false, null],
    ["número", true, null],
    ["com a dica de várias células", false, "Vale para as 37 células escolhidas da coluna preco."],
  ] as const)("%s: nem o campo, nem os botões, nem a dica escolhem a mono ou a do editor", (_name, number, hint) => {
    const markup = render(number, hint);

    expect(markup).toContain("<textarea");
    expect(fontClasses(markup)).toEqual([]);
  });

  it("a área de texto não tem classe de família de fonte alguma (herda), nem a de tamanho: o tamanho e a altura vêm do zoom da caixa", () => {
    const classes = /<textarea[^>]*class="([^"]*)"/.exec(render(false))?.[1].split(" ") ?? [];

    expect(classes.filter((name) => name.startsWith("font-"))).toEqual([]);
    expect(classes.some((name) => name.startsWith("text-[") || name === "text-sm" || name === "text-xs")).toBe(false);
  });
});
