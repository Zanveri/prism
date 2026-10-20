import { describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import { statementAt } from "./sql-statements";
import { analysisMaxChars, analyze, dryRunBudgetMs, problemRange, type EditorAnalysis } from "./variables-analysis";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

/** O texto de cada trecho achado, no formato `tipo:texto`, na ordem do texto. */
const marksOf = (source: string, analysis: EditorAnalysis) => analysis.marks.map((mark) => `${mark.kind}:${source.slice(mark.from, mark.to)}`);
const errorsOf = (source: string, analysis: EditorAnalysis) => analysis.errors.map((error) => [source.slice(error.from, error.to), error.message]);
const hintsOf = (source: string, analysis: EditorAnalysis) => analysis.hints.map((hint) => [source.slice(hint.from, hint.to), hint.message]);
const read = (source: string, engine: Engine | undefined = postgres, blankLines = true) => analyze(source, engine, blankLines);

// O realce (RN-VAR-025): `let` e `const` na cor das palavras-chave, o nome declarado e cada `@nome` declarado na cor da variável, o `@nome` de uma variável `sql` com o
// sublinhado pontilhado, os textos e os comentários das declarações nas cores do SQL, e o `@nome` não declarado na cor do SQL.
describe("o realce das declarações e do @nome (RN-VAR-025)", () => {
  it("pinta o let, o const e o nome declarado, e o @nome declarado no SQL", () => {
    const source = "let cliente_id = 10\nconst inicio = '2026-01-01'\nSELECT * FROM t WHERE c = @cliente_id AND d >= @inicio";
    const analysis = read(source);

    expect(marksOf(source, analysis)).toEqual(["keyword:let", "variable:cliente_id", "keyword:const", "variable:inicio", "string:'2026-01-01'", "variable:@cliente_id", "variable:@inicio"]);
    expect(analysis.marks.filter((mark) => mark.kind === "variable").map((mark) => mark.name)).toEqual(["cliente_id", "inicio", "cliente_id", "inicio"]);
  });

  it("o @nome que não foi declarado fica na cor do SQL: nenhuma marca", () => {
    const source = "let a = 1\nSELECT @b, @a";

    expect(marksOf(source, read(source))).toEqual(["keyword:let", "variable:a", "variable:@a"]);
  });

  it("o nome usado dentro de outra declaração também é pintado, e o `sql` leva a marca própria no SQL", () => {
    const source = "const base = 10\nlet dobro = base * 2\nconst esquema: sql = 'estoque'\nSELECT * FROM @esquema.pedido WHERE n > @dobro";
    const analysis = read(source);

    expect(marksOf(source, analysis)).toEqual(["keyword:const", "variable:base", "keyword:let", "variable:dobro", "variable:base", "keyword:const", "variable:esquema", "string:'estoque'", "sqlVariable:@esquema", "variable:@dobro"]);
  });

  it("o texto entre aspas duplas e a crase de uma declaração são texto (e não nome entre aspas), e o `//` é comentário", () => {
    const source = '// o topo\nlet nome = "Ana" // quem\nlet modelo = `x`\nSELECT 1';

    expect(marksOf(source, read(source))).toEqual(["comment:// o topo", "keyword:let", "variable:nome", 'string:"Ana"', "comment:// quem", "keyword:let", "variable:modelo", "string:`x`"]);
  });

  it("o `//` de cima de uma declaração é comentário; o de dentro de um comando é SQL (a dica avisa), e o `@` de um texto, de um comentário ou de um nome entre aspas nunca é variável", () => {
    const source = "let a = 1\nSELECT '@a', \"@a\" -- @a\n/* @a */ FROM t";

    expect(marksOf(source, read(source))).toEqual(["keyword:let", "variable:a"]);
  });

  it("uma declaração com erro continua pintada (o let e o nome), e o erro é sublinhado", () => {
    const source = "let a = \nSELECT 1";
    const analysis = read(source);

    expect(marksOf(source, analysis)).toContain("keyword:let");
    expect(errorsOf(source, analysis).length).toBeGreaterThan(0);
  });

  it("o texto sem let, const nem @ nem é lido; o muito grande também não, e diz que pulou", () => {
    expect(read("SELECT 1 FROM t")).toMatchObject({ marks: [], errors: [], hints: [], skipped: false });

    const big = read(`let a = 1\n${"SELECT 1;\n".repeat(Math.floor((analysisMaxChars - 100) / 10))}`);
    expect(big.skipped).toBe(false);
    expect(big.marks.length).toBeGreaterThan(0);
    expect(read(`let a = 1\n${"x".repeat(analysisMaxChars)}`)).toMatchObject({ skipped: true, marks: [], errors: [] });
  });
});

// Os erros sublinhados (RN-VAR-025): os da conferência, com a frase na dica do ponteiro.
describe("os erros (RN-VAR-012 e 025)", () => {
  it("a gramática: o trecho sublinhado é o do erro, com a frase da linguagem", () => {
    const source = "let a = 1 +\nlet b = (2\nSELECT 1";
    const errors = errorsOf(source, read(source));

    expect(errors.length).toBeGreaterThan(0);
    for (const [, message] of errors) expect(message).not.toBe("");
  });

  it("o const reatribuído, o nome repetido e o usado sem declarar", () => {
    const source = "const a = 1\na = 2\nlet a = 3\nlet b = c + 1\nSELECT 1";
    const messages = errorsOf(source, read(source)).map(([, message]) => message);

    expect(messages).toContain("a é const e não pode receber outro valor (linha 1).");
    expect(messages).toContain("a já foi declarada na linha 1.");
    expect(messages).toContain("c não foi declarada.");
  });

  it("o @nome usado antes da declaração é um erro, e não SQL", () => {
    const source = "SELECT @a;\nlet a = 1";

    expect(errorsOf(source, read(source))).toEqual([["@a", "a é usada antes de ser declarada, na linha 2."]]);
  });

  it("o marcador já escrito num comando com variáveis", () => {
    const source = "let a = 1\nSELECT * FROM t WHERE x = $1 AND y = @a";

    expect(errorsOf(source, read(source)).map(([, message]) => message)).toEqual(["O comando já tem um marcador de parâmetro ($1), e o Prism numera os das variáveis: tire o $1 do texto."]);
  });

  it("o tipo que se sabe sem o banco (a execução em seco): o valor que não cabe na anotação", () => {
    const source = "let n: number = 'texto'\nSELECT 1";

    expect(errorsOf(source, read(source))).toEqual([["'texto'", "n é number, mas recebeu 'texto'."]]);
  });

  it("a lista fora de uma lista entre parênteses, quando o tipo se sabe", () => {
    const source = "const ids = [1, 2]\nSELECT * FROM t WHERE id = @ids";

    expect(errorsOf(source, read(source)).map(([, message]) => message)).toEqual(["@ids é uma lista e só entra numa lista entre parênteses, como IN (@ids)."]);
  });

  it("a recusa provisória das partes que ainda não entraram aparece como erro (a frase da conferência)", () => {
    const source = "let x = (SELECT 1)\nSELECT @x";

    expect(errorsOf(source, read(source)).map(([, message]) => message)).toContain("A variável de consulta chega numa próxima versão.");
  });

  it("o orçamento da execução em seco: passado o tempo, o que só ela acha vai para a execução, e os erros da leitura ficam", () => {
    const source = "let n: number = 'texto'\nlet y = z\nSELECT @n";
    expect(dryRunBudgetMs).toBeLessThanOrEqual(100);
    expect(errorsOf(source, read(source)).map(([, message]) => message)).toEqual(["n é number, mas recebeu 'texto'.", "z não foi declarada."]);

    // Um relógio que anda 50 ms a cada leitura: o orçamento acaba na primeira.
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 50));
    try {
      const messages = errorsOf(source, read(source)).map(([, message]) => message);

      expect(messages).toEqual(["z não foi declarada."]);
    } finally {
      clock.mockRestore();
    }
  });

  it("problemRange: a palavra, o @nome, o texto entre aspas simples, ou um caractere; na quebra de linha, o caractere de antes", () => {
    const source = "let a = 'x y' + @nome\nfim";

    expect(problemRange(source, 4)).toEqual({ from: 4, to: 5 });
    expect(problemRange(source, 8)).toEqual({ from: 8, to: 13 });
    expect(problemRange(source, 16)).toEqual({ from: 16, to: 21 });
    expect(problemRange(source, 13)).toEqual({ from: 12, to: 13 });
    expect(problemRange(source, 14)).toEqual({ from: 14, to: 15 });
    expect(problemRange(source, 21)).toEqual({ from: 20, to: 21 });
    expect(problemRange(source, 999)).toEqual({ from: source.length - 1, to: source.length });
    expect(problemRange("", 0)).toEqual({ from: 0, to: 0 });
    expect(problemRange("a = 😀", 4)).toEqual({ from: 4, to: 6 });
  });
});

// As dicas, uma por item da lista da RN-VAR-025, com a frase da especificação.
describe("as dicas (RN-VAR-025)", () => {
  it("o @nome não declarado, onde ele seria variável", () => {
    const source = "let a = 1\nSELECT @cliente, @a";

    expect(hintsOf(source, read(source))).toEqual([["@cliente", "@cliente não é uma variável deste script, e vai ao banco como está."]]);
  });

  it("o @nome que só difere de uma declarada pelas maiúsculas", () => {
    const source = "let cliente_id = 1\nSELECT @Cliente_Id";

    expect(hintsOf(source, read(source))).toEqual([["@Cliente_Id", "Você quis dizer @cliente_id? Os nomes das variáveis diferenciam maiúsculas, como no JavaScript."]]);
  });

  it("o LET e o CONST em maiúsculas onde uma declaração valeria", () => {
    const source = "LET a = 1;\nCONST b = 2;\nSELECT 1";

    expect(hintsOf(source, read(source))).toEqual([
      ["LET", "LET em maiúsculas não declara variável: escreva let."],
      ["CONST", "CONST em maiúsculas não declara variável: escreva const."],
    ]);
  });

  it("o `Let` com outra mistura de caixa, e o LET que não é uma declaração, não confundem", () => {
    const mixed = "Let a = 1\nSELECT 1";
    expect(hintsOf(mixed, read(mixed)).map(([, message]) => message)).toEqual(["Let não declara variável: escreva let, em minúsculas."]);

    const notDeclaration = "LET x\nSELECT 1";
    expect(hintsOf(notDeclaration, read(notDeclaration))).toEqual([["LET", "LET em maiúsculas não declara variável: escreva let."]]);
    const sentence = "SELECT 1 AS letter FROM t";
    expect(read(sentence).hints).toEqual([]);
  });

  it("a variável de consulta sem anotação de lista, usada num IN", () => {
    const source = "let ids = (SELECT id FROM t)\nSELECT * FROM u WHERE id IN (@ids)";

    expect(hintsOf(source, read(source)).map(([, message]) => message)).toContain("A consulta pode devolver uma linha só, e ids vira um valor e não uma lista: anote ids: number[].");
  });

  it("anotada como lista, a consulta no IN não leva a dica", () => {
    const source = "let ids: number[] = (SELECT id FROM t)\nSELECT * FROM u WHERE id IN (@ids)";

    expect(hintsOf(source, read(source)).map(([, message]) => message)).not.toContain("A consulta pode devolver uma linha só, e ids vira um valor e não uma lista: anote ids: number[].");
  });

  it("o comando de definição com uma variável que não é sql, e não com uma que é", () => {
    const source = "let a = 1\nconst nome: sql = 't'\nCREATE TABLE @nome AS SELECT @a AS x";
    const hints = hintsOf(source, read(source));

    expect(hints).toEqual([["@a", "Comandos CREATE, ALTER, DROP e GRANT não costumam aceitar parâmetros, e o banco pode recusar @a. Para um nome, use uma variável sql."]]);
  });

  it("o SET com uma variável que não é sql também é comando de definição (RN-VAR-017), mas o SET do UPDATE não", () => {
    const set = "let esquema = 'public'\nSET search_path TO @esquema";
    expect(hintsOf(set, read(set)).map(([text]) => text)).toEqual(["@esquema"]);

    const update = "let id = 7\nUPDATE t SET a = @id WHERE b = @id";
    expect(hintsOf(update, read(update))).toEqual([]);
  });

  it("o @nome declarado que ficou como SQL por causa do caractere de antes (o operador do PostgreSQL)", () => {
    const source = "let x = 1\nSELECT * FROM t WHERE a <@x";

    expect(hintsOf(source, read(source))).toEqual([["@x", "Aqui o @x é o operador do PostgreSQL (como <@); para a variável, escreva um espaço antes: < @x."]]);
  });

  it.each([
    ["ORDER BY @x", "SELECT * FROM t ORDER BY @x", "o ORDER BY @x não ordena por coluna"],
    ["a vírgula na lista do ORDER BY", "SELECT * FROM t ORDER BY a, @x", "o ORDER BY @x não ordena por coluna"],
    ["GROUP BY @x", "SELECT a FROM t GROUP BY @x", "o GROUP BY @x não agrupa por coluna"],
    ["FROM @x", "SELECT * FROM @x", "o FROM @x não acha uma tabela"],
    ["JOIN @x", "SELECT * FROM t JOIN @x ON 1 = 1", "o JOIN @x não acha uma tabela"],
    ["INTO @x", "INSERT INTO @x VALUES (1)", "o INTO @x não acha uma tabela"],
    ["UPDATE @x", "UPDATE @x SET a = 1", "o UPDATE @x não acha uma tabela"],
    ["TABLE @x", "TABLE @x", "o TABLE @x não acha uma tabela"],
  ])("onde o banco espera um nome, e o @x vai como valor: %s", (_what, command, clause) => {
    const source = `let x = 1\n${command}`;

    expect(hintsOf(source, read(source))).toEqual([["@x", `Aqui o banco espera um nome, e @x vai como valor: ${clause}. Para um nome, use uma variável sql.`]]);
  });

  it("onde o FROM não espera um nome (IS DISTINCT FROM, EXTRACT, SUBSTRING) e onde a vírgula não é de um ORDER BY, nada", () => {
    for (const command of ["SELECT 1 WHERE a IS DISTINCT FROM @x", "SELECT EXTRACT(YEAR FROM @x) FROM t", "SELECT SUBSTRING(s FROM @x)", "SELECT * FROM t WHERE a = 1 ORDER BY a LIMIT 1 OFFSET @x", "SELECT f(a, @x) FROM t ORDER BY a", "SELECT id, row_number() OVER (ORDER BY created), @x AS y FROM t", "SELECT (SELECT x FROM t ORDER BY y), @x FROM u", "SELECT (SELECT x FROM t GROUP BY y), @x FROM u"]) {
      const source = `let x = 1\n${command}`;
      expect(hintsOf(source, read(source)), command).toEqual([]);
    }
  });

  it("o @nome sql onde o banco espera um nome não leva dica: é o jeito certo", () => {
    const source = "const tabela: sql = 'pedido'\nSELECT * FROM @tabela ORDER BY 1";

    expect(read(source).hints).toEqual([]);
  });

  it("o NOT IN com uma lista que pode ter null, e só ele", () => {
    const withNull = "let ids: number[] | null = [1]\nlet outra = [1, null]\nlet limpa = [1, 2]\nSELECT 1 WHERE a NOT IN (@ids) AND b NOT IN (@outra) AND c NOT IN (@limpa) AND d IN (@outra)";

    expect(hintsOf(withNull, read(withNull)).map(([text, message]) => `${text}:${message}`)).toEqual(["@ids:NOT IN com null nunca é verdadeiro.", "@outra:NOT IN com null nunca é verdadeiro."]);
  });

  it("o -- ou o // colado a um valor dentro de uma declaração", () => {
    const decrement = "let i = 5\nlet j = i--\nlet k = i // 2\nlet l = 3 -- uma nota\nlet m = 4 // outra nota\nSELECT 1";

    expect(hintsOf(decrement, read(decrement))).toEqual([
      ["--", "-- e // começam um comentário aqui."],
      ["//", "-- e // começam um comentário aqui."],
    ]);
  });

  it("o // fora das posições em que é comentário: no meio de um comando é SQL, e a dica diz para usar --", () => {
    const source = "SELECT 1 // x\nFROM t";

    expect(hintsOf(source, read(source))).toEqual([["//", "// não é comentário no SQL: use --."]]);
  });

  it("o // do topo do script e o de cima de uma declaração são comentário, e o // dentro de um texto não é nada", () => {
    const source = "// título\n// segunda linha\nlet a = 1\nSELECT 'http://x' FROM t";

    expect(read(source).hints).toEqual([]);
    expect(marksOf(source, read(source)).filter((mark) => mark.startsWith("comment"))).toEqual(["comment:// título", "comment:// segunda linha"]);
  });

  it("sem nenhuma declaração o // do topo vai ao banco como está, e o editor avisa em vez de pintar comentário", () => {
    const source = "// topo\nSELECT 1";

    expect(marksOf(source, read(source)).filter((mark) => mark.startsWith("comment"))).toEqual([]);
    expect(hintsOf(source, read(source))).toEqual([["//", "// não é comentário no SQL: use --."]]);
    // A execução de um script sem declarações é a de sempre (variableRange): o comando leva o // junto.
    expect(statementAt(source, source.length, postgres)?.text).toBe(source);
    // Com uma declaração, o mesmo // é comentário e sai do comando.
    const declared = `${source}\nlet a = 1`;
    expect(read(declared).hints).toEqual([]);
    expect(marksOf(declared, read(declared))).toContain("comment:// topo");
  });

  it.each([
    ["o Db2", db2, "CREATE PROCEDURE p () BEGIN\nlet x = 1;\n  const y = 2;\nEND"],
    ["o PostgreSQL", postgres, "CREATE FUNCTION f() RETURNS void BEGIN ATOMIC\n  let x = 1;\nEND"],
    ["o Informix", informix, "CREATE PROCEDURE p ()\n  let x = 1;\nEND PROCEDURE"],
  ])("o let e o const em minúsculas dentro de um bloco que vai ao banco (%s)", (_name, engine, source) => {
    const hints = hintsOf(source, read(source, engine as Engine)).map(([, message]) => message);

    expect(hints.length).toBeGreaterThan(0);
    for (const message of hints) expect(message).toBe("let dentro do bloco é SQL: declare as variáveis antes do bloco.");
  });

  it("o @x declarado dentro do corpo de uma rotina vai como está", () => {
    const source = "let x = 1\nCREATE PROCEDURE p () BEGIN\n  SELECT @x;\nEND";

    expect(hintsOf(source, read(source, db2))).toEqual([["@x", "Dentro do corpo de uma rotina o @x vai ao banco como está."]]);
  });

  it("a dica sai de uma ordem estável, na do texto, e nunca tem trecho vazio", () => {
    const source = "let a = 1\nSELECT @z, @y FROM t ORDER BY @a";
    const hints = read(source).hints;

    expect(hints.map((hint) => hint.from)).toEqual([...hints.map((hint) => hint.from)].sort((x, y) => x - y));
    for (const hint of hints) expect(hint.to).toBeGreaterThan(hint.from);
  });
});

// Onde cada declaração acaba (o valor no fim da linha) e quais nomes ela declara (o autocompletar e a dica do ponteiro).
describe("onde o valor aparece e o que está declarado", () => {
  it("o fim da última linha da declaração, com o `;` e o comentário da mesma linha", () => {
    const source = "let a = 1;  // nota\nlet b = [\n  1,\n  2,\n]\nSELECT 1";
    const analysis = read(source);

    expect(analysis.tails.map((tail) => [tail.name, source.slice(tail.from, tail.at)])).toEqual([
      ["a", "let a = 1;  // nota"],
      ["b", "let b = [\n  1,\n  2,\n]"],
    ]);
  });

  it("só a primeira declaração de cada nome tem valor no fim da linha, e a reatribuição não", () => {
    const source = "let a = 1\na = 2\nlet a = 3\nSELECT @a";

    expect(read(source).tails.map((tail) => tail.from)).toEqual([0]);
  });

  it("os nomes declarados, na ordem do texto, com o tipo anotado", () => {
    const source = "let a: number[] = [1]\nconst nome: sql = 'x'\nlet b = 2\nlet a = 5";

    expect(read(source).declared.map((declared) => [declared.name, declared.type, declared.sql, declared.mutable])).toEqual([
      ["a", "number[]", false, true],
      ["nome", "sql", true, false],
      ["b", null, false, true],
    ]);
  });

  it("o banco da aba e a linha em branco mudam a leitura: no Informix o `{` é comentário no SQL, mas objeto na declaração", () => {
    const source = "let o = { id: 7 }\nSELECT { @o } 1 FROM t";

    expect(read(source, informix).errors).toEqual([]);
    expect(marksOf(source, read(source, informix))).toContain("variable:o");
  });

  it("nunca lança: texto quebrado, aspas abertas e caracteres soltos ficam sem marca em vez de derrubar o editor", () => {
    for (const source of ["let", "let =", "const x: = 1", "@", "let a = 'aberto", "let a = `x${", "SELECT '", "let a = /* x", "\u0000let a = 1", "let \u{1F600} = 1", "@@@@ let let let"]) {
      expect(() => read(source), source).not.toThrow();
      expect(() => read(source, informix, false), source).not.toThrow();
    }
  });
});

// O texto colado com milhares de declarações pequenas não trava a leitura do editor (RN-VAR-013 e 014): acima de 500 só o erro dos 500, sem a execução em seco.
describe("o script com milhares de declarações", () => {
  it("lê 6.000 declarações pequenas depressa e sublinha a de número 501", () => {
    const source = Array.from({ length: 6000 }, (_, index) => `let a${index} = ${index}`).join("\n");
    const started = performance.now();
    const analysis = read(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(analysis.errors.map((error) => error.message)).toEqual(["O script passou de 500 declarações."]);
  });
});
