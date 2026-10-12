import { describe, expect, it } from "vitest";

import { parseSvg } from "./svg-tree";

describe("parseSvg", () => {
  it("lê os elementos na ordem, com os atributos como estão escritos, e os filhos de cada um", () => {
    const tree = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 34 720 281" fill="none">
<defs>
<filter id="glow" x="0"><feGaussianBlur stdDeviation="10"></feGaussianBlur></filter>
</defs>
<g filter="url(#glow)" opacity='0.5'>
<path d="M0 10 L20 5" stroke="#F3F5F8" stroke-width="8"/>
</g>
<circle cx="220" cy="186" r="2.5" fill="#FFFFFF"></circle>
</svg>`);

    expect(tree).toEqual({
      name: "svg",
      attributes: { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 34 720 281", fill: "none" },
      text: "",
      children: [
        { name: "defs", attributes: {}, text: "", children: [{ name: "filter", attributes: { id: "glow", x: "0" }, text: "", children: [{ name: "feGaussianBlur", attributes: { stdDeviation: "10" }, text: "", children: [] }] }] },
        { name: "g", attributes: { filter: "url(#glow)", opacity: "0.5" }, text: "", children: [{ name: "path", attributes: { d: "M0 10 L20 5", stroke: "#F3F5F8", "stroke-width": "8" }, text: "", children: [] }] },
        { name: "circle", attributes: { cx: "220", cy: "186", r: "2.5", fill: "#FFFFFF" }, text: "", children: [] },
      ],
    });
  });

  it("guarda a ordem dos atributos e o texto do título e da descrição, com as entidades do XML resolvidas", () => {
    const tree = parseSvg(`<?xml version="1.0" encoding="UTF-8"?>
<!-- um comentário -->
<svg b="2" a="1"><title>Prism &amp; cia</title><desc>três &lt;faixas&gt; &#233; &#x41;</desc></svg>`);

    expect(Object.keys(tree.attributes)).toEqual(["b", "a"]);
    expect(tree.children.map((child) => [child.name, child.text])).toEqual([
      ["title", "Prism & cia"],
      ["desc", "três <faixas> é A"],
    ]);
  });

  it.each([
    ["sem raiz", ""],
    ["a raiz não é svg", "<g></g>"],
    ["um elemento que não fecha", "<svg><g></svg>"],
    ["um fechamento sem abertura", "<svg></g></svg>"],
    ["texto solto depois da raiz", "<svg></svg> sobra"],
    ["duas raízes", "<svg></svg><svg></svg>"],
    ["um atributo sem aspas", "<svg a=1></svg>"],
    ["um atributo repetido", '<svg a="1" a="2"></svg>'],
    ["uma entidade desconhecida", "<svg><title>&nbsp;</title></svg>"],
  ])("recusa o que não é um SVG bem formado: %s", (_case, source) => {
    expect(() => parseSvg(source)).toThrow();
  });
});
