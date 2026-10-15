import { describe, expect, it, vi } from "vitest";

import { fontChoices, isInstalled, monospaceProbe, readSystemFonts, typedFont, type SystemFont } from "./system-fonts";

/**
 * Um canvas de mentira que desenha como o navegador: a largura de cada letra vem da primeira fonte da pilha que ele conhece, e a pilha que ele
 * não entende (`font` inválido) não muda a fonte de antes, como no navegador.
 */
function fakeCanvas(known: Record<string, { i: number; M: number }>) {
  let font = "10px sans-serif";
  const families = (value: string) => [...value.matchAll(/"([^"]*)"|([a-z-]+)\s*(?:,|$)/g)].map((match) => match[1] ?? match[2]);
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      if (/^\d+px /.test(value)) font = value;
    },
    measureText(text: string) {
      const family = families(font.replace(/^\d+px /, "")).find((name) => name in known) ?? "sans-serif";
      const widths = known[family] ?? { i: 4, M: 14 };
      return { width: [...text].reduce((total, letter) => total + (letter === "i" ? widths.i : widths.M), 0) };
    },
  };
}

describe("é monoespaçada? (a medida no canvas)", () => {
  const canvas = fakeCanvas({ "sans-serif": { i: 4, M: 14 }, "JetBrains Mono": { i: 9.6, M: 9.6 }, "Quase Mono": { i: 9.6, M: 9.62 }, Inter: { i: 4.2, M: 13.9 } });
  const isMonospace = monospaceProbe(canvas);

  it("é quando a fileira de 'i' tem a largura da fileira de 'M'", () => {
    expect(isMonospace("JetBrains Mono")).toBe(true);
    expect(isMonospace("Quase Mono")).toBe(true);
  });

  it("não é quando o 'i' é mais estreito", () => {
    expect(isMonospace("Inter")).toBe(false);
  });

  it("a fonte que o canvas não tem cai na reserva proporcional e não passa por monoespaçada", () => {
    expect(isMonospace("Não Instalada")).toBe(false);
  });

  it("uma pilha recusada não mede a fonte da medida anterior: a fonte volta à reserva antes de cada medida", () => {
    const rejecting = fakeCanvas({ "JetBrains Mono": { i: 9.6, M: 9.6 } });
    const probe = monospaceProbe({
      get font() {
        return rejecting.font;
      },
      set font(value: string) {
        if (!value.includes("Recusada")) rejecting.font = value;
      },
      measureText: (text) => rejecting.measureText(text),
    });

    expect(probe("JetBrains Mono")).toBe(true);
    expect(probe("Recusada")).toBe(false);
  });

  it("um nome que não pode virar CSS nem chega ao canvas", () => {
    const font = vi.fn();
    const probe = monospaceProbe({
      set font(value: string) {
        font(value);
      },
      get font() {
        return "";
      },
      measureText: () => ({ width: 10 }),
    });

    expect(probe('Mono"; x')).toBe(false);
    expect(font).not.toHaveBeenCalled();
  });
});

describe("ler as fontes do sistema", () => {
  const mono = (family: string) => family.includes("Mono");

  it("junta os estilos de cada família, põe em ordem de nome e marca as monoespaçadas", async () => {
    const query = async () => [
      { family: "Noto Sans" },
      { family: "DejaVu Sans Mono" },
      { family: "Noto Sans" },
      { family: "arial" },
      { family: "Ubuntu" },
      { family: "Átila" },
      { family: "DejaVu Sans Mono" },
      { family: "Cantarell" },
    ];

    expect(await readSystemFonts(query, mono)).toEqual([
      { family: "arial", monospace: false },
      { family: "Átila", monospace: false },
      { family: "Cantarell", monospace: false },
      { family: "DejaVu Sans Mono", monospace: true },
      { family: "Noto Sans", monospace: false },
      { family: "Ubuntu", monospace: false },
    ]);
  });

  it("mede cada família uma vez só", async () => {
    const probe = vi.fn(() => false);

    await readSystemFonts(async () => [{ family: "Noto Sans" }, { family: "Noto Sans" }, { family: "Ubuntu" }], probe);

    expect(probe.mock.calls).toEqual([["Noto Sans"], ["Ubuntu"]]);
  });

  it("deixa de fora o nome que não pode virar CSS, e o que não é texto", async () => {
    const query = async () => [{ family: 'Evil"; } body { color: red' }, { family: "" }, { family: 42 as unknown as string }, { family: "Ubuntu" }];

    expect(await readSystemFonts(query, mono)).toEqual([{ family: "Ubuntu", monospace: false }]);
  });

  it.each([
    ["sem a API (fora do Chromium)", undefined],
    ["com a permissão negada", () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"))],
    ["com a API que lança na hora", () => {
      throw new Error("x");
    }],
    ["com a lista vazia", async () => []],
    ["com uma resposta que não é lista", async () => null as unknown as []],
  ])("não lê a lista %s: a resposta é nula, e o campo aceita o nome digitado", async (_name, query) => {
    expect(await readSystemFonts(query, mono)).toBeNull();
  });
});

describe("as opções de cada campo", () => {
  const fonts: SystemFont[] = [
    { family: "Cantarell", monospace: false },
    { family: "DejaVu Sans Mono", monospace: true },
    { family: "IBM Plex Mono", monospace: true },
    { family: "IBM Plex Sans", monospace: false },
    { family: "Inconsolata", monospace: true },
    { family: "Noto Sans", monospace: false },
  ];
  const names = (choices: ReturnType<typeof fontChoices>) => choices.map((choice) => [choice.family, choice.group]);

  it("a interface: a do app primeiro, e depois todas as do sistema em ordem de nome, sem repetir a do app", () => {
    expect(names(fontChoices("ui", fonts, ""))).toEqual([
      ["IBM Plex Sans", "app"],
      ["Cantarell", "installed"],
      ["DejaVu Sans Mono", "installed"],
      ["IBM Plex Mono", "installed"],
      ["Inconsolata", "installed"],
      ["Noto Sans", "installed"],
    ]);
  });

  it("o editor: a do app primeiro, depois as monoespaçadas e por fim as outras, cada grupo em ordem de nome", () => {
    expect(names(fontChoices("editor", fonts, ""))).toEqual([
      ["IBM Plex Mono", "app"],
      ["DejaVu Sans Mono", "monospace"],
      ["Inconsolata", "monospace"],
      ["Cantarell", "other"],
      ["IBM Plex Sans", "other"],
      ["Noto Sans", "other"],
    ]);
  });

  it("a busca acha pelo pedaço do nome, sem caixa nem acento, e a do app entra se combinar", () => {
    expect(names(fontChoices("editor", fonts, "  MONO "))).toEqual([
      ["IBM Plex Mono", "app"],
      ["DejaVu Sans Mono", "monospace"],
    ]);
    expect(names(fontChoices("ui", [...fonts, { family: "Átila", monospace: false }], "atila"))).toEqual([["Átila", "installed"]]);
    expect(fontChoices("ui", fonts, "plex sans").map((choice) => choice.family)).toEqual(["IBM Plex Sans"]);
    expect(fontChoices("ui", fonts, "papyrus")).toEqual([]);
  });

  it("sem a lista, só a do app", () => {
    expect(names(fontChoices("ui", null, ""))).toEqual([["IBM Plex Sans", "app"]]);
    expect(names(fontChoices("editor", undefined, ""))).toEqual([["IBM Plex Mono", "app"]]);
  });
});

describe("o nome digitado que o Enter escolhe", () => {
  const fonts: SystemFont[] = [{ family: "JetBrains Mono", monospace: true }];

  it("com a lista lida, só um nome dela (sem caixa), ou a do app", () => {
    expect(typedFont("editor", "jetbrains mono", fonts)).toBe("JetBrains Mono");
    expect(typedFont("editor", " ibm plex mono ", fonts)).toBe("IBM Plex Mono");
    expect(typedFont("editor", "Papyrus", fonts)).toBeNull();
  });

  it("sem a lista, o nome digitado, sem os espaços das pontas, se ele pode virar CSS", () => {
    expect(typedFont("ui", "  Fira Sans ", null)).toBe("Fira Sans");
    expect(typedFont("ui", "ibm plex sans", null)).toBe("IBM Plex Sans");
    expect(typedFont("ui", 'Fira"; x', null)).toBeNull();
    expect(typedFont("ui", "   ", null)).toBeNull();
  });
});

describe("a escolhida está instalada?", () => {
  const fonts: SystemFont[] = [{ family: "JetBrains Mono", monospace: true }];

  it("a do app vai dentro do Prism; as outras, só com a lista lida se sabe (sem caixa)", () => {
    expect(isInstalled("editor", "IBM Plex Mono", null)).toBe(true);
    expect(isInstalled("editor", "jetbrains mono", fonts)).toBe(true);
    expect(isInstalled("editor", "Consolas", fonts)).toBe(false);
    expect(isInstalled("editor", "Consolas", null)).toBeNull();
    expect(isInstalled("ui", "Inter", undefined)).toBeNull();
  });
});
