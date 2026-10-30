import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baseWidths } from "../_lib/grid-columns";
import { measuredGridText, monoGridText, type GridText } from "../_lib/grid-text";
import type { QueryColumn } from "../_lib/query.schema";

// A ligação da grade com o medidor (RN-CONFIG-008): a fonte que a `ResultGrid` recebe vai ao gancho, e a medida que ele devolve é a que decide as larguras de
// saída. O gancho é trocado por um de mentira (o vitest não tem `canvas`), e a largura de tudo vem da altura total da lista virtual, que é a soma delas.
const measure = vi.hoisted(() => ({ text: undefined as unknown, fonts: [] as string[] }));
vi.mock("../_lib/use-grid-text", () => ({
  useGridText: (font: string) => {
    measure.fonts.push(font);
    return measure.text;
  },
}));

import { ResultGrid } from "./result-grid";

const columns: QueryColumn[] = [
  { name: "WAREHOUSE_ID", type: "int4", kind: "number" },
  { name: "nome", type: "text", kind: "text" },
];
const rows = [["1", "Universidade"]];

/** A largura da área que rola: o número da linha (64 px) e as colunas de saída, uma depois da outra. */
function totalWidth(extra: Partial<Parameters<typeof ResultGrid>[0]> = {}): number {
  const markup = renderToStaticMarkup(createElement(ResultGrid, { columns, rows, truncated: new Map(), ...extra }));
  return Number(/<div class="relative min-w-full" style="[^"]*width:(\d+)px/.exec(markup)?.[1]);
}

beforeEach(() => {
  measure.text = monoGridText;
  measure.fonts = [];
});

describe("a grade pede a medida na fonte da interface (RN-CONFIG-008)", () => {
  it("sem a prop `font`, a fonte do app; com ela, a que a área de resultado entrega (a escolhida em Configurações)", () => {
    totalWidth();
    totalWidth({ font: "Inter" });
    totalWidth({ font: "Segoe UI" });

    expect(measure.fonts).toEqual(["IBM Plex Sans", "Inter", "Segoe UI"]);
  });

  it("a medida que o gancho devolve decide as larguras de saída: a mesma grade, em outra fonte, tem outra largura", () => {
    const wide = measuredGridText("larga", (font, text) => (font.startsWith("600 13px") ? 12 : font.startsWith("400 11px") ? 5 : 9) * [...text].length);
    const narrow = measuredGridText("estreita", (font, text) => (font.startsWith("600 13px") ? 6 : font.startsWith("400 11px") ? 4 : 5) * [...text].length);

    measure.text = monoGridText;
    const mono = totalWidth();
    measure.text = wide;
    const withWide = totalWidth();
    measure.text = narrow;
    const withNarrow = totalWidth();

    const sum = (text: GridText) => 64 + baseWidths(columns, rows, "NULL", true, null, text).reduce((total, width) => total + width, 0);
    expect(mono).toBe(sum(monoGridText));
    expect(withWide).toBe(sum(wide));
    expect(withNarrow).toBe(sum(narrow));
    // As três medidas dão larguras diferentes: nenhuma é ignorada.
    expect(new Set([mono, withWide, withNarrow]).size).toBe(3);
  });

  it("o zoom multiplica a medida de 100% (RN-GRADE-010): a fonte não muda essa regra", () => {
    const wide = measuredGridText("larga", (font, text) => (font.startsWith("600 13px") ? 12 : 9) * [...text].length);
    measure.text = wide;

    const at100 = baseWidths(columns, rows, "NULL", true, null, wide);
    const at50 = totalWidth({ zoom: 50 });

    // 50%: o número da linha em 32 px e cada coluna em metade da de 100%, em pixels inteiros.
    expect(at50).toBe(32 + at100.reduce((total, width) => total + Math.round(width * 0.5), 0));
  });

  it("uma grade com a medida da mono (os testes, a janela sem canvas) tem as larguras de sempre", () => {
    measure.text = monoGridText;

    expect(totalWidth()).toBe(64 + baseWidths(columns, rows, "NULL").reduce((total, width) => total + width, 0));
  });
});
