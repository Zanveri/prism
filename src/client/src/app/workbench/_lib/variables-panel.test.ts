import { describe, expect, it } from "vitest";

import { clockText, copyTextOf, emptyView, listPage, navigate, panelRows, showMoreOf, type PanelView } from "./variables-panel";
import { Random } from "./variables/random";
import { ScriptRun } from "./variables/run";
import { readScript } from "./variables/script";

// O painel "Variáveis" (RN-VAR-024): as linhas, a árvore, o teclado e o que o Ctrl+C copia.
const config = { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => new Date(2026, 9, 20, 14, 32, 5).getTime() };

function setup(source: string, evaluate?: number[]) {
  const model = readScript(source, undefined, { blankLines: true });
  const run = new ScriptRun(model, config);
  for (const item of model.items) if (item.parsed !== null && (evaluate === undefined || evaluate.includes(item.index))) run.evaluate(item.index);
  return { model, snapshot: { values: run.tab, counter: run.counter } };
}

const open = (...keys: string[]): PanelView => ({ ...emptyView, open: new Set(keys) });

describe("panelRows: uma linha por variável, na ordem do texto", () => {
  const source = "let x = 5\nconst nome = 'Ana'\nlet ids = [1, 2, 3]\nlet p = { id: 7, nome: 'Ana' }\nlet nada = null\nlet sem: number\nconst filtro: sql = 'id > 3'";

  it("o nome, o tipo, o valor curto, a origem e a hora local", () => {
    const { model, snapshot } = setup(source);
    const rows = panelRows(model, snapshot);
    expect(rows.map((row) => row.name)).toEqual(["x", "nome", "ids", "p", "nada", "sem", "filtro"]);
    expect(rows[0]).toMatchObject({ type: "number", value: "5", origin: "literal", when: "14:32:05", stale: false, expandable: false, level: 1 });
    expect(rows[1]).toMatchObject({ type: "string", value: "'Ana'" });
    expect(rows[2]).toMatchObject({ type: "number[]", value: "3 itens [1, 2, 3]", expandable: true, expanded: false });
    expect(rows[3]).toMatchObject({ type: "objeto", value: "2 campos { id: 7, nome: 'Ana' }", expandable: true });
    expect(rows[4]).toMatchObject({ isNull: true });
    expect(rows[6]).toMatchObject({ isSql: true, type: "sql" });
  });

  it("a declarada sem valor aparece com “sem valor”, apagada", () => {
    const { model, snapshot } = setup(source);
    const without = panelRows(model, snapshot).find((row) => row.name === "sem");
    expect(without).toMatchObject({ noValue: true, value: "sem valor", origin: null, when: null, raw: null });
  });

  it("a que o texto mudou desde a avaliação está desatualizada", () => {
    const { snapshot } = setup("let x = 5\nconst y = x * 2");
    const changed = readScript("let x = 6\nconst y = x * 2", undefined, { blankLines: true });
    expect(panelRows(changed, snapshot).map((row) => row.stale)).toEqual([true, true]);
  });

  it("a variável que saiu do texto sai do painel", () => {
    const { snapshot } = setup("let x = 5\nlet y = 6");
    const shorter = readScript("let x = 5", undefined, { blankLines: true });
    expect(panelRows(shorter, snapshot).map((row) => row.name)).toEqual(["x"]);
  });
});

describe("a lista e o objeto abrem como árvore", () => {
  const { model, snapshot } = setup("let ids = [10, 20, 30]\nlet p = { id: 7, tags: ['a', 'b'] }");

  it("fechados, só a variável; abertos, um item ou um campo por linha, no nível de baixo", () => {
    expect(panelRows(model, snapshot).map((row) => row.key)).toEqual(["ids", "p"]);
    const rows = panelRows(model, snapshot, open("ids", "p"));
    expect(rows.map((row) => [row.key, row.level, row.name])).toEqual([
      ["ids", 1, "ids"],
      ["ids/0", 2, "[0]"],
      ["ids/1", 2, "[1]"],
      ["ids/2", 2, "[2]"],
      ["p", 1, "p"],
      ["p/id", 2, "id"],
      ["p/tags", 2, "tags"],
    ]);
    expect(rows[1]).toMatchObject({ type: "number", value: "10", parent: "ids", variable: "ids", origin: null });
  });

  it("a lista dentro do objeto abre também", () => {
    const rows = panelRows(model, snapshot, open("p", "p/tags"));
    expect(rows.filter((row) => row.parent === "p/tags").map((row) => row.value)).toEqual(["'a'", "'b'"]);
  });

  it("a lista longa mostra os 100 primeiros e “Mostrar mais 100 (de N)”, que cresce de 100 em 100", () => {
    const long = setup("let ids = " + JSON.stringify(Array.from({ length: 1234 }, (_, index) => index)));
    const first = panelRows(long.model, long.snapshot, open("ids"));
    expect(first).toHaveLength(1 + listPage + 1);
    const more = first[first.length - 1];
    expect(more).toMatchObject({ kind: "more", name: "Mostrar mais 100 (de 1.234)", more: { shown: 100, total: 1234 }, parent: "ids" });

    expect(showMoreOf(100, 1234)).toBe(200);
    expect(showMoreOf(1200, 1234)).toBe(1234);
    const second = panelRows(long.model, long.snapshot, { open: new Set(["ids"]), shown: new Map([["ids", 200]]) });
    expect(second).toHaveLength(1 + 200 + 1);
    const all = panelRows(long.model, long.snapshot, { open: new Set(["ids"]), shown: new Map([["ids", 1234]]) });
    expect(all.some((row) => row.kind === "more")).toBe(false);
  });
});

describe("copyTextOf: o que o Ctrl+C copia", () => {
  const { model, snapshot } = setup("let n = 12.50\nlet s = 'Ana'\nlet l = ['a', 'b']\nlet o = { id: 7, nome: 'Ana' }\nlet d = date.of(2026, 10, 20)\nlet z = null");
  const text = (name: string) => copyTextOf(panelRows(model, snapshot).find((row) => row.name === name)!);

  it("o simples como texto, sem aspas; o número como está", () => {
    expect(text("n")).toBe("12.50");
    expect(text("s")).toBe("Ana");
    expect(text("d")).toBe("2026-10-20");
  });

  it("a lista e o objeto como JSON", () => {
    expect(text("l")).toBe('["a","b"]');
    expect(text("o")).toBe('{"id":7,"nome":"Ana"}');
  });

  it("sem valor, nada", () => {
    const without = setup("let sem: number");
    expect(copyTextOf(panelRows(without.model, without.snapshot)[0])).toBeNull();
  });
});

describe("navigate: o teclado da árvore", () => {
  const { model, snapshot } = setup("let ids = [10, 20]\nlet x = 1");
  const closed = panelRows(model, snapshot);
  const opened = panelRows(model, snapshot, open("ids"));

  it("as setas, Home e End andam pelas linhas visíveis, sem passar das pontas", () => {
    expect(navigate(opened, "ids", "ArrowDown")).toEqual({ focus: "ids/0" });
    expect(navigate(opened, "ids/1", "ArrowDown")).toEqual({ focus: "x" });
    expect(navigate(opened, "x", "ArrowDown")).toEqual({ focus: "x" });
    expect(navigate(opened, "ids", "ArrowUp")).toEqual({ focus: "ids" });
    expect(navigate(opened, "ids/1", "Home")).toEqual({ focus: "ids" });
    expect(navigate(opened, "ids", "End")).toEqual({ focus: "x" });
  });

  it("a seta para a direita abre; aberta, vai ao primeiro filho; a da esquerda fecha, ou vai ao pai", () => {
    expect(navigate(closed, "ids", "ArrowRight")).toEqual({ focus: "ids", open: "ids" });
    expect(navigate(opened, "ids", "ArrowRight")).toEqual({ focus: "ids/0" });
    expect(navigate(opened, "ids", "ArrowLeft")).toEqual({ focus: "ids", close: "ids" });
    expect(navigate(opened, "ids/1", "ArrowLeft")).toEqual({ focus: "ids" });
    expect(navigate(closed, "x", "ArrowRight")).toEqual({ focus: "x" });
  });

  it("outra tecla segue o caminho dela", () => {
    expect(navigate(closed, "x", "a")).toBeNull();
    expect(navigate([], null, "ArrowDown")).toBeNull();
  });
});

describe("clockText", () => {
  it("a hora local com dois dígitos", () => {
    expect(clockText(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("03:04:05");
  });
});
