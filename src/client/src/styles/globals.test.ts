import { describe, expect, it } from "vitest";

import { themeModes } from "@/app/settings/_lib/preferences";
import { themeSchemes, type ThemeId } from "@/app/settings/_lib/theme";
import { markColors } from "@/components/layout/prism-mark";
import { contrast, over } from "@/lib/testing/contrast";
import { css, dark, light, paletteOf, themeBlock, type Palette } from "@/lib/testing/theme-palettes";

/** Os temas além do Prism Escuro e do Prism Claro: cada um é um bloco de CSS que troca as fichas e fica com as do esquema dele nas demais. */
const extraThemes = themeModes.filter((mode): mode is Exclude<ThemeId, "dark" | "light"> => mode !== "dark" && mode !== "light" && mode !== "system");
const names: Record<ThemeId, string> = { dark: "Prism Escuro", light: "Prism Claro", monokai: "Monokai", dracula: "Dracula", nord: "Nord", "github-light": "GitHub Claro" };

/** Todos os temas do app. Cada um passa pela mesma bateria de contraste: quem acrescenta um tema acrescenta o bloco dele no CSS e o nome aqui. */
const themes = (["light", "dark", ...extraThemes] as const).map((id) => ({ id, name: names[id], ...paletteOf(id) }));

const surfaces = ["background", "panel", "raised", "selected"] as const;
const neutralText = ["ink", "body", "muted", "subtle"] as const;
const toneText = ["accent", "postgres", "db2", "informix", "danger", "success"] as const;
/** As cores de sintaxe do editor (RN-CONFIG-003): palavra-chave, texto entre aspas, número e comentário. O canvas as define em cada tema. */
const syntaxText = ["syntax-keyword", "syntax-string", "syntax-number", "syntax-comment"] as const;
/** O que o editor pinta por cima da seleção: o texto e o que o erro de SQL marca (a sintaxe é conferida à parte, em cada superfície). */
const editorOnSelection = { texto: "ink", erro: "danger" } as const;
/** `FormMessage` (e o aviso): o texto do tom sobre 10% do próprio tom por cima da superfície (`bg-<tom>/10`). */
const messageTones = { erro: "danger", atenção: "accent", sucesso: "success" } as const;

describe("os tokens de cor (tema escuro e tema claro)", () => {
  it("cada token tem as duas colunas, e o tema escuro é o que o app sempre teve", () => {
    expect(dark).toEqual({
      background: "#0e1114",
      panel: "#14181d",
      raised: "#1b2027",
      selected: "#232a33",
      border: "#2a313b",
      "border-strong": "#38414d",
      selection: "#2a313b",
      ink: "#e6eaf0",
      body: "#c9d1dc",
      muted: "#b4bcc8",
      subtle: "#8e99a8",
      accent: "#f2b644",
      postgres: "#7db2ff",
      db2: "#5ed3a3",
      informix: "#f591b6",
      danger: "#ff8a7a",
      success: "#5ed3a3",
      "syntax-keyword": "#7db2ff",
      "syntax-string": "#5ed3a3",
      "syntax-number": "#f2b644",
      "syntax-comment": "#8e99a8",
      link: "#7db2ff",
    });
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("o tema claro usa os valores do canvas onde ele os define (Prism Claro, Configuracoes.dc.html), menos o verde, que a revisão escureceu", () => {
    expect(light).toMatchObject({
      background: "#f7f8fa", // bg
      panel: "#eceff3", // painel
      border: "#d5dae1", // linha
      ink: "#1b2027", // fg
      postgres: "#1d5fd1", // kw
      accent: "#8a5200", // num
      subtle: "#5f6875", // com
      "border-strong": "#b4bcc8", // rolagem
    });
    // O canvas dá #0b7a4b ao texto entre aspas; sobre a linha selecionada ele dava 4,37:1. #097244 passa (e o sucesso tem o mesmo verde do Db2).
    expect(light.db2).toBe("#097244");
    expect(light.success).toBe("#097244");
  });

  it("as cores de sintaxe dos dois temas do Prism são as do canvas: palavra-chave é a do PostgreSQL, texto é o verde, número é o acento, comentário é o apagado", () => {
    for (const palette of [light, dark]) {
      expect(palette["syntax-keyword"]).toBe(palette.postgres);
      expect(palette["syntax-string"]).toBe(palette.success);
      expect(palette["syntax-number"]).toBe(palette.accent);
      expect(palette["syntax-comment"]).toBe(palette.subtle);
    }
  });

  it("o véu do diálogo e a sombra têm as duas colunas", () => {
    expect(css).toMatch(/--color-scrim:\s*light-dark\(rgb\([^)]*\),\s*rgb\([^)]*\)\)/);
    expect(css).toMatch(/--shadow-2xl:[^;]*light-dark\(/);
  });

  it("o palco escuro (a marca no login, RN-MARCA-006) tem, token por token, a coluna escura do tema: é o tema escuro do Prism em qualquer tema", () => {
    const block = /\.stage-dark\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const stage: Palette = {};
    for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) stage[match[1]] = match[2].toLowerCase();

    expect(stage).toEqual(dark);
    expect(block).toMatch(/--color-scrim:\s*rgb\(6 8 10 \/ 0\.72\)/);
    expect(css).toMatch(/--color-scrim:\s*light-dark\(rgb\([^)]*\),\s*rgb\(6 8 10 \/ 0\.72\)\)/);
    expect(block).toMatch(/color-scheme:\s*dark/);
    // O fundo e a cor do texto precisam ser escritos de novo no palco: a cor do texto herda o valor JÁ calculado do <body>.
    expect(block).toMatch(/background-color:\s*var\(--color-background\)/);
    expect(block).toMatch(/[^-]color:\s*var\(--color-ink\)/);
  });

  it("o atributo data-theme escolhe o esquema de cor: escuro por padrão, claro, ou o do sistema", () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/:root\[data-theme="system"\]\s*\{[^}]*color-scheme:\s*light dark/);
  });
});

describe("os outros quatro temas do canvas (RN-CONFIG-003)", () => {
  it("são Monokai, Dracula, Nord e GitHub Claro, cada um com o seu bloco no CSS", () => {
    expect(extraThemes).toEqual(["monokai", "dracula", "nord", "github-light"]);
    for (const id of extraThemes) expect(css, id).toContain(`:root[data-theme="${id}"]`);
  });

  it("cada bloco diz o esquema de cor do tema (o que decide as colunas do light-dark, a marca e os controles do navegador), e é o de `themeSchemes`", () => {
    for (const id of extraThemes) {
      const { scheme } = themeBlock(id);

      expect(scheme, id).toBe(themeSchemes[id as keyof typeof themeSchemes]);
    }
    expect(themeSchemes).toEqual({ dark: "dark", light: "light", monokai: "dark", dracula: "dark", nord: "dark", "github-light": "light" });
  });

  it("um bloco só troca fichas que existem: nenhum token inventado", () => {
    for (const id of extraThemes) for (const token of Object.keys(themeBlock(id).overrides)) expect(Object.keys(dark), `${id}: ${token}`).toContain(token);
  });

  it("todo bloco define as fichas que o canvas dá ao tema (fundo, painel, linha, texto, as quatro cores de sintaxe e a barra de rolagem), mais as que se derivam delas", () => {
    for (const id of extraThemes) {
      const { overrides } = themeBlock(id);

      for (const token of ["background", "panel", "raised", "selected", "selection", "border", "border-strong", "ink", "body", "muted", "subtle", ...syntaxText]) expect(overrides, `${id}: ${token}`).toHaveProperty(token);
    }
  });

  // As nove cores que o canvas dá a cada tema (`lista`, em Configuracoes.dc.html), copiadas daqui: a fonte da verdade é o desenho, e um teste que
  // dependesse de abrir o arquivo do desenho quebraria onde só o pacote do cliente existe. Onde o canvas dá uma cor que, sozinha, não passa,
  // a ficha leva a cor mais próxima que passa (`lifted`); toda outra cor do canvas fica como está.
  const canvas: Record<string, Record<string, string>> = {
    monokai: { bg: "#272822", painel: "#1E1F1C", linha: "#3E3D32", fg: "#F8F8F2", kw: "#F92672", str: "#E6DB74", num: "#AE81FF", com: "#A6A28C", rolagem: "#5A594E" },
    dracula: { bg: "#282A36", painel: "#21222C", linha: "#44475A", fg: "#F8F8F2", kw: "#FF79C6", str: "#F1FA8C", num: "#BD93F9", com: "#9AA5CE", rolagem: "#6272A4" },
    nord: { bg: "#2E3440", painel: "#272C36", linha: "#434C5E", fg: "#D8DEE9", kw: "#81A1C1", str: "#A3BE8C", num: "#B48EAD", com: "#9AA6BD", rolagem: "#4C566A" },
    "github-light": { bg: "#FFFFFF", painel: "#F6F8FA", linha: "#D1D9E0", fg: "#1F2328", kw: "#CF222E", str: "#0A3069", num: "#0550AE", com: "#59636E", rolagem: "#AFB8C1" },
  };
  const tokenOf = { bg: "background", painel: "panel", linha: "border", fg: "ink", kw: "syntax-keyword", str: "syntax-string", num: "syntax-number", com: "subtle", rolagem: "border-strong" } as const;
  const lifted: Record<string, string[]> = { monokai: ["kw", "num"], dracula: [], nord: ["kw", "num", "com"], "github-light": [] };

  it.each(extraThemes)("o tema %s usa as cores do canvas, menos as que sozinhas não passam em 4,5:1 (e essas são as únicas trocadas)", (id) => {
    const theme = themes.find((candidate) => candidate.id === id)!;

    for (const [key, token] of Object.entries(tokenOf)) {
      const wanted = canvas[id][key].toLowerCase();
      if (lifted[id].includes(key)) {
        // A cor do canvas, de fato, não passa em alguma superfície em que o tema a usa; a da ficha é outra, e passa (a bateria abaixo).
        const surfacesOfTheme = [...surfaces.map((surface) => theme.palette[surface]), theme.palette.selection];
        expect(Math.min(...surfacesOfTheme.map((surface) => contrast(wanted, surface))), `${id}: ${key}`).toBeLessThan(4.5);
        expect(theme.palette[token], `${id}: ${key}`).not.toBe(wanted);
      } else {
        expect(theme.palette[token], `${id}: ${key}`).toBe(wanted);
      }
    }
    // O comentário é a mesma cor do texto apagado, como no Prism.
    expect(theme.palette["syntax-comment"]).toBe(theme.palette.subtle);
  });

  // As fichas que cada bloco troca, nem uma a mais. As do canvas todo bloco troca; qualquer outra é uma decisão de cor, e entra em `swapped`
  // com o motivo conferido logo abaixo: a cor que o tema herdaria do esquema dele não passa em alguma superfície dele.
  const fromCanvas = ["background", "panel", "raised", "selected", "selection", "border", "border-strong", "ink", "body", "muted", "subtle", ...syntaxText];
  const swapped: Record<string, string[]> = { monokai: [], dracula: [], nord: ["danger"], "github-light": [] };
  // RN-LINK-001: o azul de link de cada tema (o canvas não o desenha): o do Prism nos dois do Prism, o da paleta do tema nos outros quatro.
  const ownLink = { monokai: "#66d9ef", dracula: "#8be9fd", nord: "#88c0d0", "github-light": "#0967d7" } as const;

  it.each(extraThemes)("o bloco do tema %s troca as fichas do canvas, o azul de link e as da lista de trocadas, nem uma a mais", (id) => {
    expect(Object.keys(themeBlock(id).overrides).sort()).toEqual([...fromCanvas, "link", ...swapped[id]].sort());
  });

  it.each(extraThemes)("o azul de link do tema %s é o da paleta dele (o do GitHub Claro, escurecido o mínimo para passar na linha selecionada)", (id) => {
    expect(themeBlock(id).overrides.link).toBe(ownLink[id]);
  });

  it.each(extraThemes.flatMap((id) => swapped[id].map((token) => [id, token] as const)))("o tema %s troca a ficha %s porque a herdada do esquema não passa em alguma superfície dele, e a trocada passa em todas", (id, token) => {
    const theme = themes.find((candidate) => candidate.id === id)!;
    const inherited = (theme.kind === "dark" ? dark : light)[token];
    const surfacesOfTheme = [...surfaces.map((surface) => theme.palette[surface]), theme.palette.selection];

    expect(theme.palette[token], `${id}: ${token}`).not.toBe(inherited);
    expect(Math.min(...surfacesOfTheme.map((surface) => contrast(inherited, surface))), `${id}: ${token} herdada`).toBeLessThan(4.5);
    expect(Math.min(...surfacesOfTheme.map((surface) => contrast(theme.palette[token], surface))), `${id}: ${token} trocada`).toBeGreaterThanOrEqual(4.5);
  });

  it("a seleção e a linha selecionada se veem contra o fundo, em todos os temas: o texto não passa no contraste só porque a seleção sumiu", () => {
    for (const { name, palette } of themes) {
      expect(contrast(palette.selection, palette.background), `${name}: seleção`).toBeGreaterThanOrEqual(1.15);
      expect(contrast(palette.selected, palette.background), `${name}: linha selecionada`).toBeGreaterThanOrEqual(1.15);
    }
  });
});

describe.each(themes)("contraste do tema $name (WCAG AA: 4,5:1 para texto, sem exceção)", ({ palette, kind }) => {
  it.each(neutralText.flatMap((text) => surfaces.map((surface) => [text, surface] as const)))("texto %s sobre %s", (text, surface) => {
    expect(contrast(palette[text], palette[surface])).toBeGreaterThanOrEqual(4.5);
  });

  // Inclui a linha selecionada: o navegador a usa com a etiqueta do banco (`text-db2` em 11 px) por cima (`navigator-row.tsx`).
  it.each(toneText.flatMap((text) => surfaces.map((surface) => [text, surface] as const)))("tom %s sobre %s (as etiquetas dos bancos, o erro, o sucesso)", (text, surface) => {
    expect(contrast(palette[text], palette[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it("o rótulo do botão principal (panel sobre accent)", () => {
    expect(contrast(palette.panel, palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  // O editor pinta o código sobre o fundo; a lista de sugestões, sobre a superfície elevada e a selecionada; a seleção, por cima de tudo.
  // Selecionar para executar é a interação central do editor: o que está selecionado tem de continuar legível.
  it.each(syntaxText.flatMap((text) => ([...surfaces, "selection"] as const).map((surface) => [text, surface] as const)))("sintaxe %s sobre %s", (text, surface) => {
    expect(contrast(palette[text], palette[surface])).toBeGreaterThanOrEqual(4.5);
  });

  // RN-LINK-001: o nome da tabela com o Ctrl apertado, no editor (sobre o fundo, a linha do cursor e a seleção) e onde mais um link aparecer.
  it.each(([...surfaces, "selection"] as const).map((surface) => [surface] as const))("o azul de link sobre %s", (surface) => {
    expect(contrast(palette.link, palette[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(editorOnSelection))("no editor, %s por cima da seleção", (_what, token) => {
    expect(contrast(palette[token], palette.selection)).toBeGreaterThanOrEqual(4.5);
  });

  // RN-MARCA-006: a marca escolhe a variante pelo esquema do tema (claro ou escuro). O raio e o contorno têm de se ver sobre o fundo de cada tema.
  it.each(["background", "panel"] as const)("o raio e o contorno da marca sobre %s (3:1)", (surface) => {
    expect(contrast(markColors.ray[kind], palette[surface])).toBeGreaterThanOrEqual(3);
    expect(contrast(markColors.rim[kind], palette[surface])).toBeGreaterThanOrEqual(3);
  });

  // `FormMessage`: `border-<tom>/40 bg-<tom>/10 text-<tom>`. O fundo real é o tom a 10% sobre a superfície onde a mensagem está.
  it.each(Object.entries(messageTones).flatMap(([what, tone]) => (["background", "panel", "raised"] as const).map((surface) => [what, tone, surface] as const)))("mensagem de %s (%s a 10 por cento) sobre %s", (_what, tone, surface) => {
    expect(contrast(palette[tone], over(palette[tone], palette[surface], 0.1))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("todos os temas", () => {
  it("a hierarquia do texto se mantém em todos os temas: ink, body, muted, subtle, do mais forte ao mais apagado", () => {
    for (const { name, palette } of themes) {
      const onPanel = (token: string) => contrast(palette[token], palette.panel);
      expect(onPanel("ink"), name).toBeGreaterThan(onPanel("body"));
      expect(onPanel("body"), name).toBeGreaterThan(onPanel("muted"));
      expect(onPanel("muted"), name).toBeGreaterThan(onPanel("subtle"));
    }
  });

  it("são seis, e cada modo de tema (menos o do sistema) é um deles", () => {
    expect(themes.map((theme) => theme.id).sort()).toEqual(themeModes.filter((mode) => mode !== "system").sort());
    expect(themes).toHaveLength(6);
  });
});

describe("a raiz não rola: a área de trabalho não é uma página", () => {
  /** Os valores de uma propriedade (`overflow` pega também `overflow-x` e `overflow-y`) que as regras do CSS dão a um seletor, na ordem do arquivo. */
  const valuesOf = (selector: string, property: "overflow" | "position") =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => rule[1].split(",").some((part) => part.trim() === selector))
      .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${property}${property === "overflow" ? "(?:-[xy])?" : ""}:\\s*([^;]+);`, "g"))].map((declaration) => declaration[1].trim()));

  // Com o documento mais alto que a janela, ele rolava pela roda do mouse (na barra de status, no editor curto, no fim da grade) e por um
  // `focus()` ou `scrollIntoView`. `hidden` ainda deixa o `scrollIntoView` e o `scrollTop` rolarem; `clip` não. Quem precisa rolar tem a própria área.
  it.each(["html", "body"])("%s corta o que passa da janela (overflow: clip), e nenhuma outra regra o troca", (selector) => {
    expect(valuesOf(selector, "overflow")).toEqual(["clip"]);
  });

  // No `html`, o `clip` vai para a janela como `hidden`: quem corta é o `body`. Sem ser posicionado, um `absolute` sem ancestral posicionado tem a
  // janela como bloco, escapa do corte do `body` e dá à janela o que rolar (conferido no Electron: o `scrollIntoView` dele rolava 257 px).
  it("o body é o bloco de quem é absolute sem ancestral posicionado (position: relative), para nada escapar do corte", () => {
    expect(valuesOf("body", "position")).toEqual(["relative"]);
  });
});
