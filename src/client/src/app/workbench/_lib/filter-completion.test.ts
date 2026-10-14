import { CompletionContext, type autocompletion, type CompletionResult } from "@codemirror/autocomplete";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";
import { freezeParseBudget } from "@/lib/testing/parse-budget";

// A configuração que `filterCompletion` entrega à biblioteca, anotada: é por ela que o teste confere a chave do autocompletar ao digitar (RN-CONFIG-004) e
// roda a fonte de verdade do campo, e não uma cópia dela.
type CompletionConfig = NonNullable<Parameters<typeof autocompletion>[0]>;
const configured = vi.hoisted(() => [] as CompletionConfig[]);
vi.mock("@codemirror/autocomplete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@codemirror/autocomplete")>();
  return {
    ...real,
    autocompletion: (config: CompletionConfig) => {
      configured.push(config);
      return real.autocompletion(config);
    },
  };
});

import { filterCompletion, filterCompletionSource, filterKeywords, type FilterColumn } from "./filter-completion";

freezeParseBudget();

// RN-TABELA-011: o campo de filtro (dos Registros e do resultado) completa os nomes das colunas e as palavras do filtro.
const columns: FilterColumn[] = [
  { name: "id", type: "int4" },
  { name: "code", type: "varchar" },
  { name: "CodigoBarras", type: "text" },
  { name: "order", type: "int4" },
  { name: "valor total", type: "numeric" },
];

function run(text: string, { engine = 1 as Engine, explicit = false, cols = columns } = {}) {
  const at = text.indexOf("|");
  const doc = text.replace("|", "");
  const state = EditorState.create({ doc, extensions: [sql({ dialect: engine === 1 ? PostgreSQL : StandardSQL })] });
  return filterCompletionSource(() => cols, () => engine)(new CompletionContext(state, at, explicit)) as CompletionResult | null;
}

const labelsOf = (result: CompletionResult | null) => result?.options.map((option) => option.label) ?? null;
const applyOf = (result: CompletionResult | null, label: string) => {
  const option = result?.options.find((candidate) => candidate.label === label);
  return option === undefined ? undefined : (option.apply ?? option.label);
};

describe("filterCompletionSource: as colunas e as palavras do filtro", () => {
  it("ao digitar, as colunas (com o tipo) e as palavras do filtro, as colunas antes", () => {
    const result = run("co|");

    expect(result?.from).toBe(0);
    expect(labelsOf(result)).toEqual(["id", "code", "CodigoBarras", "order", "valor total", ...filterKeywords]);
    expect(result?.options.find((option) => option.label === "code")).toMatchObject({ type: "property", detail: "varchar", boost: 1 });
    expect(result?.options.find((option) => option.label === "IS NOT NULL")).toMatchObject({ type: "keyword", boost: -1 });
  });

  it("as palavras do filtro são as da regra", () => {
    expect([...filterKeywords]).toEqual(["AND", "OR", "NOT", "IS NULL", "IS NOT NULL", "LIKE", "IN", "BETWEEN", "ORDER BY", "ASC", "DESC"]);
  });

  it("o nome sai como o banco pede: cru quando o banco o lê como está, entre aspas no resto (a palavra reservada também)", () => {
    const pg = run("x|");
    expect(applyOf(pg, "code")).toBe("code");
    expect(applyOf(pg, "CodigoBarras")).toBe('"CodigoBarras"');
    expect(applyOf(pg, "order")).toBe('"order"');
    expect(applyOf(pg, "valor total")).toBe('"valor total"');

    // O Db2 dobra o nome sem aspas para MAIÚSCULAS: `code` cru acharia CODE.
    const db2 = run("x|", { engine: 2, cols: [{ name: "CODE" }, { name: "code" }] });
    expect(applyOf(db2, "CODE")).toBe("CODE");
    expect(applyOf(db2, "code")).toBe('"code"');
  });

  it("depois de outras palavras, a palavra do cursor (a lista recomeça a cada palavra)", () => {
    const text = "code = 'a' an|";
    expect(run(text)?.from).toBe(text.indexOf("an"));
  });

  it("as palavras de mais de uma palavra continuam depois do espaço: `is n` sugere IS NULL e IS NOT NULL, `order` sugere ORDER BY", () => {
    const text = "code is n|";
    const result = run(text);

    expect(result?.from).toBe("code ".length);
    expect(labelsOf(result)).toEqual(["IS NULL", "IS NOT NULL"]);
    expect(labelsOf(run("code IS NOT |"))).toEqual(["IS NOT NULL"]);
    expect(labelsOf(run("code = 1 order b|"))).toEqual(["ORDER BY"]);
    // A palavra que não começa nenhuma delas volta à lista de sempre.
    expect(labelsOf(run("code is x|"))).toContain("code");
  });

  it("com as aspas já abertas, o nome inteiro entre aspas, sem palavras do filtro", () => {
    const result = run('"Cod|');

    expect(result?.from).toBe(0);
    expect(labelsOf(result)).toEqual(['"id"', '"code"', '"CodigoBarras"', '"order"', '"valor total"']);
  });

  it("dentro de texto entre aspas simples, de comentário e depois de um ponto, nada", () => {
    expect(run("code = 'ab|")).toBeNull();
    expect(run("code = 1 -- no|")).toBeNull();
    expect(run("code = 1 /* no| */")).toBeNull();
    expect(run("t.co|")).toBeNull();
  });

  it("sem palavra começada, só com Ctrl+Espaço (o pedido explícito)", () => {
    expect(run("code = 1 |")).toBeNull();
    expect(run("code = 1 |", { explicit: true })?.from).toBe("code = 1 ".length);
  });

  it("as colunas são lidas na hora do pedido: a lista acompanha o resultado na tela", () => {
    let now: FilterColumn[] = [{ name: "a" }];
    const source = filterCompletionSource(() => now, () => 1);
    const state = EditorState.create({ doc: "x", extensions: [sql({ dialect: PostgreSQL })] });

    expect((source(new CompletionContext(state, 1, false)) as CompletionResult).options[0].label).toBe("a");
    now = [{ name: "b" }];
    expect((source(new CompletionContext(state, 1, false)) as CompletionResult).options[0].label).toBe("b");
  });
});

describe("filterCompletion: segue a chave do autocompletar do editor (RN-CONFIG-004)", () => {
  it("ao digitar, abre só com a chave ligada; a lista abre sem nada escolhido e filtra por prefixo; Ctrl+Espaço fica no mapa da biblioteca", () => {
    configured.length = 0;
    filterCompletion({ columns: () => columns, engine: () => 1, activateOnTyping: true });
    filterCompletion({ columns: () => columns, engine: () => 1, activateOnTyping: false });

    expect(configured.map((config) => config.activateOnTyping)).toEqual([true, false]);
    for (const config of configured) {
      expect(config).toMatchObject({ selectOnOpen: false, filterStrict: true, icons: false });
      // O mapa padrão da biblioteca (Ctrl+Espaço abre a lista) não é desligado.
      expect(config.defaultKeymap).not.toBe(false);
      expect(config.override).toHaveLength(1);
    }
  });
});
