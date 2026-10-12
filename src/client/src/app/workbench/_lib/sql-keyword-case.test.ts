import { history, undo } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL, type SQLDialect } from "@codemirror/lang-sql";
import { EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";
import { freezeParseBudget } from "@/lib/testing/parse-budget";

import { keywordCase, uppercaseWords } from "./sql-keyword-case";

freezeParseBudget();

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const stateOf = (doc: string, dialect: SQLDialect, engine?: Engine) => EditorState.create({ doc, extensions: [sql({ dialect }), keywordCase(engine), history()] });

/** Digita `text` no fim, um caractere por vez, como o teclado faz: cada caractere é uma transação `input.type`. */
function typed(text: string, { dialect = PostgreSQL, engine, event = "input.type", doc = "" }: { dialect?: SQLDialect; engine?: Engine; event?: string; doc?: string } = {}): string {
  let state = stateOf(doc, dialect, engine);
  for (const character of text) state = state.update({ changes: { from: state.doc.length, insert: character }, selection: { anchor: state.doc.length + character.length }, userEvent: event }).state;
  return state.doc.toString();
}

/** Os três bancos: o PostgreSQL tem a gramática dele, e o Db2 e o Informix usam a do SQL padrão. O banco da aba é o que `keywordCase` recebe. */
const engines = [
  ["PostgreSQL", PostgreSQL, postgres],
  ["Db2", StandardSQL, db2],
  ["Informix", StandardSQL, informix],
] as const;

describe.each(engines)("maiúsculas ao digitar (RN-CONFIG-004), %s", (_name, dialect, engine) => {
  it("converte a palavra reservada quando a pessoa a termina com um espaço, uma vírgula, um parêntese ou um ponto e vírgula", () => {
    expect(typed("select 1 from t where x in (1) and y = 2 order by x;", { dialect, engine })).toBe("SELECT 1 FROM t WHERE x IN (1) AND y = 2 ORDER BY x;");
    expect(typed("select a,b from t union all select 1,2 ", { dialect, engine })).toBe("SELECT a,b FROM t UNION ALL SELECT 1,2 ");
    // A última palavra, sem nada depois, ainda não terminou: converte quando a pessoa digita o que vem a seguir.
    expect(typed("select * from t limit", { dialect, engine })).toBe("SELECT * FROM t limit");
    expect(typed("select * from t limit 10", { dialect, engine })).toBe("SELECT * FROM t LIMIT 10");
  });

  it("os nomes que o dialeto marca como palavra-chave mas que são nomes de coluna ficam como foram digitados", () => {
    // O PostgreSQL marca id, name, type e count como palavra-chave, e o SQL padrão, value, key, level, user e year: nenhum se converte.
    expect(typed("select id, name, type, count, value, key, level, user, year, data, status from t where status = 1 ", { dialect, engine })).toBe(
      "SELECT id, name, type, count, value, key, level, user, year, data, status FROM t WHERE status = 1 ",
    );
  });

  it("converte null e as constantes lógicas, que nunca são nome de nada", () => {
    expect(typed("select * from t where x is null and y = true;", { dialect, engine })).toBe("SELECT * FROM t WHERE x IS NULL AND y = TRUE;");
    expect(typed("select * from t where x is not null or y = false ", { dialect, engine })).toBe("SELECT * FROM t WHERE x IS NOT NULL OR y = FALSE ");
  });

  it("não converte o tipo de dado nem a função embutida: não são palavras-chave do comando", () => {
    expect(typed("select cast(x as integer), count(*), now() from t ", { dialect, engine })).toBe("SELECT CAST(x AS integer), count(*), now() FROM t ");
  });

  it("o que a pessoa escreve em maiúsculas, ou em caixa mista, vira maiúsculas, sem mexer no que já está certo", () => {
    expect(typed("SELECT 1 FROM t ", { dialect, engine })).toBe("SELECT 1 FROM t ");
    expect(typed("Select 1 From t ", { dialect, engine })).toBe("SELECT 1 FROM t ");
  });

  it("não converte dentro de texto entre aspas simples, de comentário nem de nome entre aspas duplas", () => {
    expect(typed("select 'from where ' ", { dialect, engine })).toBe("SELECT 'from where ' ");
    expect(typed("-- select from where\n", { dialect, engine })).toBe("-- select from where\n");
    expect(typed("/* select from */ ", { dialect, engine })).toBe("/* select from */ ");
    expect(typed('select "order" from t ', { dialect, engine })).toBe('SELECT "order" FROM t ');
  });

  it("não converte o nome que vem depois de um ponto (t.order é uma coluna), nem o que ainda é parte de um nome maior", () => {
    expect(typed("select t.order, t.group from t ", { dialect, engine })).toBe("SELECT t.order, t.group FROM t ");
    // `in` e `or` são palavras-chave no meio de `index` e `order_id`: só vale a palavra inteira, quando a pessoa a termina.
    expect(typed("select index, order_id, ordering, select_all from t ", { dialect, engine })).toBe("SELECT index, order_id, ordering, select_all FROM t ");
  });

  it("Enter e Tab também terminam a palavra, e o recuo que o Enter insere fica", () => {
    // O Enter (`insertNewlineAndIndent`) e o Tab (`insertTab`) dispatcham `input`, sem `.type`.
    const afterEnter = stateOf("select", dialect, engine).update({ changes: { from: 6, insert: "\n  " }, selection: { anchor: 9 }, userEvent: "input" }).state;
    expect(afterEnter.doc.toString()).toBe("SELECT\n  ");

    const afterTab = stateOf("select", dialect, engine).update({ changes: { from: 6, insert: "\t" }, selection: { anchor: 7 }, userEvent: "input" }).state;
    expect(afterTab.doc.toString()).toBe("SELECT\t");
  });

  it("só o que a pessoa digita: colar, aceitar uma sugestão, desfazer e a mudança feita por código não convertem nada", () => {
    for (const event of ["input.paste", "input.complete", "input.drop", "undo", "delete.backward"]) {
      expect(typed(" ", { dialect, engine, doc: "select", event }), event).toBe("select ");
    }

    expect(stateOf("select", dialect, engine).update({ changes: { from: 6, insert: " " } }).state.doc.toString()).toBe("select ");
  });

  it("no meio de uma palavra não converte: partir `select` em dois não deixa `SEL` nem `ECT` para trás", () => {
    const state = stateOf("select", dialect, engine).update({ changes: { from: 3, insert: " " }, selection: { anchor: 4 }, userEvent: "input.type" }).state;

    expect(state.doc.toString()).toBe("sel ect");
  });

  it("uma letra, um número, um sublinhado, um ponto ou uma marca de acento depois da palavra não a termina: continua o nome", () => {
    for (const next of ["a", "É", "7", "_", "$", ".", "́"]) expect(typed(next, { dialect, engine, doc: "select" }), next).toBe(`select${next}`);
  });

  it("a palavra que é o fim de um nome maior não se converte: uma letra de qualquer alfabeto, um número, um sublinhado, um cifrão ou uma marca de acento ANTES dela a prende ao nome", () => {
    // O `lang-sql` só lê as letras ASCII num nome: o `é` de `papéis` termina a palavra para ele, e o `is` que sobra parece uma palavra-chave.
    const names = ["papéis", "pé_on", "1select", "péis", "λis", "\u{1D465}select", "ação_in", "x$on", "Éselect", "São_or"];
    for (const name of names) expect(typed(`select ${name} from t `, { dialect, engine }), name).toBe(`SELECT ${name} FROM t `);
  });

  it("o que vem antes da palavra e não é de nome deixa converter: parêntese, operador, vírgula, quebra de linha e símbolo", () => {
    expect(typed("select a,b from t where (x in (1))and y = 2 ", { dialect, engine })).toBe("SELECT a,b FROM t WHERE (x IN (1))AND y = 2 ");
    expect(typed("select*from t where x=any(select 1) ", { dialect, engine })).toBe("SELECT*FROM t WHERE x=ANY(SELECT 1) ");
    expect(typed("select 1\nfrom t\twhere x is null\n", { dialect, engine })).toBe("SELECT 1\nFROM t\tWHERE x IS NULL\n");
  });

  it("a conversão é da mesma transação da tecla: uma transação só, o cursor depois do que foi digitado, e um único desfazer devolve tudo", () => {
    const start = stateOf("select", dialect, engine);
    const transaction = start.update({ changes: { from: 6, insert: " " }, selection: { anchor: 7 }, userEvent: "input.type" });

    expect(transaction.state.doc.toString()).toBe("SELECT ");
    expect(transaction.state.selection.main.head).toBe(7);
    expect(transaction.annotation(Transaction.userEvent)).toBe("input.type");

    let after = transaction.state;
    expect(undo({ state: after, dispatch: (undoing) => (after = undoing.state) })).toBe(true);
    expect(after.doc.toString()).toBe("select");
  });

  it("selecionar texto e digitar por cima não converte a palavra ao lado: só a inserção pura termina a palavra", () => {
    const replaced = stateOf("select*", dialect, engine).update({ changes: { from: 6, to: 7, insert: " " }, selection: { anchor: 7 }, userEvent: "input.type" }).state;

    expect(replaced.doc.toString()).toBe("select ");
  });
});

describe("comentário que a gramática do lang-sql não lê: o `{ ... }` do Informix e o comentário de bloco dentro de outro (RN-SQL-002)", () => {
  const onInformix = (text: string) => typed(text, { dialect: StandardSQL, engine: informix });

  it("Informix: dentro de `{ ... }` nada se converte, e depois do fecho a conversão volta", () => {
    expect(onInformix("{ do not select * from x }")).toBe("{ do not select * from x }");
    expect(onInformix("{ select from } select 1 from t ")).toBe("{ select from } SELECT 1 FROM t ");
    expect(onInformix("{ um\nselect\nfrom }\nselect * from t ")).toBe("{ um\nselect\nfrom }\nSELECT * FROM t ");
    expect(onInformix("select 1 { from where } from t where x is null ")).toBe("SELECT 1 { from where } FROM t WHERE x IS NULL ");
  });

  it("Informix: a palavra que a própria chave de fechar termina também fica, e sem o fecho o comentário vai até o fim do texto", () => {
    expect(onInformix("{ x select}")).toBe("{ x select}");
    expect(onInformix("{ sem fecho select from where ")).toBe("{ sem fecho select from where ");
  });

  it("Informix: a chave dentro de texto entre aspas ou de nome entre aspas duplas não abre comentário", () => {
    expect(onInformix("select '{' from t where x is null ")).toBe("SELECT '{' FROM t WHERE x IS NULL ");
    expect(onInformix('select "{" from t where x is null ')).toBe('SELECT "{" FROM t WHERE x IS NULL ');
  });

  it.each([
    ["PostgreSQL", PostgreSQL, postgres],
    ["Db2", StandardSQL, db2],
    ["sem banco (vale o PostgreSQL)", PostgreSQL, undefined],
  ])("%s: a chave não é comentário, e o texto entre as chaves se converte como qualquer outro", (_name, dialect, engine) => {
    expect(typed("{ do not select * from x }", { dialect, engine })).toBe("{ do NOT SELECT * FROM x }");
  });

  it.each([
    ["PostgreSQL", PostgreSQL, postgres],
    ["Db2", StandardSQL, db2],
  ])("%s: o comentário de bloco aceita outro dentro dele, e a palavra entre os dois fechos fica", (_name, dialect, engine) => {
    expect(typed("/* a /* b */ select */ select 1 from t ", { dialect, engine })).toBe("/* a /* b */ select */ SELECT 1 FROM t ");
  });
});

describe("a lista de palavras que a conversão escreve em maiúsculas", () => {
  it("só tem palavras reservadas e de estrutura do comando, em minúsculas e sem repetir", () => {
    const words = [...uppercaseWords];

    expect(words.length).toBeGreaterThan(60);
    expect(words.every((word) => word === word.toLowerCase() && /^[a-z_]+$/.test(word))).toBe(true);
    expect(new Set(words).size).toBe(words.length);
  });

  it("nenhum nome comum de coluna entra: um falso positivo reescreveria o nome do usuário", () => {
    const common = ["id", "name", "type", "value", "key", "level", "data", "status", "position", "year", "month", "day", "count", "user", "comment", "index", "open", "close", "view", "function", "text", "code", "date", "time", "sequence", "schema", "database"];

    expect(common.filter((word) => uppercaseWords.has(word))).toEqual([]);
  });

  it("tem as palavras que montam os comandos do dia a dia", () => {
    const daily = ["select", "from", "where", "group", "by", "order", "having", "limit", "join", "on", "and", "or", "not", "in", "is", "null", "like", "between", "exists", "case", "when", "then", "else", "end", "insert", "into", "values", "update", "set", "delete", "create", "alter", "drop", "table", "union", "distinct", "as", "with", "asc", "desc", "fetch", "first", "rows", "only", "left", "right", "inner", "outer"];

    expect(daily.filter((word) => !uppercaseWords.has(word))).toEqual([]);
  });
});
