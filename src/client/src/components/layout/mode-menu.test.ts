import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContextMenuItems } from "@/components/ui";

import { modeMenuGroups, modeOf } from "./mode-menu";

describe("o seletor de modo (RN-CONSTRUIR-001)", () => {
  it("o modo vem da rota; fora das duas, fica o último", () => {
    expect(modeOf("/workbench", "build")).toBe("workbench");
    expect(modeOf("/build", "workbench")).toBe("build");
    expect(modeOf("/settings", "build")).toBe("build");
  });

  it("o menu tem os dois modos, com dica, e marca o atual", () => {
    const [group] = modeMenuGroups("build");
    expect(group.items.map((item) => [item.label, item.hint, item.checked])).toEqual([
      ["Área de trabalho", "Navegar nos bancos, rodar SQL e editar dados", false],
      ["Construir", "Desenhar tabelas, relações e índices e gerar o DDL", true],
    ]);
  });

  it("quando o item marcado também tem ícone, o ícone fica à esquerda e o visto fica depois do texto", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: modeMenuGroups("build"), onChoose: () => {} }));
    expect(markup.indexOf("Desenhar tabelas")).toBeLessThan(markup.indexOf("M3.5 8.5l3 3 6-7"));
  });
});
