import { CompletionContext, type autocompletion, type CompletionResult } from "@codemirror/autocomplete";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";
import { freezeParseBudget } from "@/lib/testing/parse-budget";
import { withoutCursor } from "@/lib/testing/text";

// A configuração que `sqlCompletion` entrega à biblioteca: é por ela que o teste roda as fontes DE VERDADE do editor (o `override`), com as das variáveis junto.
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

import { sqlCompletion } from "./sql-completion";
import { kindOfType, memberContext, valueBefore, variablesCompletion } from "./variables-completion";
import type { VariableEntry } from "./variables-extension";

freezeParseBudget();

const postgres: Engine = 1;
const db2: Engine = 2;

type Where = { engine?: Engine; explicit?: boolean; values?: Record<string, VariableEntry> };

/** O texto com o cursor no `|`. Devolve o que a fonte das variáveis propõe (ou nulo). */
function propose(text: string, { engine = postgres, explicit = false, values }: Where = {}) {
  const { doc, at } = withoutCursor(text);
  const state = EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] });
  const completion = variablesCompletion({ engine: () => engine, blankLines: () => true, values: () => (values === undefined ? null : new Map(Object.entries(values))) });
  const result = completion.sources[0](new CompletionContext(state, at, explicit)) as CompletionResult | null;

  return { from: result?.from ?? null, labels: (result?.options ?? []).map((option) => option.label), result, quiet: completion.quietsSql(state, at), doc };
}

describe("depois de um @ no SQL (RN-CONFIG-004 e RN-VAR-025)", () => {
  it("completa os nomes declarados acima do cursor, a partir do que vem depois do @", () => {
    const text = "let cliente_id = 1\nconst inicio = '2026-01-01'\nSELECT * FROM t WHERE c = @cli|";
    const { from, labels, doc } = propose(text);

    expect(labels).toEqual(["cliente_id", "inicio"]);
    expect(from).toBe(doc.indexOf("@cli") + 1);
  });

  it("logo depois do @, sem mais nada, também", () => {
    expect(propose("let a = 1\nSELECT @|").labels).toEqual(["a"]);
  });

  it("só os declarados acima: o declarado depois do comando não aparece", () => {
    expect(propose("let a = 1\nSELECT @|\nlet b = 2").labels).toEqual(["a"]);
    expect(propose("SELECT @|;\nlet b = 2").result).toBeNull();
  });

  it("o tipo é o do armazém (o que foi avaliado), ou a anotação da declaração", () => {
    const { result } = propose("let a: number[] = [1]\nlet b = 2\nlet c = 3\nSELECT @|", { values: { b: { type: "number", value: "2", stale: false } } });

    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([
      ["a", "number[]"],
      ["b", "number"],
      ["c", "variável"],
    ]);
  });

  it("não completa dentro de texto, de comentário, de nome entre aspas nem do corpo de uma rotina", () => {
    for (const text of ["let a = 1\nSELECT '@|'", "let a = 1\nSELECT 1 -- @|", 'let a = 1\nSELECT "@|"', "let a = 1\nSELECT /* @| */ 1"]) expect(propose(text).result, text).toBeNull();
    expect(propose("let a = 1\nCREATE PROCEDURE p () BEGIN\n  SELECT @|;\nEND", { engine: db2 }).result).toBeNull();
  });

  it("sem nenhuma variável declarada, nada; e o texto sem let, const nem @ nem é lido", () => {
    expect(propose("SELECT @|").result).toBeNull();
    expect(propose("SELECT 1 FROM t WHERE a = |", { explicit: true }).result).toBeNull();
  });

  it("calam as palavras-chave e os nomes da árvore depois do @ de uma variável, mas não o @ de quem não declarou nada", () => {
    expect(propose("let a = 1\nSELECT @a|").quiet).toBe(true);
    expect(propose("let a = 1\nSELECT * FROM t WHERE b = |").quiet).toBe(false);
    expect(propose("SELECT @co|").quiet).toBe(false);
  });
});

describe("o @ que é operador do PostgreSQL não completa nem cala o SQL (RN-VAR-015)", () => {
  it("o `<@` e o `|@` são operadores no PostgreSQL: nada a completar, e as palavras-chave continuam", () => {
    for (const text of ["let a = 1\nSELECT x <@|", "let a = 1\nSELECT x <@a|", "let a = 1\nSELECT x |@|"]) {
      const { result, quiet } = propose(text);
      expect(result, text).toBeNull();
      expect(quiet, text).toBe(false);
    }
  });

  it("com um espaço antes, ou no Db2 (em que o `@` não é operador), é variável como sempre", () => {
    expect(propose("let a = 1\nSELECT x < @|").labels).toEqual(["a"]);
    expect(propose("let a = 1\nSELECT x <@|", { engine: db2 }).labels).toEqual(["a"]);
    expect(propose("let a = 1\nSELECT x <@a|", { engine: db2 }).quiet).toBe(true);
  });
});

describe("dentro das declarações (RN-CONFIG-004 e RN-VAR-025)", () => {
  it("completa os nomes declarados acima e a lista fechada, a partir da palavra começada", () => {
    const { labels, from, doc } = propose("let base = 10\nlet dobro = ba|");

    expect(labels).toEqual(["base", "Math", "random", "date", "Date", "Number", "String"]);
    expect(from).toBe(doc.indexOf("= ba") + 2);
  });

  it("não propõe o próprio nome nem os declarados abaixo, e só abre sem palavra com o pedido explícito (Ctrl+Espaço)", () => {
    expect(propose("let dobro = 1\nlet outro = |").result).toBeNull();
    expect(propose("let dobro = 1\nlet outro = |", { explicit: true }).labels).toEqual(["dobro", "Math", "random", "date", "Date", "Number", "String"]);
    expect(propose("let a = d|\nlet depois = 1").labels).not.toContain("depois");
  });

  it("depois de um ponto, os membros do espaço de nomes: Math., random., date., Date. e Number.", () => {
    expect(propose("let a = Math.m|").labels).toEqual(expect.arrayContaining(["max", "min", "PI", "E", "floor"]));
    expect(propose("let a = random.|", { explicit: true }).labels).toEqual(["int", "decimal", "bool", "uuid", "string", "pick", "date"]);
    expect(propose("let a = date.|").labels).toEqual(expect.arrayContaining(["today", "addDays", "format"]));
    expect(propose("let a = Date.n|").labels).toEqual(["now"]);
    expect(propose("let a = Number.|").labels).toEqual(["isInteger"]);
  });

  it("depois de um ponto, os métodos da espécie do valor, quando ela se sabe: pela anotação ou pelo tipo do armazém", () => {
    expect(propose("let nome: string = 'x'\nlet b = nome.|").labels).toEqual(expect.arrayContaining(["trim", "toUpperCase"]));
    expect(propose("let ids: number[] = [1]\nlet b = ids.|").labels).toEqual(expect.arrayContaining(["includes", "join"]));
    expect(propose("let n: number = 1\nlet b = n.|").labels).toEqual(expect.arrayContaining(["toFixed"]));
    expect(propose("let dia = date.today()\nlet b = dia.|", { values: { dia: { type: "Date (dia)", value: "2026-10-20", stale: false } } }).labels.length).toBeGreaterThan(0);
    // O tipo que não se sabe (sem anotação e sem valor): nada.
    expect(propose("let x = foo()\nlet b = x.|").result).toBeNull();
    expect(propose("let b = naoexiste.|").result).toBeNull();
  });

  it("não completa no nome, na anotação, dentro de texto ou de comentário", () => {
    for (const text of ["let ba|", "const nome: str|", "let a = 'ba|'", 'let a = "ba|"', "let a = 1 // ba|", "let a = 1 -- ba|", "let a = /* ba| */ 1", "let a = `ba|`", "let a = 10|"]) expect(propose(text, { explicit: false }).result, text).toBeNull();
  });

  it("numa reatribuição, também", () => {
    expect(propose("let alfa = 1\nalfa = al|").labels).toEqual(expect.arrayContaining(["alfa", "Math"]));
  });

  it("calam as palavras-chave e os nomes da árvore dentro da declaração", () => {
    expect(propose("let a = se|").quiet).toBe(true);
    expect(propose("let a = 1\nse|").quiet).toBe(false);
  });
});

describe("as peças do autocompletar", () => {
  it("kindOfType: a espécie do valor pelo tipo escrito como o painel o escreve", () => {
    expect(kindOfType("number")).toBe("number");
    expect(kindOfType("string | null")).toBe("string");
    expect(kindOfType("string[]")).toBe("list");
    expect(kindOfType("number[] | null")).toBe("list");
    expect(kindOfType("Date (dia)")).toBe("date");
    expect(kindOfType("Date")).toBe("date");
    expect(kindOfType("objeto")).toBeNull();
    expect(kindOfType("sql")).toBeNull();
    expect(kindOfType(null)).toBeNull();
  });

  it("valueBefore: o que há depois do = quando o cursor está em código; nulo no nome, na anotação, em texto e em comentário", () => {
    expect(valueBefore("let a = 1 + ba")).toBe(" 1 + ba");
    expect(valueBefore("let a: number = ")).toBe(" ");
    expect(valueBefore("let a")).toBeNull();
    expect(valueBefore("// um = dois\nlet a")).toBeNull();
    expect(valueBefore("let a = 'x")).toBeNull();
    expect(valueBefore("let a = 'x' + b")).toBe(" 'x' + b");
    expect(valueBefore("let a = 'it\\'s' + b")).toBe(" 'it\\'s' + b");
    expect(valueBefore("let a = 1 /* x")).toBeNull();
    expect(valueBefore("let a = 1 /* x */ + b")).toBe(" 1 /* x */ + b");
  });

  it("memberContext: o dono e a palavra começada", () => {
    expect(memberContext(" Math.ma")).toEqual({ owner: "Math", partial: "ma" });
    expect(memberContext(" Math . ")).toEqual({ owner: "Math", partial: "" });
    expect(memberContext(" 1 + ba")).toEqual({ owner: null, partial: "ba" });
    expect(memberContext(" f(x).")).toEqual({ owner: null, partial: "" });
  });
});

describe("na lista do editor (sqlCompletion)", () => {
  const run = (text: string) => {
    configured.length = 0;
    const { doc, at } = withoutCursor(text);
    const completion = variablesCompletion({ engine: () => postgres, blankLines: () => true, values: () => null });
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [], variables: completion });
    const state = EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] });
    const sources = configured.at(-1)!.override!;
    return sources.map((source) => source(new CompletionContext(state, at, true)) as CompletionResult | null);
  };

  it("junta as fontes das variáveis às de sempre; sem variáveis, as de sempre", () => {
    configured.length = 0;
    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [] });
    expect(configured.at(-1)!.override).toHaveLength(2);

    sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [], variables: variablesCompletion({ engine: () => postgres, blankLines: () => true, values: () => null }) });
    expect(configured.at(-1)!.override).toHaveLength(3);
  });

  it("dentro de uma declaração só as variáveis completam; no SQL, as palavras-chave continuam", () => {
    const inside = run("let nome = 1\nlet outro = n|");
    expect(inside[0]).toBeNull();
    expect(inside[2]?.options.map((option) => option.label)).toContain("nome");

    const outside = run("let nome = 1\nSEL|");
    expect(outside[0]?.options.map((option) => option.label)).toContain("select");
    expect(outside[2]).toBeNull();
  });

  it("depois do @ de uma variável, só os nomes dela", () => {
    const [keywords, names, variables] = run("let nome = 1\nSELECT @n|");

    expect(keywords).toBeNull();
    expect(names).toBeNull();
    expect(variables?.options.map((option) => option.label)).toEqual(["nome"]);
  });
});
