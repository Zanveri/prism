import { describe, expect, it } from "vitest";

import { loadQuestion } from "../command-confirmation";
import { commitEveryOf, defaultImportChoices, importChoicesKey, parseImportChoices, readImportChoices, writeImportChoices } from "./import-choices";
import { commitEveryOfChoices, commitProblem, informixNote, loadSummary, loadWarnings, referenceWarnings, tablesText } from "./import-load";

const table = (change: Partial<{ referencedBy: { schema: string; table: string; onDelete: "cascade" | "setNull" | "setDefault" | "restrict" | "noAction" }[]; oneAtATime: boolean }> = {}) => ({
  schema: "estoque",
  name: "pedido",
  oneAtATime: false,
  referencedBy: [],
  ...change,
});

describe("as chaves que apontam para a tabela, com \"Esvaziar\" (RN-IMPORT-012)", () => {
  it("agrupadas pela regra: a cascata, o nulo ou o padrão, e as que impedem; a própria tabela fica de fora; a tabela de outro esquema leva o esquema", () => {
    const warnings = referenceWarnings(
      table({
        referencedBy: [
          { schema: "estoque", table: "item_pedido", onDelete: "cascade" },
          { schema: "fiscal", table: "nota_item", onDelete: "cascade" },
          { schema: "estoque", table: "pedido", onDelete: "cascade" },
          { schema: "estoque", table: "cliente_log", onDelete: "setNull" },
          { schema: "estoque", table: "devolucao", onDelete: "noAction" },
          { schema: "estoque", table: "devolucao", onDelete: "restrict" },
        ],
      }),
      false,
    );
    expect(warnings).toEqual([
      "A exclusão em cascata apaga também linhas de item_pedido e fiscal.nota_item.",
      "A exclusão também altera linhas de cliente_log: as colunas delas que apontam para pedido ficam nulas.",
      "As linhas de devolucao que apontam para pedido impedem o esvaziamento: se houver alguma, o banco recusa o DELETE, e a importação para sem gravar nada.",
    ]);
  });

  it("com mais de cinco num grupo, as cinco primeiras e \"(e mais N)\"; o nulo e o padrão juntos dizem os dois; sem log, a recusa no meio pode já ter apagado parte", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ schema: "estoque", table: `t${i + 1}`, onDelete: "cascade" as const }));
    expect(tablesText(many, "estoque")).toBe("t1, t2, t3, t4, t5 (e mais 3)");
    expect(referenceWarnings(table({ referencedBy: [{ schema: "estoque", table: "a", onDelete: "setNull" }, { schema: "estoque", table: "b", onDelete: "setDefault" }] }), true)[0]).toBe(
      "A exclusão também altera linhas de a e b: as colunas delas que apontam para pedido ficam nulas (ou com o padrão).",
    );
    expect(referenceWarnings(table({ oneAtATime: true, referencedBy: [{ schema: "estoque", table: "d", onDelete: "restrict" }] }), true)[0]).toBe(
      "As linhas de d que apontam para pedido impedem o esvaziamento: se houver alguma, o banco recusa o DELETE, e a cópia para sem gravar nada. Sem log de transação, o DELETE que o banco recusa no meio pode já ter apagado parte das linhas.",
    );
  });
});

describe("o \"Commit\" e os avisos da Carga (RN-IMPORT-012)", () => {
  it("o N vai de 1 a 1.000.000, só com dígitos; em \"Tudo numa transação só\" e no Informix sem log, nada a recusar", () => {
    expect(["1", "10000", "1000000", " 5 "].map(commitEveryOf)).toEqual([1, 10_000, 1_000_000, 5]);
    expect(["0", "1000001", "1.000", "-1", "", "abc"].map(commitEveryOf)).toEqual([null, null, null, null, null, null]);
    expect(commitProblem({ commit: "every", commitEvery: "0" }, false)).toBe("Use de 1 a 1.000.000 linhas.");
    expect(commitProblem({ commit: "single", commitEvery: "0" }, false)).toBeNull();
    expect(commitProblem({ commit: "every", commitEvery: "0" }, true)).toBeNull();
    expect(commitEveryOfChoices({ commit: "single", commitEvery: "500" })).toBeNull();
    expect(commitEveryOfChoices({ commit: "every", commitEvery: "500" })).toBe(500);
  });

  it("com \"Esvaziar\" e \"A cada N linhas\": o que ele apaga, as chaves e o esvaziamento confirmado com as primeiras N; sem log, cada linha gravada sozinha", () => {
    expect(loadWarnings(table(), { empty: true, commit: { commit: "every", commitEvery: "10000" } }, false)).toEqual([
      "Todas as linhas de estoque.pedido serão apagadas antes da importação.",
      "O esvaziamento é confirmado junto com as primeiras 10.000 linhas. Se a importação parar depois disso, as linhas antigas não voltam: a tabela fica só com as importadas até ali. Para tudo ou nada, escolha Tudo numa transação só.",
    ]);
    expect(loadWarnings(table(), { empty: true, commit: { commit: "single", commitEvery: "10000" } }, true)).toEqual(["Todas as linhas de estoque.pedido serão apagadas antes da cópia."]);
    expect(loadWarnings(table({ oneAtATime: true }), { empty: false, commit: { commit: "every", commitEvery: "10000" } }, false)).toEqual([
      "Este banco não tem log de transação: cada linha é gravada sozinha, na hora. Se a importação parar, as linhas anteriores já estão gravadas, e o esvaziamento não volta atrás.",
    ]);
    expect(informixNote(3)).toBe("No Informix cada linha vai num comando: muitas linhas levam mais tempo que nos outros bancos.");
    expect(informixNote(1)).toBeNull();
  });

  it("a linha \"Carga\" da Confirmação, com cada parte só quando vale", () => {
    const every = { commit: "every" as const, commitEvery: "10000" };
    expect(loadSummary({ empty: true, commit: every, check: true }, false)).toBe("Esvazia a tabela antes · confere o arquivo antes · commit a cada 10.000 linhas");
    expect(loadSummary({ empty: false, commit: { commit: "single", commitEvery: "10000" }, check: false }, false)).toBe("Sem conferir o arquivo antes · numa transação só");
    expect(loadSummary({ empty: true, commit: every, check: null }, true)).toBe("Esvazia a tabela antes · cada linha gravada sozinha");
  });
});

describe("o aviso da RN-PROT-001 na importação e na cópia, pela conexão de destino", () => {
  const load = { empty: false, title: "Importar dados?", does: "Grava as linhas de pedidos.csv em estoque.pedido.", commands: ['INSERT INTO "estoque"."pedido" ("id") VALUES (…)'], confirm: "Importar mesmo assim" };
  const protections = (level: "all" | "irreversible" | null) => ({ confirm: level === null ? null : { level, from: null }, readOnly: null });

  it("em \"Todos os comandos\", sempre; em \"Só comandos irreversíveis\", só com o esvaziamento (o DELETE sem WHERE); sem a proteção, nunca", () => {
    expect(loadQuestion(protections("all"), load)).toEqual({ kind: "load", ...{ title: load.title, does: load.does, commands: load.commands, confirm: load.confirm } });
    expect(loadQuestion(protections("irreversible"), load)).toBeNull();
    expect(loadQuestion(protections("irreversible"), { ...load, empty: true })?.kind).toBe("load");
    expect(loadQuestion(protections(null), { ...load, empty: true })).toBeNull();
  });
});

describe("as escolhas lembradas da importação (RN-IMPORT-002)", () => {
  it("os padrões: a codificação e o separador automáticos, o cabeçalho, as aspas duplas, o apóstrofo da proteção tirado, ponto, aaaa-mm-dd, commit a cada 10.000 e a conferência", () => {
    const choices = defaultImportChoices();
    expect(choices.csv).toEqual({ encoding: "auto", delimiter: "auto", header: true, quote: "double", nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true });
    expect(choices.values).toEqual({ decimal: "point", thousandsDot: false, dates: "iso" });
    expect(choices.load).toEqual({ commit: "every", commitEvery: "10000", check: true });
  });

  it("a leitura é tolerante campo a campo: o que não vale volta ao padrão, e o ponto de milhar sem a vírgula decimal sai", () => {
    const parsed = parseImportChoices(JSON.stringify({ csv: { encoding: "ebcdic", delimiter: "|", nullText: "\u0001" }, values: { decimal: "point", thousandsDot: true, dates: "dayMonthYear" }, load: { commit: "single", commitEvery: "0" } }));
    expect(parsed.csv.encoding).toBe("auto");
    expect(parsed.csv.delimiter).toBe("|");
    expect(parsed.csv.nullText).toBe("");
    expect(parsed.values).toEqual({ decimal: "point", thousandsDot: false, dates: "dayMonthYear" });
    expect(parsed.load).toEqual({ commit: "single", commitEvery: "10000", check: true });
    expect(parseImportChoices("não é JSON")).toEqual(defaultImportChoices());
    expect(parseImportChoices("[1,2]")).toEqual(defaultImportChoices());
  });

  it("gravar e ler pelo usuário, numa chave própria; o armazenamento que lança vale \"nada lembrado\"", () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) });
    const choices = { ...defaultImportChoices(), values: { decimal: "comma" as const, thousandsDot: true, dates: "iso" as const } };
    writeImportChoices(" Ana ", choices, storage);
    expect([...store.keys()]).toEqual([importChoicesKey("ana")]);
    expect(readImportChoices("ana", storage).values).toEqual({ decimal: "comma", thousandsDot: true, dates: "iso" });
    expect(readImportChoices("ana", () => ({ getItem: () => { throw new Error("x"); }, setItem: () => {} }))).toEqual(defaultImportChoices());
  });
});
