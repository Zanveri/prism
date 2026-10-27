import { createElement, type CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { RowsState, RunnerState } from "../_lib/use-query-runner";
import { createScriptRun, finishRun, withEntry, type ScriptRun } from "../_lib/script-run";
import { ResultPanel } from "./result-panel";
import { ResultTabs, ScriptTabs } from "./script-tabs";

// A cor do ambiente da aba na área de resultado (RN-AMB-002), sem DOM: o que a `<section>` da área põe no `style`, o que o título "Registros"/"Resultado" e as
// abas do script pintam com ela, e que sem ela (ou com uma cor que não é `#RRGGBB`) nada muda. O valor calculado na tela se confere no app, sob Xvfb.

// A área de resultado lê as preferências da grade (o tipo no cabeçalho, o zoom); aqui valem as de saída.
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

const noop = () => {};
const border = "border-[color:var(--environment-color,var(--color-accent))]";

const rows: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select 1", offset: 0 },
  columns: [{ name: "id", type: "int4", kind: "number" }],
  rows: [["1"], ["2"]],
  truncated: new Map(),
  hasMore: false,
  totalRows: null,
  elapsedMs: 42,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
};
/** Um script de três comandos, cada um com o resultado guardado: três abas de resultado, "Estatísticas" por último. */
function scriptOf(): ScriptRun {
  let run = createScriptRun(1, Array.from({ length: 3 }, (_, index) => ({ sql: `select ${index + 1}`, offset: index * 10 })));
  for (let index = 0; index < 3; index++) run = withEntry(run, index, { status: "ok", rows: { read: 1, more: false, total: null }, kept: true });
  return { ...finishRun(run, "done"), results: Array.from({ length: 3 }, (_, entry) => ({ entry, rows })), live: 2 };
}
const records = { name: "loja.pedidos", onRefresh: noop, onCancel: noop, onExport: noop, waiting: false, disconnected: false };

type Props = Partial<Parameters<typeof ResultPanel>[0]>;
const render = (props: Props = {}) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResultPanel, { state: rows, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, ...props })));

/** A tag de abertura da `<section>` da área: onde a variável e o `style` de quem chama têm de estar. */
const sectionTag = (markup: string) => /<section\b[^>]*>/.exec(markup)?.[0] ?? "";
/** O atributo `style` de uma tag, ou `null` sem ele. */
const styleOf = (tag: string) => /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? null;
/** As classes do `<h2>` do título. */
const titleClass = (markup: string) => /<h2 class="([^"]*)"/.exec(markup)?.[1] ?? "";

describe("a área de resultado põe a cor do ambiente na própria <section> (RN-AMB-002)", () => {
  it("com uma cor #RRGGBB, a <section> leva `--environment-color` com as duas variantes do ícone colorido", () => {
    expect(styleOf(sectionTag(render({ environmentColor: "#FF8A7A" })))).toBe("--environment-color:light-dark(#C46A5E, #FF8A7A)");
    expect(styleOf(sectionTag(render({ environmentColor: "#F2B644", records })))).toBe("--environment-color:light-dark(#A77E2F, #F2B644)");
  });

  it("a variável existe uma vez só, na <section>: o que está dentro herda pelo DOM, e a janela do resultado leva a <section> junto", () => {
    const markup = render({ environmentColor: "#FF8A7A" });

    expect(markup.match(/--environment-color:/g)).toHaveLength(1);
    expect(markup.indexOf("--environment-color:")).toBeLessThan(markup.indexOf("</section>"));
    expect(markup.startsWith("<section")).toBe(true);
  });

  it("minúsculas dão o mesmo valor das maiúsculas", () => {
    expect(styleOf(sectionTag(render({ environmentColor: "#ff8a7a" })))).toBe("--environment-color:light-dark(#C46A5E, #FF8A7A)");
  });

  it("o `style` de quem chama continua lá, junto da variável, e não é alterado por ela", () => {
    const style: CSSProperties = { flex: "3 1 0%" };
    const tag = sectionTag(render({ style, environmentColor: "#FF8A7A" }));

    expect(styleOf(tag)).toBe("flex:3 1 0%;--environment-color:light-dark(#C46A5E, #FF8A7A)");
    expect(style).toEqual({ flex: "3 1 0%" });
  });

  it.each([
    ["nula", null],
    ["ausente", undefined],
    ["vazia", ""],
    ["fora do formato", "#12345"],
    ["um nome de cor", "red"],
    ["com CSS atrás", "#FF8A7A;color:red"],
    ["uma função", "light-dark(#FF8A7A, #FF8A7A)"],
  ] as const)("cor %s: nenhuma variável, em qualquer lugar da área, e o `style` de quem chama como veio", (_name, environmentColor) => {
    const markup = render({ environmentColor, style: { flex: "3 1 0%" } });

    // O nome da variável também está nas classes da grade (a reserva do tema); o que não pode haver é ela sendo DADA a algum elemento.
    expect(markup).not.toContain("--environment-color:");
    expect(styleOf(sectionTag(markup))).toBe("flex:3 1 0%");
  });

  it("sem cor e sem `style`, a <section> não ganha atributo de estilo nenhum", () => {
    for (const environmentColor of [undefined, null, "red"]) expect(styleOf(sectionTag(render({ environmentColor })))).toBeNull();
  });

  it("vale em qualquer estado da área, recolhida ou com erro, nos Registros e no resultado de uma consulta", () => {
    const error: RunnerState = { status: "error", source: "database", title: "Erro do banco", message: "syntax error", sqlState: "42601", errorAt: null };
    const states: [string, Props][] = [
      ["linhas", { state: rows }],
      ["linhas nos Registros", { state: rows, records }],
      ["sem comando", { state: { status: "idle" } }],
      ["erro", { state: error }],
      ["executando", { state: { status: "running", cancelling: false, previous: rows } }],
      ["recolhida", { state: rows, collapsed: true }],
    ];

    for (const [name, props] of states) expect(styleOf(sectionTag(render({ ...props, environmentColor: "#7DB2FF" }))), name).toBe("--environment-color:light-dark(#5E86BF, #7DB2FF)");
  });
});

describe("o sublinhado do título da área na cor do ambiente (RN-AMB-002)", () => {
  it("'Registros' e 'Resultado' leem a variável, com o acento do tema como reserva, e não o acento direto", () => {
    for (const props of [{ records }, {}] satisfies Props[]) {
      for (const environmentColor of ["#FF8A7A", null]) {
        const classes = titleClass(render({ ...props, environmentColor }));

        expect(classes.split(" ")).toContain(border);
        expect(classes).toContain("border-b-2");
        expect(classes).not.toMatch(/(^| )border-accent( |$)/);
      }
    }
  });

  it("o título é o de sempre: 'Registros' nos Registros da tabela, 'Resultado' na consulta, e o tamanho de cada um", () => {
    expect(render({ records, environmentColor: "#FF8A7A" })).toMatch(/<h2 class="[^"]*h-9 px-2\.5[^"]*">Registros<\/h2>/);
    expect(render({ environmentColor: "#FF8A7A" })).toMatch(/<h2 class="[^"]*h-7 px-2[^"]*">Resultado<\/h2>/);
  });

  it("com as abas do script no lugar do título, não há título, e a aba escolhida é que leva o sublinhado (dentro da <section>, onde a variável está)", () => {
    const list = createElement(ScriptTabs, { run: scriptOf(), shown: 0, idPrefix: "t", panelId: "t-panel", onChoose: noop });
    const markup = render({ environmentColor: "#FF8A7A", tabs: { list, panelId: "t-panel", labelledBy: "t-0" } });

    expect(markup).not.toContain("<h2");
    expect(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>/.exec(markup)?.[0]).toContain(border);
    expect(markup.indexOf("--environment-color:")).toBeLessThan(markup.indexOf('role="tab"'));
  });
});

describe("a grade dentro da área leva a classe do foco e da rolagem (RN-AMB-002)", () => {
  it("a caixa que rola da grade lê a variável no anel do foco e na barra de rolagem, e a área não repete isso em outro elemento", () => {
    const markup = render({ environmentColor: "#FF8A7A" });
    const box = /<div[^>]*role="table"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(box).toContain("focus-visible:outline-[color:var(--environment-color,var(--color-accent))]");
    expect(box).toContain("[scrollbar-color:var(--environment-color,var(--color-border-strong))_var(--color-panel)]");
    expect(markup.match(/\[scrollbar-color:/g)).toHaveLength(1);
  });

  it("sem cor, a mesma caixa: o tema fica na reserva da classe, e não numa classe a menos", () => {
    const withColor = /<div[^>]*role="table"[^>]*>/.exec(render({ environmentColor: "#FF8A7A" }))?.[0];
    const without = /<div[^>]*role="table"[^>]*>/.exec(render({ environmentColor: null }))?.[0];

    expect(without).toBe(withColor);
  });
});

describe("as abas do script e as de 'Resultado | Variáveis' sublinham a escolhida na cor do ambiente (RN-AMB-002)", () => {
  const tabsOf = (markup: string) => [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => ({ selected: /aria-selected="true"/.test(match[0]), classes: /class="([^"]*)"/.exec(match[0])?.[1].split(" ") ?? [] }));

  it("ScriptTabs: a escolhida tem a borda do ambiente e o negrito; as outras, a transparente, e nenhuma o acento direto", () => {
    for (const shown of [0, 1, 2, "statistics"] as const) {
      const tabs = tabsOf(renderToStaticMarkup(createElement(ScriptTabs, { run: scriptOf(), shown, idPrefix: "t", panelId: "t-panel", onChoose: noop })));

      expect(tabs).toHaveLength(4);
      expect(tabs.filter((tab) => tab.selected), String(shown)).toHaveLength(1);
      for (const tab of tabs) {
        expect(tab.classes).toContain("border-b-2");
        expect(tab.classes).not.toContain("border-accent");
        if (tab.selected) {
          expect(tab.classes).toContain(border);
          expect(tab.classes).toContain("font-semibold");
          expect(tab.classes).not.toContain("border-transparent");
        } else {
          expect(tab.classes).toContain("border-transparent");
          expect(tab.classes).not.toContain(border);
        }
      }
    }
  });

  it("ScriptTabs com a aba Variáveis: ela também é sublinhada quando escolhida", () => {
    const tabs = tabsOf(renderToStaticMarkup(createElement(ScriptTabs, { run: scriptOf(), shown: "variables", variables: true, idPrefix: "t", panelId: "t-panel", onChoose: noop })));

    expect(tabs).toHaveLength(5);
    expect(tabs.filter((tab) => tab.selected)).toHaveLength(1);
    expect(tabs.find((tab) => tab.selected)?.classes).toContain(border);
    expect(tabs.filter((tab) => !tab.selected).every((tab) => tab.classes.includes("border-transparent"))).toBe(true);
  });

  it("ResultTabs ('Resultado' e 'Variáveis'): a escolhida tem a borda do ambiente, as outras a transparente", () => {
    for (const shown of ["result", "variables"] as const) {
      const tabs = tabsOf(renderToStaticMarkup(createElement(ResultTabs, { shown, idPrefix: "t", panelId: "t-panel", onChoose: noop })));

      expect(tabs).toHaveLength(2);
      expect(tabs.map((tab) => tab.selected)).toEqual([shown === "result", shown === "variables"]);
      for (const tab of tabs) {
        expect(tab.classes).toContain(tab.selected ? border : "border-transparent");
        expect(tab.classes).not.toContain("border-accent");
      }
    }
  });
});
