import { describe, expect, it } from "vitest";

import { commandStart, hasStatement, splitStatements, statementAt, statementCount, utf16IndexOf } from "./sql-statements";

const texts = (sql: string) => splitStatements(sql).map((statement) => statement.text);

describe("splitStatements (RN-SQL-002)", () => {
  it("\"select 1; select 2\" são dois comandos, sem o `;`", () => {
    expect(texts("select 1; select 2")).toEqual(["select 1", "select 2"]);
  });

  it("`;` dentro de 'a;b' não separa, e '' dentro de texto não fecha o texto", () => {
    expect(texts("select 'a;b'; select 2")).toEqual(["select 'a;b'", "select 2"]);
    expect(texts("select 'it''s; ok'; select 2")).toEqual(["select 'it''s; ok'", "select 2"]);
  });

  it("`;` dentro de \"col;x\" não separa", () => {
    expect(texts('select "col;x" from t; select 2')).toEqual(['select "col;x" from t', "select 2"]);
  });

  it("`;` dentro de `-- comentário; aqui` e de `/* a; b */` não separa", () => {
    expect(texts("select 1 -- comentário; aqui\n; select 2")).toEqual(["select 1 -- comentário; aqui", "select 2"]);
    expect(texts("select /* a; b */ 1; select 2")).toEqual(["select /* a; b */ 1", "select 2"]);
  });

  it("comentário de bloco dentro de outro só fecha no último `*/`", () => {
    expect(texts("select /* a /* b; */ c; */ 1; select 2")).toEqual(["select /* a /* b; */ c; */ 1", "select 2"]);
  });

  it("`;` dentro de `$$ ... ; ... $$` e de `$fn$ ... ; ... $fn$` não separa", () => {
    expect(texts("do $$ begin perform 1; end $$; select 2")).toEqual(["do $$ begin perform 1; end $$", "select 2"]);
    expect(texts("create function f() returns int as $fn$ select 1; select $$x;$$; $fn$ language sql; select 2")).toEqual(["create function f() returns int as $fn$ select 1; select $$x;$$; $fn$ language sql", "select 2"]);
  });

  it("`$1` é parâmetro e `a$b$c` é nome: nenhum dos dois abre um bloco `$tag$`", () => {
    expect(texts("select $1; select $2")).toEqual(["select $1", "select $2"]);
    expect(texts("select a$b$ from t; select 2")).toEqual(["select a$b$ from t", "select 2"]);
  });

  it("comando sem `;` final é devolvido", () => {
    expect(texts("select 1;\nselect 2")).toEqual(["select 1", "select 2"]);
    expect(texts("select 1")).toEqual(["select 1"]);
  });

  it("só espaços e `;` dão lista vazia", () => {
    expect(splitStatements("  ;\n ; \t;")).toEqual([]);
    expect(splitStatements("")).toEqual([]);
  });

  it("trecho só com comentário não é comando; o comentário antes do comando vai com ele", () => {
    expect(texts("select 1; -- fim")).toEqual(["select 1"]);
    expect(texts("/* nada */ ; -- só isto\n")).toEqual([]);
    expect(texts("-- título\nselect 1; /* outro */ select 2")).toEqual(["-- título\nselect 1", "/* outro */ select 2"]);
  });

  it("texto, comentário ou bloco que não fecha vai até o fim, sem separar", () => {
    expect(texts("select 'abc; select 2")).toEqual(["select 'abc; select 2"]);
    expect(texts("select 1 /* abc; select 2")).toEqual(["select 1 /* abc; select 2"]);
    expect(texts("do $$ begin; select 2")).toEqual(["do $$ begin; select 2"]);
  });

  it("`start` e `end` apontam o trecho exato no texto original", () => {
    const sql = "  select 1 ;\n\n  select 'a;b'\n;  ";
    const statements = splitStatements(sql);

    expect(statements).toEqual([
      { text: "select 1", start: 2, end: 10 },
      { text: "select 'a;b'", start: 16, end: 28 },
    ]);
    for (const statement of statements) expect(sql.slice(statement.start, statement.end)).toBe(statement.text);
  });

  it("texto de 1 MB separa em menos de 200 ms", () => {
    const line = "select id, nome, 'a;b' as texto, \"col;x\" from producao.apontamento where id = 42 -- comentário; aqui\n;\n";
    const sql = line.repeat(Math.ceil((1024 * 1024) / line.length));
    expect(sql.length).toBeGreaterThanOrEqual(1024 * 1024);

    const startedAt = performance.now();
    const statements = splitStatements(sql);
    const elapsed = performance.now() - startedAt;

    expect(statements).toHaveLength(sql.length / line.length);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("statementAt (RN-SQL-001)", () => {
  const sql = "select 1; select 2";

  it("com o cursor no meio do segundo comando devolve o segundo", () => {
    expect(statementAt(sql, 14)).toEqual({ text: "select 2", start: 10, end: 18 });
  });

  it("com o cursor logo depois do `;` do primeiro devolve o primeiro", () => {
    expect(statementAt(sql, 9)).toEqual({ text: "select 1", start: 0, end: 8 });
  });

  it("com o cursor no começo do segundo comando devolve o segundo", () => {
    expect(statementAt(sql, 10)?.text).toBe("select 2");
  });

  it("com o cursor no fim do texto, depois do último `;` e de espaços, devolve o último comando", () => {
    const trailing = "select 1; select 2;  \n ";
    expect(statementAt(trailing, trailing.length)?.text).toBe("select 2");
  });

  it("em texto vazio, ou só com espaços e `;`, devolve null", () => {
    expect(statementAt("", 0)).toBeNull();
    expect(statementAt(" ; ;\n", 3)).toBeNull();
  });

  it("com o cursor num comentário depois do último comando, devolve o último comando", () => {
    const commented = "select 1;\nselect 2; -- conferido";
    expect(statementAt(commented, commented.length)?.text).toBe("select 2");
  });

  it("o cursor dentro de um `;` de texto continua no mesmo comando", () => {
    const quoted = "select 'a;b' from t; select 2";
    expect(statementAt(quoted, 10)?.text).toBe("select 'a;b' from t");
  });
});

describe("hasStatement (há o que enviar)", () => {
  it("espaços, `;` e comentários não são comando", () => {
    expect(hasStatement("")).toBe(false);
    expect(hasStatement("  ;\n ; ")).toBe(false);
    expect(hasStatement("-- só um comentário\n/* e outro; /* dentro */ ainda */ ;")).toBe(false);
    expect(hasStatement("/* comentário que não fecha")).toBe(false);
  });

  it("qualquer outra coisa é: para no primeiro caractere de comando", () => {
    expect(hasStatement("select 1")).toBe(true);
    expect(hasStatement("-- título\n  select 1")).toBe(true);
    expect(hasStatement("/* a */ 'texto'")).toBe(true);
    expect(hasStatement("- 1")).toBe(true);
  });

  it("concorda com splitStatements", () => {
    for (const sql of ["", " ; ", "-- x", "select 1; -- fim", "/* a */ ;", "$$ x $$", "a / b"]) expect(hasStatement(sql)).toBe(splitStatements(sql).length > 0);
  });
});

describe("statementCount (RN-SQL-001: uma execução leva um comando só)", () => {
  it("um comando: pode ir, com ou sem o `;` e com comentário em volta", () => {
    expect(statementCount("select 1")).toBe(1);
    expect(statementCount("  select 1;\n")).toBe(1);
    expect(statementCount("-- título\nselect 1; -- conferido")).toBe(1);
  });

  it("dois comandos: a tela avisa e não envia", () => {
    expect(statementCount("select 1; select 2")).toBe(2);
    expect(statementCount("update t set a = 1;\ndelete from t;\nselect 3;")).toBe(3);
  });

  it("seleção vazia, ou só com espaços, `;` e comentários: nada para enviar", () => {
    expect(statementCount("")).toBe(0);
    expect(statementCount("  \n ; ")).toBe(0);
    expect(statementCount("-- só um comentário")).toBe(0);
  });

  it("comando com `;` dentro de texto, de nome entre aspas ou de comentário é um só", () => {
    expect(statementCount("select 'a;b' from t")).toBe(1);
    expect(statementCount('select "col;x" from t /* a; b */')).toBe(1);
  });

  it("bloco `$tag$` com `;` no corpo é um comando só", () => {
    expect(statementCount("create function f() returns int as $fn$ begin return 1; end; $fn$ language plpgsql;")).toBe(1);
  });

  it("`BEGIN` fora de `CREATE FUNCTION` e `CREATE PROCEDURE` não abre bloco: o separador divide", () => {
    expect(statementCount("begin; update t set a = 1; commit")).toBe(3);
  });
});

describe("o separador conhece o banco da aba (RN-SQL-002)", () => {
  const postgres = 1;
  const db2 = 2;
  const informix = 3;
  const textsOf = (sql: string, engine: 1 | 2 | 3) => splitStatements(sql, engine).map((statement) => statement.text);

  it("Informix: comentário de bloco não aninha, o primeiro `*/` fecha; no PostgreSQL e no Db2 o mesmo texto é um comentário que não fechou", () => {
    const sql = "/* a /* b */ select 1;";

    expect(textsOf(sql, informix)).toEqual(["/* a /* b */ select 1"]);
    expect(statementAt(sql, sql.length, informix)?.text).toBe("/* a /* b */ select 1");
    for (const nesting of [postgres, db2] as const) {
      expect(textsOf(sql, nesting)).toEqual([]);
      expect(statementAt(sql, sql.length, nesting)).toBeNull();
    }
  });

  it("Db2: comentário de bloco aninha, como no PostgreSQL: o `;` dentro de um comentário dentro de outro não separa", () => {
    const sql = "select /* a /* b; */ c; */ 1; select 2";

    expect(textsOf(sql, db2)).toEqual(["select /* a /* b; */ c; */ 1", "select 2"]);
    expect(textsOf(sql, informix)).toEqual(["select /* a /* b; */ c", "*/ 1", "select 2"]);
  });

  it("Informix: `{ ... }` também é comentário, e o `;` dentro dele não separa", () => {
    const sql = "{ comentário; com ponto e vírgula } select 1;";

    expect(textsOf(sql, informix)).toEqual(["{ comentário; com ponto e vírgula } select 1"]);
    expect(statementCount(sql, informix)).toBe(1);
    expect(statementAt("select 1; { nota; aqui } select 2", 33, informix)?.text).toBe("{ nota; aqui } select 2");
  });

  it("PostgreSQL e Db2: as chaves não são comentário", () => {
    const sql = "{ comentário; com ponto e vírgula } select 1;";

    expect(textsOf(sql, postgres)).toEqual(["{ comentário", "com ponto e vírgula } select 1"]);
    expect(statementCount(sql, db2)).toBe(2);
  });

  it("Informix: um texto só de `{ ... }` não tem comando", () => {
    expect(hasStatement("{ só um comentário; }", informix)).toBe(false);
    expect(hasStatement("{ só um comentário; }", postgres)).toBe(true);
    expect(statementCount("{ só um comentário; } ;", informix)).toBe(0);
  });

  it("`$tag$` é só do PostgreSQL: no Db2 e no Informix o `;` dentro dele separa", () => {
    const sql = "do $$ begin perform 1; end $$;";

    expect(statementCount(sql, postgres)).toBe(1);
    expect(textsOf(sql, db2)).toEqual(["do $$ begin perform 1", "end $$"]);
    expect(statementCount(sql, informix)).toBe(2);
  });

  it("hasStatement segue o mesmo banco: o comentário que não aninha deixa o comando de fora dele", () => {
    expect(hasStatement("/* a /* b */ select 1", informix)).toBe(true);
    expect(hasStatement("/* a /* b */ select 1", db2)).toBe(false);
    expect(hasStatement("/* a /* b */ select 1", postgres)).toBe(false);
  });

  it("o comentário `--` acaba no retorno de carro só no PostgreSQL; no Db2 e no Informix, só na quebra de linha", () => {
    const sql = "-- x\rSELECT 1";

    expect(textsOf(sql, postgres)).toEqual(["-- x\rSELECT 1"]);
    expect(statementCount(sql, postgres)).toBe(1);
    expect(hasStatement(sql, postgres)).toBe(true);
    for (const engine of [db2, informix] as const) {
      expect(textsOf(sql, engine)).toEqual([]);
      expect(hasStatement(sql, engine)).toBe(false);
    }
  });

  it("comentário de bloco com 25 mil aberturas e 25 mil fechos (150 KB) é lido numa passada só, no PostgreSQL e no Db2 (RN-SQL-002)", () => {
    // Era O(n x profundidade): 5 s por chamada no Db2, e `hasStatement` roda a cada tecla.
    const comment = "/* ".repeat(25_000) + " */".repeat(25_000);

    for (const engine of [postgres, db2] as const) {
      const startedAt = performance.now();
      expect(hasStatement(comment, engine)).toBe(false);
      expect(hasStatement(`${comment} select 1`, engine)).toBe(true);
      expect(splitStatements(`${comment} select 1; select 2`, engine)).toHaveLength(2);
      expect(performance.now() - startedAt).toBeLessThan(200);
    }
  });

  it("fim de linha CRLF (o do Windows): o comentário `--` acaba nele nos três bancos", () => {
    for (const engine of [postgres, db2, informix] as const) expect(textsOf("select 1 -- x\r\n; select 2", engine)).toEqual(["select 1 -- x", "select 2"]);
  });

  it("sem banco, o comportamento é o do PostgreSQL", () => {
    for (const sql of ["/* a /* b */ select 1;", "{ a; b } select 1;", "do $$ begin perform 1; end $$;", "select 1; -- fim"]) {
      expect(splitStatements(sql)).toEqual(splitStatements(sql, postgres));
      expect(hasStatement(sql)).toBe(hasStatement(sql, postgres));
    }
  });
});

/**
 * RN-SQL-001 e RN-SQL-002: a seleção que é um bloco com `;` no corpo conta como um comando só. A regra repete a da API
 * (`SqlText.HasSeveralStatements`), e os casos do Db2 e do Informix são os dela (`SqlTextTests.cs`), com a mesma grafia.
 * A API só responde "tem mais de um?"; a tela conta, e por isso os casos "vários" pedem mais de um, e não um número.
 */
describe("statementCount: bloco com `;` no corpo é um comando só (RN-SQL-001)", () => {
  const postgres = 1;
  const db2 = 2;
  const informix = 3;

  const several = [
    "UPDATE t SET a = 1; UPDATE t SET a = 2",
    "UPDATE t SET a = 1;UPDATE t SET a = 2;UPDATE t SET a = 3",
    "UPDATE t SET a = 1; SELEC 1; UPDATE t SET a = 2",
    "UPDATE t SET a = 1; BEGIN WORK",
    "INSERT INTO t VALUES (1); BEGIN WORK",
    "DELETE FROM t; BEGIN WORK",
    "SELECT a FROM t; UPDATE t SET a = 1",
    "UPDATE t SET a = 1 WHERE b = 'x;y'; UPDATE t SET a = 2",
    "UPDATE t SET a = 1 -- um\n; UPDATE t SET a = 2",
    "UPDATE t SET a = 1 -- um; dois\n; UPDATE t SET a = 3",
    "UPDATE t SET a = 1 /* um */; UPDATE t SET a = 2",
    "UPDATE t SET a = 1 /* ' */; UPDATE t SET a = 2 /* ' */",
    "UPDATE t SET a = 1 -- /*\n; UPDATE t SET a = 2 -- */",
    "SELECT '--' FROM t; UPDATE t SET a = 2",
    "SELECT '/*' FROM t; UPDATE t SET a = 2 /* */",
    "SELECT 'a\\' FROM t; UPDATE t SET a = 2",
    ";;UPDATE t SET a = 1; UPDATE t SET a = 2",
    "CREATE VIEW v AS SELECT a FROM t; UPDATE t SET a = 2",
    "CREATE TABLE x (a INTEGER); UPDATE t SET a = 2",
    "SET LOCK MODE TO WAIT 5; UPDATE t SET a = 2",
    "UPDATE t SET a = 1; CREATE PROCEDURE p () UPDATE t SET a = 2; UPDATE t SET a = 3; END PROCEDURE",
    "UPDATE t SET a = 1; BEGIN UPDATE t SET a = 2; UPDATE t SET a = 3; END",
    // O comentário `--` do Db2 e do Informix só acaba na quebra de linha: a aspa depois do `\r` ainda é comentário.
    "UPDATE t SET a = 1 -- um\r'\n; UPDATE t SET a = 2 --'",
  ];

  const single = [
    "UPDATE t SET a = 1",
    "UPDATE t SET a = 1;",
    "UPDATE t SET a = 1 ; -- fim",
    "UPDATE t SET a = 1; /* fim */",
    "UPDATE t SET a = 1;;",
    ";;UPDATE t SET a = 1",
    "; ;\n UPDATE t SET a = 1 ; ;",
    "SELECT 'a; UPDATE t SET a = 2' FROM t",
    "SELECT 1 AS \"a; UPDATE t SET a = 2\" FROM t",
    "SELECT 'it''s; UPDATE t SET a = 2' FROM t",
    "SELECT '\\'' FROM t; UPDATE t SET a = 2 --'",
    "UPDATE t SET a = 1 -- um; UPDATE t SET a = 2",
    "UPDATE t SET a = 1 /* ; UPDATE t SET a = 2 ; */",
    "UPDATE t SET a = 1 -- um\r; UPDATE t SET a = 2",
  ];

  const nothing = ["", ";", "-- só um comentário; e mais"];

  // Cada linha: o que há de diferente de um banco para o outro no comentário de bloco, que o `;` de dentro não separa.
  const nested = "UPDATE t SET a = 1 /* um /* dentro */ ; UPDATE t SET a = 2 ; */";
  const braces = "UPDATE t SET a = 1 { ; UPDATE t SET a = 2 ; }";
  const quoteInBraces = "UPDATE t SET a = 1 { ' }; UPDATE t SET a = 2 { ' }";

  const db2Blocks = [
    "CREATE PROCEDURE p () LANGUAGE SQL BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "create or replace procedure p () begin update t set a = 1; end;",
    "CREATE\nOR /* x */ REPLACE\tPROCEDURE p () BEGIN IF 1 = 1 THEN UPDATE t SET a = 1; END IF; END",
    "CREATE FUNCTION f () RETURNS INTEGER LANGUAGE SQL BEGIN DECLARE n INTEGER; SET n = 1; RETURN n; END",
    "CREATE OR REPLACE FUNCTION f () RETURNS INTEGER BEGIN RETURN 1; END",
    "CREATE TRIGGER g AFTER INSERT ON t FOR EACH ROW BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "CREATE OR REPLACE TRIGGER g AFTER INSERT ON t FOR EACH ROW BEGIN ATOMIC UPDATE t SET a = 1; END",
    "BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "BEGIN\n  DECLARE n INTEGER DEFAULT 0;\n  UPDATE t SET a = n;\nEND;",
    "-- cria\n/* o bloco */ BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END -- fim",
    "BEGIN UPDATE t SET a = 1; END; UPDATE t SET a = 2",
    // Os `;` soltos e os comentários antes do `CREATE` não o tiram da primeira palavra; as quebras de linha entre as palavras também não.
    ";; -- cria\n/* o bloco */ ; CREATE PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "create\n\n  procedure p () begin update t set a = 1; update t set a = 2; end",
    "Create Function f () Returns Integer Begin Declare n Integer; Return n; End",
  ];

  const db2NotBlocks = [
    "SELECT a AS begin FROM t; UPDATE t SET a = 2",
    "CREATE TABLE begin (a INTEGER); UPDATE t SET a = 2",
    "bloco: BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END bloco",
    // Palavra inteira, e fora de aspas: nenhuma destas é `BEGIN` nem `CREATE PROCEDURE`.
    "BEGINNING UPDATE t SET a = 1; UPDATE t SET a = 2",
    '"BEGIN" UPDATE t SET a = 1; UPDATE t SET a = 2',
    "'CREATE PROCEDURE' ; UPDATE t SET a = 2",
    "CREATED PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "CREATE PROCEDURES p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "CREATE \"PROCEDURE\" p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    "/* BEGIN */ SELECT 1; SELECT 2",
    "-- BEGIN\nSELECT 1; SELECT 2",
    // O İ (I com ponto, do turco) não é o `I` do ASCII: `BEGİN` não é `BEGIN`.
    "BEGİN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
  ];

  const informixRoutines = [
    "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
    "create procedure p () update t set a = 1; end procedure;",
    "CREATE DBA PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
    "CREATE OR REPLACE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; -- fim",
    "CREATE PROCEDURE IF NOT EXISTS p () UPDATE t SET a = 1; END PROCEDURE { fim }",
    "CREATE FUNCTION f () RETURNING INTEGER; DEFINE n INTEGER; LET n = 1; RETURN n; END FUNCTION",
    "CREATE PROCEDURE p () IF 1 = 1 THEN UPDATE t SET a = 1; END IF; BEGIN UPDATE t SET a = 2; END; END PROCEDURE",
    "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE DOCUMENT 'um; dois' WITH LISTING IN '/tmp/p.txt';",
    "{ cria }\nCREATE PROCEDURE p () UPDATE t SET a = 1; { e; mais } UPDATE t SET a = 2; END PROCEDURE",
    "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1, UPDATE t SET a = 2);",
    // O fim com comentário, espaço ou quebra de linha no meio, e os `;` soltos antes do `CREATE`.
    "CREATE PROCEDURE p () UPDATE t SET a = 1; END /* fim */ PROCEDURE",
    "CREATE FUNCTION f () RETURNING INTEGER; RETURN 1; end\nfunction;",
    ";; CREATE\nPROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
  ];

  const informixSeveral = [
    "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; UPDATE t SET a = 2",
    "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; BEGIN WORK",
    "CREATE DBA PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; BEGIN WORK",
    "CREATE FUNCTION f () RETURNING INTEGER; RETURN 1; END FUNCTION; BEGIN WORK",
    "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE DOCUMENT 'x'; BEGIN WORK",
    "CREATE FUNCTION f (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/f.so(f)' LANGUAGE C; UPDATE t SET a = 2",
    "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2",
    "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1); BEGIN WORK",
    "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1; UPDATE t SET a = 2)",
    "BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
    // Palavra inteira: `ENDING PROCEDURE` e `"END" PROCEDURE` não são o fim da rotina, que fica sem fim (todo `;` separa).
    "CREATE PROCEDURE p () UPDATE t SET a = 1; ENDING PROCEDURE",
    'CREATE PROCEDURE p () UPDATE t SET a = 1; "END" PROCEDURE; UPDATE t SET a = 2',
    "CREATE PROCEDURES p () UPDATE t SET a = 1; END PROCEDURE; UPDATE t SET a = 2",
  ];

  describe("Db2 (os casos de SqlText.HasSeveralStatements)", () => {
    it.each(several.map((sql) => [sql]))("mais de um comando: %j", (sql) => {
      expect(statementCount(sql, db2)).toBeGreaterThan(1);
    });

    it.each(single.map((sql) => [sql]))("um comando só: %j", (sql) => {
      expect(statementCount(sql, db2)).toBe(1);
    });

    it.each(nothing.map((sql) => [sql]))("nada para enviar: %j", (sql) => {
      expect(statementCount(sql, db2)).toBe(0);
    });

    it.each(db2Blocks.map((sql) => [sql]))("procedimento, função, gatilho e bloco composto são um comando só: %j", (sql) => {
      expect(statementCount(sql, db2)).toBe(1);
    });

    it.each(db2NotBlocks.map((sql) => [sql]))("o que não é bloco continua contado pelos `;`: %j", (sql) => {
      expect(statementCount(sql, db2)).toBeGreaterThan(1);
    });

    it("o comentário de bloco aninha, e a chave não é comentário", () => {
      expect(statementCount(nested, db2)).toBe(1);
      expect(statementCount(braces, db2)).toBe(3);
      expect(statementCount(quoteInBraces, db2)).toBe(1);
    });

    it("o comentário `--` só acaba na quebra de linha: o `\\r` fica dentro dele", () => {
      expect(statementCount("UPDATE t SET a = 1 -- um\r'\n; UPDATE t SET a = 2 --'", db2)).toBe(2);
      expect(statementCount("UPDATE t SET a = 1 -- um\r; UPDATE t SET a = 2", db2)).toBe(1);
    });

    it("o bloco vai até o fim do texto, mesmo com outro comando depois: quem recusa é o banco, sem executar nada", () => {
      expect(statementCount("BEGIN UPDATE t SET a = 1; END; UPDATE t SET a = 2", db2)).toBe(1);
    });

    it("um comando comum antes do bloco continua sendo um comando, e o bloco depois dele outro", () => {
      expect(statementCount("UPDATE t SET a = 1; CREATE PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END", db2)).toBe(2);
    });
  });

  describe("Informix (os casos de SqlText.HasSeveralStatements)", () => {
    it.each(several.map((sql) => [sql]))("mais de um comando: %j", (sql) => {
      expect(statementCount(sql, informix)).toBeGreaterThan(1);
    });

    it.each(single.map((sql) => [sql]))("um comando só: %j", (sql) => {
      expect(statementCount(sql, informix)).toBe(1);
    });

    it.each(nothing.map((sql) => [sql]))("nada para enviar: %j", (sql) => {
      expect(statementCount(sql, informix)).toBe(0);
    });

    it.each(informixRoutines.map((sql) => [sql]))("rotina até o END PROCEDURE ou END FUNCTION é um comando só: %j", (sql) => {
      expect(statementCount(sql, informix)).toBe(1);
    });

    it.each(informixSeveral.map((sql) => [sql]))("depois do fim, ou sem fim, todo `;` separa: %j", (sql) => {
      expect(statementCount(sql, informix)).toBeGreaterThan(1);
    });

    it("o comentário de bloco acaba no primeiro `*/`, a chave é comentário e o `;` dentro dela não separa", () => {
      expect(statementCount(nested, informix)).toBe(3);
      expect(statementCount("/* a /* b */ ; SELECT 1", informix)).toBe(1);
      expect(statementCount(braces, informix)).toBe(1);
      expect(statementCount(quoteInBraces, informix)).toBe(2);
    });

    it("a rotina termina no END PROCEDURE: o que vem depois é outro comando, e a conta é exata", () => {
      expect(statementCount("CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE; DROP TABLE x", informix)).toBe(2);
      expect(statementCount("CREATE PROCEDURE a () SELECT 1; END PROCEDURE; CREATE PROCEDURE b () SELECT 2; END PROCEDURE", informix)).toBe(2);
    });

    it("rotina sem fim (externa): cada `;` conta, também depois de uma rotina que tem fim", () => {
      expect(statementCount("CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; UPDATE t SET a = 3", informix)).toBe(3);
      expect(statementCount("CREATE PROCEDURE a () SELECT 1; SELECT 2; END PROCEDURE; CREATE PROCEDURE b () UPDATE t SET a = 1; UPDATE t SET a = 2;", informix)).toBe(3);
    });

    it("gatilho e `BEGIN ... END` não têm bloco: a regra do Db2 não vale", () => {
      expect(statementCount("CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1); BEGIN WORK", informix)).toBe(2);
      expect(statementCount("BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END", informix)).toBe(3);
    });
  });

  describe("PostgreSQL (e sem banco): CREATE FUNCTION e PROCEDURE com `BEGIN ATOMIC ... END`", () => {
    const atomic = "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END";

    it("o `;` dentro de `BEGIN ATOMIC ... END` não separa, com ou sem o `;` do fim", () => {
      for (const engine of [postgres, undefined] as const) {
        expect(statementCount(atomic, engine)).toBe(1);
        expect(statementCount(`${atomic};`, engine)).toBe(1);
        expect(statementCount("create or replace procedure p() language sql begin atomic update t set a = 1; delete from t; end;", engine)).toBe(1);
      }
    });

    it("depois do `END` que zera a profundidade o `;` volta a separar", () => {
      expect(statementCount(`${atomic}; SELECT 3`, postgres)).toBe(2);
      expect(statementCount(`${atomic}; SELECT 3; SELECT 4`, postgres)).toBe(3);
    });

    it("`CASE ... END` dentro do corpo soma e tira um: o `END` do `CASE` não fecha o bloco", () => {
      const withCase = "create function f(x int) returns int language sql begin atomic select case when x > 0 then 1 else 2 end; select case x when 1 then case when true then 3 end end; end";

      expect(statementCount(withCase, postgres)).toBe(1);
      expect(statementCount(`${withCase}; select 9`, postgres)).toBe(2);
    });

    it("dois CREATE FUNCTION ... BEGIN ATOMIC ... END seguidos são dois comandos", () => {
      expect(statementCount(`${atomic}; ${atomic};`, postgres)).toBe(2);
      expect(statementCount(`${atomic}\n;\n-- outra\ncreate procedure p() language sql begin atomic select 1; end`, postgres)).toBe(2);
    });

    it("CREATE FUNCTION com corpo `$$ ... $$` e outro comando depois são dois", () => {
      expect(statementCount("create function f() returns int as $$ select 1; $$ language sql; select 2", postgres)).toBe(2);
      expect(statementCount("create function f() returns int as $f$ begin return 1; end; $f$ language plpgsql;", postgres)).toBe(1);
    });

    it("`BEGIN` e `CASE` fora de CREATE FUNCTION e PROCEDURE não abrem bloco", () => {
      expect(statementCount("BEGIN; UPDATE t SET a = 1; COMMIT", postgres)).toBe(3);
      expect(statementCount("BEGIN ATOMIC SELECT 1; SELECT 2; END", postgres)).toBe(3);
      expect(statementCount("create view v as select case when a then 1 end from t; select 2", postgres)).toBe(2);
      expect(statementCount("create table begin_log (a int); begin atomic select 1; end", postgres)).toBe(3);
    });

    it("`CASE` com a profundidade em zero não soma, e o `END` dele não desce abaixo de zero", () => {
      expect(statementCount("create function f() returns int language sql return case when true then 1 end; select 2", postgres)).toBe(2);
    });

    it("palavra inteira, fora de aspas e de comentário: `beginning`, `ending`, \"end\" e 'begin' não contam", () => {
      expect(statementCount("create function beginning() returns int language sql return 1; select 2", postgres)).toBe(2);
      expect(statementCount("create function f() returns int language sql return 'begin'; select 2", postgres)).toBe(2);
      expect(statementCount("create function f() returns int language sql begin atomic select 1 as \"end\", 2 as ending; select 2; end", postgres)).toBe(1);
      expect(statementCount("create function f() returns int language sql begin atomic select 1; /* end */ select 2; -- end\nend", postgres)).toBe(1);
      expect(statementCount("create function f() returns int language sql begin atomic select 1; select 'end;'; end", postgres)).toBe(1);
    });

    it("`CREATE TABLE` e outros `CREATE` que não são de rotina não abrem bloco", () => {
      expect(statementCount("create table a (x int); drop table b", postgres)).toBe(2);
      expect(statementCount("create temp table f (begin int); select 2", postgres)).toBe(2);
    });

    it("`BEGIN` sem `ATOMIC` também soma profundidade, como no `psql`: `create procedure p() begin ...; ...; end` é um comando só", () => {
      expect(statementCount("create procedure p() begin update t set a = 1; delete from t; end", postgres)).toBe(1);
      expect(statementCount("create procedure p() begin update t set a = 1; delete from t; end; select 2", postgres)).toBe(2);
    });

    // `begin` não é reservada no PostgreSQL: serve de nome de parâmetro e de coluna. Dentro de parênteses `begin`, `case` e `end`
    // não contam (como no `psql`), ou o `begin` abriria um bloco que nunca fecha e o `;` deixaria de separar.
    it.each([
      "CREATE FUNCTION f(begin int) RETURNS int LANGUAGE sql AS 'select 1'; DROP TABLE x",
      "CREATE FUNCTION slots(OUT begin timestamptz, OUT finish timestamptz) AS $$ select 1, 2 $$ LANGUAGE sql; SELECT * FROM slots()",
      "CREATE FUNCTION g() RETURNS TABLE (begin timestamptz, x int) LANGUAGE sql AS $$ select now(), 1 $$; DROP TABLE x",
      "CREATE FUNCTION h() RETURNS int LANGUAGE sql RETURN (SELECT begin FROM t LIMIT 1); DROP TABLE x",
    ].map((sql) => [sql]))("`begin` dentro de parênteses não abre bloco: %j", (sql) => {
      expect(statementCount(sql, postgres)).toBe(2);
    });

    it("`CASE ... END` entre parênteses dentro de `BEGIN ATOMIC` continua contando certo, e `begin` entre parênteses no corpo não soma", () => {
      const body = "create function f(x int) returns int language sql begin atomic select (case when x > 0 then 1 else 2 end); select (select begin from t); select 3; end";

      expect(statementCount(body, postgres)).toBe(1);
      expect(statementCount(`${body}; select 9`, postgres)).toBe(2);
    });

    it("`)` sem `(` antes não leva a conta de parênteses abaixo de zero: o `end` entre parênteses que vem depois continua ignorado", () => {
      expect(statementCount("create function f() returns int language sql begin atomic select 1); select (select 1 end); select 2; end", postgres)).toBe(1);
    });

    it("sem o `END` o bloco fica aberto até o fim do texto: é um comando só (e o banco responde o erro de sintaxe)", () => {
      expect(statementCount("create function f() returns int language sql begin atomic select 1; select 2", postgres)).toBe(1);
    });

    it("o comentário `--` acaba no retorno de carro", () => {
      expect(statementCount("-- x\rSELECT 1", postgres)).toBe(1);
      expect(statementCount("UPDATE t SET a = 1 -- um\r'\n; UPDATE t SET a = 2 --'", postgres)).toBe(1);
      expect(statementCount("UPDATE t SET a = 1 -- um\r; UPDATE t SET a = 2", postgres)).toBe(2);
    });
  });

  it("o comando do cursor não muda: o bloco inteiro se executa selecionando-o (RN-SQL-002), e splitStatements segue separando pelo `;`", () => {
    const block = "create procedure p () begin update t set a = 1; update t set a = 2; end";
    const atomic = "create function f() returns int language sql begin atomic select 1; select 2; end";

    for (const engine of [postgres, db2, informix] as const) {
      expect(statementAt(block, 0, engine)?.text).toBe("create procedure p () begin update t set a = 1");
      expect(splitStatements(block, engine)).toHaveLength(3);
    }
    expect(statementAt(atomic, 0, postgres)?.text).toBe("create function f() returns int language sql begin atomic select 1");
    expect(splitStatements(atomic, postgres)).toHaveLength(3);
  });

  describe("o que não é bloco continua contado pelos `;`, nos três bancos", () => {
    it.each([postgres, db2, informix] as const)("CREATE TABLE a (x int); DROP TABLE b são dois e SELECT 1; SELECT 2 são dois (banco %i)", (engine) => {
      expect(statementCount("CREATE TABLE a (x int); DROP TABLE b", engine)).toBe(2);
      expect(statementCount("SELECT 1; SELECT 2", engine)).toBe(2);
    });

    it("sem bloco, a conta é a do separador: statementCount = splitStatements(...).length", () => {
      const plain = [
        ...single,
        ...nothing,
        ...db2NotBlocks,
        nested,
        braces,
        quoteInBraces,
        "select 'a;b' from t; select 2",
        "do $$ begin perform 1; end $$; select 2",
        "select $1; select $2",
        "/* x */ ; -- y\n select 1 ; /* z",
        "update t set a = 1; update t set a = 2; select 3",
        "select 'x' ; \"y;z\" ; {a;b}",
      ];

      for (const engine of [postgres, db2, informix, undefined] as const) {
        for (const sql of plain) expect(statementCount(sql, engine), `${engine ?? "sem banco"}: ${JSON.stringify(sql)}`).toBe(splitStatements(sql, engine).length);
      }
    });
  });
});

describe("commandStart (RN-SQL-020: onde o texto do comando começa, depois dos comentários de cima)", () => {
  it("pula espaços e comentários pelas regras de cada banco, e o `;` não é pulado (ele é do texto)", () => {
    expect(commandStart("  -- a\n/* b /* c */ d */\tselect 1", 1)).toBe("  -- a\n/* b /* c */ d */\t".length);
    expect(commandStart("/* b /* c */ select 1", 3)).toBe("/* b /* c */ ".length);
    expect(commandStart("{ x }\nselect 1", 3)).toBe("{ x }\n".length);
    expect(commandStart("{ x }\nselect 1", 1)).toBe(0);
    expect(commandStart(";select 1", 1)).toBe(0);
  });

  it("só espaço e comentário: o tamanho do texto", () => {
    expect(commandStart("  -- nada", 2)).toBe("  -- nada".length);
    expect(commandStart("")).toBe(0);
  });
});

describe("utf16IndexOf (RN-SQL-009: o banco conta a posição em caracteres, o editor em unidades UTF-16)", () => {
  it("texto sem acento nem emoji: a posição de 1 em diante é o índice mais 1", () => {
    expect(utf16IndexOf("SELECT 1 FROM t", 1)).toBe(0);
    expect(utf16IndexOf("SELECT 1 FROM t", 10)).toBe(9);
  });

  it("caractere acentuado conta um só nas duas medidas", () => {
    // `SELECT 'ção', FROM x`: o F é o caractere 15 e o índice 14.
    expect(utf16IndexOf("SELECT 'ção', FROM x", 15)).toBe(14);
  });

  it("cada emoji antes do erro conta um para o banco e dois para o editor", () => {
    // `SELECT 'ção 😀', FROM loja.cliente`: o banco aponta a posição 17 (o F), que é o índice 16 em caracteres e o 17 em UTF-16.
    const sql = "SELECT 'ção 😀', FROM loja.cliente";
    expect(utf16IndexOf(sql, 17)).toBe(17);
    expect(sql.slice(utf16IndexOf(sql, 17), utf16IndexOf(sql, 17) + 4)).toBe("FROM");

    expect(utf16IndexOf("😀😀x", 3)).toBe(4);
  });

  it("o emoji que é o próprio erro começa nele, e o que passa do fim do texto para no fim", () => {
    expect(utf16IndexOf("a😀b", 2)).toBe(1);
    expect(utf16IndexOf("a😀b", 3)).toBe(3);
    expect(utf16IndexOf("abc", 99)).toBe(3);
  });
});
