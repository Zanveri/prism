import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { splitStatements, statementAt, statementCount } from "./sql-statements";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;
const engines = [postgres, db2, informix] as const;

/** Os comandos do texto com a preferência "A linha em branco separa os comandos" ligada (RN-SQL-018). */
const texts = (sql: string, engine?: Engine) => splitStatements(sql, engine, { blankLines: true }).map((statement) => statement.text);

/** Quantos comandos, com a linha em branco ligada. */
const count = (sql: string, engine?: Engine) => texts(sql, engine).length;

/** `§` marca o cursor: o comando que o Ctrl+Enter sem seleção envia, com a linha em branco ligada (ou desligada, com `blankLines: false`). */
function at(marked: string, engine?: Engine, blankLines = true): string | null {
  const offset = marked.indexOf("§");
  return statementAt(marked.replace("§", ""), offset, engine, { blankLines })?.text ?? null;
}

describe("a linha em branco separa o comando do cursor (RN-SQL-018)", () => {
  it.each(engines)("dois SELECT separados por uma linha em branco são dois comandos, e o cursor fica com o dele (banco %i)", (engine) => {
    const sql = "SELECT * FROM a\nWHERE x = 1\n\nSELECT * FROM b";

    expect(texts(sql, engine)).toEqual(["SELECT * FROM a\nWHERE x = 1", "SELECT * FROM b"]);
    expect(at("SELECT * FROM a\nWHERE §x = 1\n\nSELECT * FROM b", engine)).toBe("SELECT * FROM a\nWHERE x = 1");
    expect(at("SELECT * FROM a\nWHERE x = 1§\n\nSELECT * FROM b", engine)).toBe("SELECT * FROM a\nWHERE x = 1");
    expect(at("SELECT * FROM a\nWHERE x = 1\n\n§SELECT * FROM b", engine)).toBe("SELECT * FROM b");
    expect(at("SELECT * FROM a\nWHERE x = 1\n\nSELECT * FROM b§", engine)).toBe("SELECT * FROM b");
  });

  it("a linha só com espaços e tabulações também é branca, e várias linhas em branco seguidas separam uma vez", () => {
    expect(texts("SELECT 1\n  \t \nSELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(texts("SELECT 1\n\n\n\nSELECT 2\n\n\nSELECT 3\n\n")).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });

  it("a quebra de linha sozinha não separa: sem linha em branco, é um comando só, como antes", () => {
    expect(texts("SELECT 1\nSELECT 2")).toEqual(["SELECT 1\nSELECT 2"]);
  });

  it("fim de linha CRLF (o do Windows), nos três bancos", () => {
    for (const engine of engines) expect(texts("SELECT 1\r\n\r\nSELECT 2\r\n", engine), String(engine)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("`start` e `end` apontam o trecho exato, e o texto é o que vai ao banco", () => {
    const sql = "  SELECT 1  \n\n  SELECT 2  ";
    const statements = splitStatements(sql, postgres, { blankLines: true });

    expect(statements).toEqual([
      { text: "SELECT 1", start: 2, end: 10 },
      { text: "SELECT 2", start: 16, end: 24 },
    ]);
    for (const statement of statements) expect(sql.slice(statement.start, statement.end)).toBe(statement.text);
  });

  it("o comentário logo acima do comando vai com ele, e o que tem uma linha em branco antes do comando, não; o logo abaixo fica com o de cima", () => {
    expect(texts("SELECT 1\n-- ainda do 1\n\n-- solto\n\n-- do 2\nSELECT 2")).toEqual(["SELECT 1\n-- ainda do 1", "-- do 2\nSELECT 2"]);
    expect(texts("-- título solto\n\nSELECT 1")).toEqual(["SELECT 1"]);
    expect(texts("/* título */\nSELECT 1")).toEqual(["/* título */\nSELECT 1"]);
    expect(texts("SELECT 1;\n\n-- solto\n\nSELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("o comentário entre o fim e a linha em branco não esconde a linha em branco, nem a do `--` que acaba na quebra de linha", () => {
    expect(texts("SELECT 1 -- um\n\nSELECT 2")).toEqual(["SELECT 1 -- um", "SELECT 2"]);
    expect(texts("SELECT 1 /* um */\n\nSELECT 2")).toEqual(["SELECT 1 /* um */", "SELECT 2"]);
    expect(texts("SELECT 1\n-- um\n\nSELECT 2", informix)).toEqual(["SELECT 1\n-- um", "SELECT 2"]);
  });
});

describe("o comando de cima que ainda não acabou fica com o de baixo (RN-SQL-018)", () => {
  it.each(engines)("DELETE FROM t, a linha em branco e WHERE id = 1 são um comando só, também com comentário no meio (banco %i)", (engine) => {
    expect(texts("DELETE FROM t\n\nWHERE id = 1", engine)).toEqual(["DELETE FROM t\n\nWHERE id = 1"]);
    expect(texts("DELETE FROM t\n\n-- só o 1\nWHERE id = 1", engine)).toEqual(["DELETE FROM t\n\n-- só o 1\nWHERE id = 1"]);
    expect(at("DELETE §FROM t\n\nWHERE id = 1", engine)).toBe("DELETE FROM t\n\nWHERE id = 1");
    expect(at("DELETE FROM t\n§\nWHERE id = 1", engine)).toBe("DELETE FROM t\n\nWHERE id = 1");
  });

  it.each(engines)("UPDATE t, a linha em branco e SET …: SET não começa comando (banco %i)", (engine) => {
    expect(count("UPDATE t\n\nSET a = 1\n\nWHERE id = 1", engine)).toBe(1);
    expect(count("UPDATE t SET a = 1\n\nWHERE id = 1", engine)).toBe(1);
    expect(count("UPDATE t SET a = 1,\n\nb = 2", engine)).toBe(1);
  });

  it.each(engines)("WITH: a linha em branco dentro das consultas e entre elas e o comando principal não separa; depois do comando, separa (banco %i)", (engine) => {
    expect(count("WITH x AS (\n  SELECT 1 AS a\n\n  FROM t\n)\n\nSELECT * FROM x", engine)).toBe(1);
    expect(count("WITH x AS (SELECT 1 FROM t),\n\ny (b) AS (SELECT 2 FROM t)\n\nSELECT * FROM x, y", engine)).toBe(1);
    expect(count("WITH RECURSIVE n (i) AS (VALUES (1) UNION ALL SELECT i + 1 FROM n WHERE i < 3)\n\nSELECT * FROM n", engine)).toBe(1);
    expect(count("WITH x AS (SELECT 1 FROM t)\n\nINSERT INTO u\n\nSELECT * FROM x", engine)).toBe(1);
    expect(texts("WITH x AS (SELECT 1 FROM t) SELECT * FROM x\n\nSELECT 2 FROM t", engine)).toEqual(["WITH x AS (SELECT 1 FROM t) SELECT * FROM x", "SELECT 2 FROM t"]);
  });

  it("PostgreSQL: WITH … AS MATERIALIZED e AS NOT MATERIALIZED, e o WITH depois do AS de um CREATE VIEW", () => {
    expect(count("WITH x AS MATERIALIZED (SELECT 1)\n\nSELECT * FROM x", postgres)).toBe(1);
    expect(count("WITH x AS NOT MATERIALIZED (SELECT 1)\n\nSELECT * FROM x", postgres)).toBe(1);
    expect(count("CREATE VIEW v AS WITH x AS (SELECT 1)\n\nSELECT * FROM x", postgres)).toBe(1);
  });

  it.each(engines)("UNION, UNION ALL, INTERSECT, EXCEPT e MINUS com a linha em branco antes ou depois (banco %i)", (engine) => {
    expect(count("SELECT 1 FROM t\n\nUNION ALL\n\nSELECT 2 FROM t", engine)).toBe(1);
    expect(count("SELECT 1 FROM t\nUNION\n\nSELECT 2 FROM t", engine)).toBe(1);
    expect(count("SELECT 1 FROM t\n\nINTERSECT\nSELECT 2 FROM t", engine)).toBe(1);
    expect(count("SELECT 1 FROM t EXCEPT\n\nSELECT 2 FROM t", engine)).toBe(1);
    expect(count("SELECT 1 FROM t MINUS\n\nSELECT 2 FROM t", engine)).toBe(1);
    expect(count("SELECT 1 FROM t UNION DISTINCT\n\nSELECT 2 FROM t", engine)).toBe(1);
  });

  it.each(engines)("INSERT … SELECT e INSERT … VALUES com a linha em branco no meio são um comando; depois do corpo, separa (banco %i)", (engine) => {
    expect(count("INSERT INTO t (a, b)\n\nSELECT a, b FROM s", engine)).toBe(1);
    expect(count("INSERT INTO t\n\nVALUES (1)", engine)).toBe(1);
    expect(count("INSERT INTO t (a)\n\nVALUES (1),\n\n(2)", engine)).toBe(1);
    expect(count("INSERT INTO t\n\n(SELECT a FROM s)", engine)).toBe(1);
    expect(texts("INSERT INTO t SELECT * FROM s\n\nSELECT * FROM t", engine)).toEqual(["INSERT INTO t SELECT * FROM s", "SELECT * FROM t"]);
    expect(texts("INSERT INTO t VALUES (1)\n\nSELECT * FROM t", engine)).toEqual(["INSERT INTO t VALUES (1)", "SELECT * FROM t"]);
  });

  it("Informix: INSERT INTO t, a linha em branco e EXECUTE PROCEDURE é um comando", () => {
    expect(count("INSERT INTO t\n\nEXECUTE PROCEDURE p()", informix)).toBe(1);
  });

  it("MERGE: o INSERT do WHEN NOT MATCHED espera o VALUES, e o THEN pede o resto", () => {
    for (const engine of engines) {
      expect(count("MERGE INTO t USING s ON t.id = s.id\nWHEN NOT MATCHED THEN INSERT (id)\n\nVALUES (s.id)", engine)).toBe(1);
      expect(count("MERGE INTO t USING s ON t.id = s.id\nWHEN MATCHED THEN\n\nUPDATE SET a = 1", engine)).toBe(1);
      expect(count("MERGE INTO t USING s ON t.id = s.id\nWHEN MATCHED THEN\n\nDELETE", engine)).toBe(1);
    }
  });

  it("os parênteses abertos seguram o comando", () => {
    expect(count("SELECT * FROM t WHERE id IN (\n\nSELECT id FROM s)")).toBe(1);
    expect(count("SELECT * FROM (\n  SELECT 1 FROM t\n\n  UNION SELECT 2 FROM t\n\n) x")).toBe(1);
    expect(count("CREATE TABLE t2 AS (\n\nSELECT * FROM t) WITH DATA", db2)).toBe(1);
  });

  it.each([",", "=", "+", "-", "*", "/", "||", "<", ">", "."])("o comando de cima que termina em `%s` pede continuação", (mark) => {
    expect(count(`SELECT a ${mark}\n\nSELECT 2`)).toBe(1);
  });

  it.each([
    "WHERE", "AND", "OR", "NOT", "ON", "JOIN", "LEFT JOIN", "FROM", "SELECT", "SET", "BY", "ORDER BY", "GROUP BY", "UNION", "ALL", "INTERSECT", "EXCEPT", "MINUS", "THEN",
    "ELSE", "WHEN", "CASE", "AS", "IN", "INTO", "VALUES", "LIKE", "BETWEEN", "IS", "HAVING", "USING", "FOR", "TO", "GRANT", "REVOKE", "EXISTS", "DISTINCT", "RETURNING",
  ])("o comando de cima que termina em %s pede continuação", (word) => {
    for (const engine of engines) expect(count(`SELECT a FROM t ${word}\n\nSELECT 2`, engine), String(engine)).toBe(1);
  });

  it("o fim que pede continuação nos comandos de verdade: CREATE VIEW … AS, DECLARE … CURSOR FOR, GRANT, ON CONFLICT … DO, DO INSTEAD", () => {
    expect(count("CREATE VIEW v AS\n\nSELECT 1")).toBe(1);
    expect(count("CREATE TABLE c AS\n\nSELECT * FROM t")).toBe(1);
    expect(count("DECLARE c CURSOR FOR\n\nSELECT 1")).toBe(1);
    expect(count("GRANT\n\nSELECT ON t TO u")).toBe(1);
    expect(count("INSERT INTO t VALUES (1) ON CONFLICT (id) DO\n\nUPDATE SET a = 1", postgres)).toBe(1);
    expect(count("CREATE RULE r AS ON INSERT TO t DO INSTEAD\n\nINSERT INTO u VALUES (1)", postgres)).toBe(1);
  });

  it("Db2 e PostgreSQL: o DELETE ROWS do ON COMMIT é do comando de cima", () => {
    expect(count("DECLARE GLOBAL TEMPORARY TABLE tmp (a INT) ON COMMIT\n\nDELETE ROWS", db2)).toBe(1);
    expect(count("CREATE TEMP TABLE tmp (a INT) ON COMMIT\n\nDELETE ROWS", postgres)).toBe(1);
  });

  it("EXPLAIN espera o comando que explica, com ANALYZE e as opções entre parênteses", () => {
    expect(count("EXPLAIN\n\nSELECT 1", postgres)).toBe(1);
    expect(count("EXPLAIN ANALYZE\n\nSELECT 1", postgres)).toBe(1);
    expect(count("EXPLAIN (ANALYZE, BUFFERS)\n\nSELECT 1", postgres)).toBe(1);
    expect(count("EXPLAIN PLAN FOR\n\nSELECT 1 FROM t", db2)).toBe(1);
    expect(texts("EXPLAIN SELECT 1\n\nSELECT 2", postgres)).toEqual(["EXPLAIN SELECT 1", "SELECT 2"]);
  });

  it("o fim que parece pedir continuação mas é valor: DEFAULT VALUES, SET EXPLAIN ON do Informix, SET x = on, SET x TO on", () => {
    expect(texts("INSERT INTO t DEFAULT VALUES\n\nSELECT * FROM t", postgres)).toEqual(["INSERT INTO t DEFAULT VALUES", "SELECT * FROM t"]);
    expect(texts("SET EXPLAIN ON\n\nSELECT * FROM t", informix)).toEqual(["SET EXPLAIN ON", "SELECT * FROM t"]);
    expect(count("SET enable_seqscan = on\n\nSELECT 1", postgres)).toBe(2);
    expect(count("ALTER SYSTEM SET jit TO on\n\nSELECT 1", postgres)).toBe(2);
  });
});

describe("depois da linha em branco tem de começar um comando (RN-SQL-018)", () => {
  const starters = [
    "SELECT 2 FROM t",
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t WHERE a = 1",
    "MERGE INTO t USING s ON (t.a = s.a) WHEN MATCHED THEN DELETE",
    "VALUES (1)",
    "WITH x AS (SELECT 1 FROM t) SELECT * FROM x",
    "WITH RECURSIVE x AS (SELECT 1 FROM t) SELECT * FROM x",
    "CREATE TABLE u (a INT)",
    "CREATE OR REPLACE VIEW v AS SELECT 1 FROM t",
    "ALTER TABLE t ADD b INT",
    "DROP TABLE t",
    "DROP MATERIALIZED VIEW v",
    "TRUNCATE TABLE t",
    "GRANT SELECT ON t TO u",
    "REVOKE SELECT ON t FROM u",
    "CALL p()",
    "EXECUTE PROCEDURE p()",
    "EXPLAIN SELECT 1 FROM t",
    "COMMENT ON TABLE t IS 'x'",
    "ANALYZE t",
    "VACUUM t",
    "LOCK TABLE t IN SHARE MODE",
    "SHOW search_path",
    "COPY t TO STDOUT",
    "DECLARE GLOBAL TEMPORARY TABLE x (a INT)",
    "REFRESH MATERIALIZED VIEW v",
    "REFRESH TABLE mqt",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT s",
  ];

  it.each(starters)("%s começa um comando, nos três bancos", (starter) => {
    for (const engine of engines) expect(texts(`SELECT 1 FROM t\n\n${starter}`, engine), String(engine)).toEqual(["SELECT 1 FROM t", starter]);
  });

  it("o DO do PostgreSQL com o corpo começa um comando; o DO do ON CONFLICT e o da regra, não", () => {
    expect(texts("SELECT 1\n\nDO $$ BEGIN PERFORM 1; END $$", postgres)).toEqual(["SELECT 1", "DO $$ BEGIN PERFORM 1; END $$"]);
    expect(count("SELECT 1\n\nDO LANGUAGE plpgsql $$ BEGIN END $$", postgres)).toBe(2);
    expect(count("INSERT INTO t VALUES (1) ON CONFLICT (id)\n\nDO UPDATE SET a = 1", postgres)).toBe(1);
    expect(count("CREATE RULE r AS ON INSERT TO t\n\nDO INSTEAD NOTHING", postgres)).toBe(1);
  });

  it.each(["SET x = 1", "BEGIN", "FROM t", "WHERE a = 1", "ORDER BY a", "(SELECT 2)", "'texto'", "a = 1", "RETURNING id", "END"])("%s não começa: fica com o de cima", (rest) => {
    for (const engine of engines) expect(count(`SELECT 1 FROM t\n\n${rest}`, engine), String(engine)).toBe(1);
  });

  it.each(["WITH UR", "WITH CS", "WITH RS", "WITH RR", "WITH RS USE AND KEEP UPDATE LOCKS"])("Db2: %s é o isolamento do comando de cima, e não outro comando", (isolation) => {
    expect(texts(`SELECT * FROM t\n\n${isolation}`, db2)).toEqual([`SELECT * FROM t\n\n${isolation}`]);
    expect(texts(`SELECT * FROM t\n\n${isolation}\n\nSELECT 2 FROM t`, db2)).toEqual([`SELECT * FROM t\n\n${isolation}`, "SELECT 2 FROM t"]);
  });

  it("o WITH que não abre consultas não começa comando: WITH NO DATA, WITH CHECK OPTION, WITH ORDINALITY, WITH GRANT OPTION, WITH (opções)", () => {
    expect(count("CREATE TABLE t2 AS (SELECT * FROM t)\n\nWITH NO DATA", db2)).toBe(1);
    expect(count("CREATE VIEW v AS SELECT * FROM t\n\nWITH CHECK OPTION")).toBe(1);
    expect(count("SELECT * FROM unnest(a)\n\nWITH ORDINALITY AS u (x, n)", postgres)).toBe(1);
    expect(count("GRANT SELECT ON t TO u\n\nWITH GRANT OPTION")).toBe(1);
    expect(count("CREATE TABLE t (a INT)\n\nWITH (fillfactor = 70)", postgres)).toBe(1);
    expect(count("SELECT * FROM t INTO TEMP x\n\nWITH NO LOG", informix)).toBe(1);
  });

  it("ALTER e DROP só começam comando com o tipo do objeto depois: DROP STORAGE, ALTER COLUMN e DROP CONSTRAINT são cláusulas", () => {
    expect(count("TRUNCATE TABLE t\n\nDROP STORAGE", db2)).toBe(1);
    expect(count("TRUNCATE t\n\nREUSE STORAGE", informix)).toBe(1);
    expect(count("CREATE TABLE a (x INT)\n\nDROP COLUMN x")).toBe(1);
    expect(count("SELECT 1 FROM t\n\nALTER FOREIGN KEY fk NOT ENFORCED", db2)).toBe(1);
    expect(count("SELECT 1 FROM t\n\nDROP MATERIALIZED QUERY", db2)).toBe(1);
    expect(texts("CREATE TABLE a (x INT)\n\nDROP TABLE b")).toEqual(["CREATE TABLE a (x INT)", "DROP TABLE b"]);
    expect(texts("CREATE TABLE a (x INT)\n\nALTER TABLE a ADD y INT")).toEqual(["CREATE TABLE a (x INT)", "ALTER TABLE a ADD y INT"]);
  });

  it("dentro de um ALTER, ALTER, DROP, GRANT e REVOKE são cláusulas dele, e não separam; os outros comandos separam", () => {
    expect(count("ALTER TABLE t ADD COLUMN a INT\n\nALTER COLUMN b SET NOT NULL", db2)).toBe(1);
    expect(count("ALTER EXTENSION e\n\nDROP TABLE t", postgres)).toBe(1);
    expect(count("ALTER DEFAULT PRIVILEGES IN SCHEMA s\n\nGRANT SELECT ON TABLES TO u", postgres)).toBe(1);
    expect(count("ALTER TABLE a ADD x INT\n\nALTER TABLE b ADD y INT")).toBe(1);
    expect(texts("ALTER TABLE a ADD x INT\n\nSELECT * FROM a")).toEqual(["ALTER TABLE a ADD x INT", "SELECT * FROM a"]);
  });

  it("Informix: o LOCK MODE do CREATE TABLE não é o LOCK TABLE", () => {
    expect(count("CREATE TABLE t (a INT) IN dbs1\n\nLOCK MODE ROW", informix)).toBe(1);
    expect(count("SELECT 1 FROM t\n\nLOCK TABLE t IN EXCLUSIVE MODE", informix)).toBe(2);
  });

  it("COMMENT só começa comando com ON depois", () => {
    expect(count("SELECT 1 FROM t\n\nCOMMENT ON COLUMN t.a IS 'x'")).toBe(2);
    expect(count("SELECT id FROM t\n\ncomment")).toBe(1);
  });
});

describe("onde a linha em branco nunca separa (RN-SQL-018)", () => {
  it.each(engines)("dentro de texto entre aspas simples e de nome entre aspas duplas (banco %i)", (engine) => {
    expect(count("SELECT 'a\n\nSELECT b' FROM t", engine)).toBe(1);
    expect(count('SELECT "a\n\nSELECT" FROM t', engine)).toBe(1);
  });

  it.each(engines)("dentro de comentário de bloco, e o comentário sozinho não é comando (banco %i)", (engine) => {
    expect(count("SELECT 1 /*\n\nSELECT 2 */ FROM t", engine)).toBe(1);
    expect(texts("SELECT 1 FROM t\n\n-- SELECT 2 FROM t\n", engine)).toEqual(["SELECT 1 FROM t\n\n-- SELECT 2 FROM t"]);
  });

  it("Informix: dentro de { … }", () => {
    expect(count("SELECT 1 {\n\nSELECT 2 } FROM t", informix)).toBe(1);
  });

  it("PostgreSQL: dentro de $$ … $$ e de $fn$ … $fn$", () => {
    expect(count("CREATE FUNCTION f() RETURNS int AS $$\nSELECT 1\n\nSELECT 2\n$$ LANGUAGE sql", postgres)).toBe(1);
    expect(count("DO $fn$\nBEGIN\n\n  PERFORM 1;\n\nEND\n$fn$", postgres)).toBe(1);
  });

  it("Db2: no bloco a linha em branco não separa até o fim do texto, como na conta (CREATE PROCEDURE, FUNCTION, TRIGGER e BEGIN)", () => {
    const procedure = "CREATE PROCEDURE p ()\nBEGIN\n  SET x = (SELECT 1 FROM t)\n\n  INSERT INTO log VALUES (x);\nEND\n\nSELECT 2 FROM t";
    const trigger = "CREATE TRIGGER trg AFTER INSERT ON t\nREFERENCING NEW AS n\nFOR EACH ROW\n\nUPDATE x SET a = n.a";
    const compound = "BEGIN\n  DECLARE x INT DEFAULT 0\n\n  SELECT 1 FROM t;\nEND";

    // O `;` continua separando como antes (o bloco inteiro se executa selecionando-o); a linha em branco não acrescenta corte nenhum.
    for (const sql of [procedure, trigger, compound]) expect(texts(sql, db2), sql).toEqual(splitStatements(sql, db2).map((statement) => statement.text));
    expect(texts(procedure, db2)).toEqual(["CREATE PROCEDURE p ()\nBEGIN\n  SET x = (SELECT 1 FROM t)\n\n  INSERT INTO log VALUES (x)", "END\n\nSELECT 2 FROM t"]);
  });

  it("Db2: o BEGIN fora do começo do comando (depois de uma linha em branco, de um rótulo, num módulo) também segura o bloco até o fim do texto", () => {
    const blocks = [
      "SELECT COUNT(*) FROM log\n\nBEGIN\n  DECLARE n INT DEFAULT 0;\n  purge: LOOP\n\n    DELETE FROM log;\n    LEAVE purge;\n  END LOOP;\nEND",
      "SELECT 1 FROM t\n\nBEGIN\n  DECLARE n INT DEFAULT 0;\n  REPEAT\n\n    DELETE FROM t2 WHERE id = 1;\n    SET n = n + 1;\n  UNTIL n > 0 END REPEAT;\nEND",
      "lbl: BEGIN\n  DECLARE n INT DEFAULT 0;\n  REPEAT\n\n    DELETE FROM t2 WHERE id = 1;\n  UNTIL n > 0 END REPEAT;\nEND lbl",
      "SELECT 1 FROM t\n\nlbl: BEGIN\n  DECLARE n INT DEFAULT 0;\n  SET n = 1\n\n  DELETE FROM t2 WHERE id = n;\nEND lbl",
      "ALTER MODULE m ADD PROCEDURE p ()\nBEGIN\n  DECLARE n INT DEFAULT 0;\n  SET n = 1\n\n  DELETE FROM t WHERE id = n;\nEND",
    ];

    // Depois do BEGIN a linha em branco não corta nada: o `;` separa como antes, e o cursor no DELETE manda o trecho que mandaria com a preferência
    // desligada, que o banco recusa, e não o DELETE sozinho, que apagaria a tabela fora do laço.
    for (const sql of blocks) {
      expect(texts(sql, db2), sql).toEqual(splitStatements(sql, db2).map((statement) => statement.text));
      expect(at(sql.replace("DELETE", "§DELETE"), db2), sql).toBe(at(sql.replace("DELETE", "§DELETE"), db2, false));
    }
    expect(at(blocks[0].replace("DELETE", "§DELETE"), db2)).toBe("purge: LOOP\n\n    DELETE FROM log");

    // Antes do bloco a linha em branco continua separando.
    expect(texts("SELECT 1 FROM t\n\nSELECT 2 FROM t\n\nBEGIN\n  DECLARE n INT DEFAULT 0;\n  REPEAT\n\n    DELETE FROM t;\n  UNTIL n > 0 END REPEAT;\nEND", db2)).toEqual([
      "SELECT 1 FROM t",
      "SELECT 2 FROM t\n\nBEGIN\n  DECLARE n INT DEFAULT 0",
      "REPEAT\n\n    DELETE FROM t",
      "UNTIL n > 0 END REPEAT",
      "END",
    ]);
  });

  it("Db2: na dúvida, não separa: a coluna chamada BEGIN também segura as linhas em branco até o fim do texto; nos outros bancos, não", () => {
    expect(count("SELECT a AS begin FROM t\n\nSELECT 2 FROM t", db2)).toBe(1);
    expect(count("SELECT a AS begin FROM t\n\nSELECT 2 FROM t", postgres)).toBe(2);
    expect(count("SELECT a AS begin FROM t\n\nSELECT 2 FROM t", informix)).toBe(2);
  });

  it("Informix: na rotina a linha em branco não separa até o END PROCEDURE ou END FUNCTION; depois dele, volta a separar", () => {
    const sql = "CREATE PROCEDURE p ()\n  DEFINE x INT;\n  LET x = (SELECT COUNT(*) FROM t)\n\n  INSERT INTO log VALUES (x);\nEND PROCEDURE;\n\nSELECT * FROM t\n\nSELECT * FROM u";

    expect(texts(sql, informix)).toEqual(["CREATE PROCEDURE p ()\n  DEFINE x INT", "LET x = (SELECT COUNT(*) FROM t)\n\n  INSERT INTO log VALUES (x)", "END PROCEDURE", "SELECT * FROM t", "SELECT * FROM u"]);
    expect(count("CREATE FUNCTION f () RETURNING INT;\n  DEFINE x INT;\n  LET x = 1\n\n  INSERT INTO log VALUES (x);\n  RETURN x;\nEND FUNCTION", informix)).toBe(5);
  });

  it("PostgreSQL: no BEGIN ATOMIC … END a linha em branco não separa; depois do END, separa", () => {
    const sql = "CREATE FUNCTION f() RETURNS int LANGUAGE sql\nBEGIN ATOMIC\n  SELECT 1\n\n  SELECT 2;\nEND\n\nSELECT f()";

    expect(texts(sql, postgres)).toEqual(["CREATE FUNCTION f() RETURNS int LANGUAGE sql\nBEGIN ATOMIC\n  SELECT 1\n\n  SELECT 2", "END", "SELECT f()"]);
  });

  it.each([
    [postgres, "CREATE SCHEMA hollywood\n\nCREATE TABLE films (title text)\n\nCREATE VIEW winners AS SELECT title FROM films\n\nGRANT SELECT ON winners TO maria"],
    [db2, "CREATE SCHEMA s AUTHORIZATION u\n\nCREATE TABLE s.t (a INT)\n\nCOMMENT ON TABLE s.t IS 'x'\n\nGRANT SELECT ON s.t TO PUBLIC"],
    [informix, "CREATE SCHEMA AUTHORIZATION joao\n\nCREATE TABLE pedidos (id INT)\n\nCREATE INDEX ix ON pedidos (id)\n\nGRANT SELECT ON pedidos TO maria"],
  ])("CREATE SCHEMA com os objetos dele só acaba no `;`: separado, criaria o esquema sozinho e depois a tabela fora dele (banco %i)", (engine, schema) => {
    expect(texts(schema, engine)).toEqual([schema]);
    // O cursor no CREATE TABLE manda o esquema inteiro, e não só a tabela.
    expect(at(schema.replace("CREATE TABLE", "CREATE §TABLE"), engine)).toBe(schema);
    // Na dúvida, não separa: o que vem depois sem `;` vai junto, e o banco recusa o texto inteiro.
    expect(count("CREATE SCHEMA s\n\nSELECT 1 FROM t", engine)).toBe(1);
    // Depois do `;`, a linha em branco volta a separar.
    expect(texts(`${schema};\n\nSELECT 1 FROM t\n\nSELECT 2 FROM t`, engine)).toEqual([schema, "SELECT 1 FROM t", "SELECT 2 FROM t"]);
  });

  it("os outros comandos de esquema separam como sempre: DROP SCHEMA, ALTER SCHEMA e o CREATE SCHEMA que vem depois da linha em branco", () => {
    for (const engine of engines) {
      expect(texts("DROP SCHEMA s RESTRICT\n\nSELECT 1 FROM t", engine), String(engine)).toEqual(["DROP SCHEMA s RESTRICT", "SELECT 1 FROM t"]);
      expect(texts("SELECT 1 FROM t\n\nCREATE SCHEMA s", engine), String(engine)).toEqual(["SELECT 1 FROM t", "CREATE SCHEMA s"]);
    }
    expect(texts("ALTER SCHEMA s RENAME TO u\n\nSELECT 1 FROM t", postgres)).toEqual(["ALTER SCHEMA s RENAME TO u", "SELECT 1 FROM t"]);
  });

  it("CREATE TRIGGER do PostgreSQL e do Informix só acaba no `;`", () => {
    expect(count("CREATE TRIGGER trg AFTER INSERT ON t\nFOR EACH ROW\n\nEXECUTE FUNCTION f()", postgres)).toBe(1);
    expect(count("CREATE OR REPLACE CONSTRAINT TRIGGER trg AFTER\n\nINSERT ON t FOR EACH ROW EXECUTE FUNCTION f()", postgres)).toBe(1);
    expect(count("CREATE TRIGGER trg\n\nINSERT ON t FOR EACH ROW (INSERT INTO log VALUES (1))", informix)).toBe(1);
    expect(texts("CREATE TRIGGER trg INSERT ON t FOR EACH ROW (INSERT INTO log VALUES (1));\n\nSELECT 1 FROM t\n\nSELECT 2 FROM t", informix)).toHaveLength(3);
  });
});

describe("o cursor numa linha em branco que separou executa o comando de cima, como no DBeaver (RN-SQL-018)", () => {
  it.each(engines)("na linha que separa, com ou sem espaços, e em qualquer uma de várias linhas em branco, é o de cima (banco %i)", (engine) => {
    expect(at("SELECT 1 FROM t\n§\nSELECT 2 FROM t", engine)).toBe("SELECT 1 FROM t");
    expect(at("SELECT 1 FROM t\n  §\t\nSELECT 2 FROM t", engine)).toBe("SELECT 1 FROM t");
    expect(at("SELECT 1 FROM t\n\n\n§\n\nSELECT 2 FROM t", engine)).toBe("SELECT 1 FROM t");
    expect(at("SELECT 1 FROM t\r\n§\r\nSELECT 2 FROM t", engine)).toBe("SELECT 1 FROM t");
  });

  it("entre o comentário solto e o comando de baixo também é o de cima", () => {
    expect(at("SELECT 1\n\n-- solto\n§\nSELECT 2")).toBe("SELECT 1");
    expect(at("SELECT 1\n§\n-- solto\n\nSELECT 2")).toBe("SELECT 1");
  });

  it("na linha em branco que só separou do comando de baixo o comentário de cima, sem comando acima, nada: o executor diz que não há comando", () => {
    expect(at("-- título\n§\nSELECT 1")).toBeNull();
    expect(at("/* título */\n\n§\nSELECT 1", informix)).toBeNull();
    expect(at("/* título */\n§\n\nSELECT 1", informix)).toBeNull();
  });

  it.each(engines)("na linha em branco do começo do texto, sem nada acima, nada também abaixo: nem o DELETE de baixo vai (banco %i)", (engine) => {
    expect(at("§\n\nSELECT 1", engine)).toBeNull();
    expect(at("\n§\nSELECT 1", engine)).toBeNull();
    expect(at("  §\t\n\nSELECT 1", engine)).toBeNull();
    expect(at("§\nSELECT 1;", engine)).toBeNull();
    expect(at("§\n-- título\n\nSELECT 1", engine)).toBeNull();
    expect(at("-- título\n\n-- do DELETE\n§\nDELETE FROM t WHERE id = 1;", engine)).toBeNull();
    expect(at("§\n\nDELETE FROM t\n\nWHERE id = 1", engine)).toBeNull();
    // Na linha do comando, logo depois das linhas em branco, é ele.
    expect(at("\n\n§SELECT 1", engine)).toBe("SELECT 1");
    // Com a preferência desligada, vale a resposta de antes: o comando seguinte.
    expect(at("§\n\nDELETE FROM t WHERE id = 1;", engine, false)).toBe("DELETE FROM t WHERE id = 1");
  });

  it("depois do último comando, é o último, como antes", () => {
    expect(at("SELECT 1;\n\nSELECT 2;\n\n§")).toBe("SELECT 2");
    expect(at("SELECT 1\n\nSELECT 2\n§")).toBe("SELECT 2");
  });

  it("a linha em branco dentro de um comando que não se separou é dele", () => {
    expect(at("DELETE FROM t\n§\nWHERE id = 1")).toBe("DELETE FROM t\n\nWHERE id = 1");
    expect(at("SELECT 'a\n§\nb' FROM t\n\nSELECT 2")).toBe("SELECT 'a\n\nb' FROM t");
  });

  it("na linha do comentário solto, fora da linha em branco, vale a regra de antes: o comando seguinte", () => {
    expect(at("SELECT 1\n\n-- sol§to\n\nSELECT 2")).toBe("SELECT 2");
  });
});

describe("o `;` continua como antes, com a linha em branco ligada (RN-SQL-002 e RN-SQL-018)", () => {
  it("o cursor na linha em branco depois de um `;` fica com o comando seguinte, como antes, e não executa de novo o de cima", () => {
    expect(at("DELETE FROM t WHERE id = 1;\n§\nSELECT * FROM t;")).toBe("SELECT * FROM t");
    expect(at("SELECT 1;\n§\nSELECT 2")).toBe("SELECT 2");
    expect(at("SELECT 1;\n\n\n§\n\nSELECT 2;")).toBe("SELECT 2");
    // O comentário solto depois do `;` não muda a resposta: o de cima terminou no `;`.
    expect(at("SELECT 1;\n\n-- solto\n§\nSELECT 2;")).toBe("SELECT 2");
    expect(at("SELECT 1 FROM t\n\nSELECT 2 FROM t;\n§\nSELECT 3 FROM t")).toBe("SELECT 3 FROM t");
  });

  // Onde a linha em branco não corta nada, em nenhuma posição do cursor a resposta muda com a preferência: o mesmo texto e o mesmo lugar. A exceção
  // são as linhas em branco do começo do texto, que com a preferência não executam nada (o teste acima); por isso os textos daqui não começam por elas.
  it.each([
    [postgres, "DELETE FROM t WHERE id = 1;\n\nSELECT * FROM t;"],
    [postgres, "SELECT 1;\n  \n\nSELECT 2;\n\n"],
    [postgres, "SELECT 1;\n\t\nSELECT 2\n"],
    [informix, "UPDATE t SET a = 1;\n\nDELETE FROM t;\n"],
    [db2, "CREATE PROCEDURE p ()\nBEGIN\n  SET x = 1;\n\n  SET y = 2;\nEND;\n\nSELECT 1 FROM t;"],
    [db2, "BEGIN\n  DECLARE x INT DEFAULT 0;\n\n  SET x = 1;\nEND"],
    [db2, "SELECT COUNT(*) FROM log\n\nBEGIN\n  DECLARE n INT DEFAULT 0;\n  purge: LOOP\n\n    DELETE FROM log;\n    LEAVE purge;\n  END LOOP;\nEND"],
    [informix, "CREATE PROCEDURE p ()\n  DEFINE x INT;\n\n  LET x = 1;\nEND PROCEDURE;\n\nSELECT 1 FROM t;"],
  ])("sem corte da linha em branco, o comando do cursor é o de antes em todas as posições (banco %i: %j)", (engine, sql) => {
    for (let offset = 0; offset <= sql.length; offset++) {
      expect(statementAt(sql, offset, engine, { blankLines: true }), `posição ${offset}`).toEqual(statementAt(sql, offset, engine, { blankLines: false }));
    }
  });

  it("as respostas do comando do cursor sem linha em branco não mudam", () => {
    const sql = "select 1; select 2";
    expect(at("select 1; select §2")).toBe("select 2");
    expect(at("select 1;§ select 2")).toBe("select 1");
    expect(at("select 1; §select 2")).toBe("select 2");
    expect(at("select 1;§select 2")).toBe("select 1");
    expect(at("select 1; select 2;  \n §")).toBe("select 2");
    expect(at("select 1;\nselect 2; -- conferido§")).toBe("select 2");
    expect(at("select 'a;§b' from t; select 2")).toBe("select 'a;b' from t");
    expect(statementAt("", 0, postgres, { blankLines: true })).toBeNull();
    expect(statementAt(" ; ;\n", 3, postgres, { blankLines: true })).toBeNull();
    for (const engine of engines) expect(texts(sql, engine)).toEqual(["select 1", "select 2"]);
  });

  it("o `;` separa também onde a linha em branco não separaria", () => {
    expect(texts("DELETE FROM t;\n\nWHERE id = 1")).toEqual(["DELETE FROM t", "WHERE id = 1"]);
    expect(texts("SELECT 1, 2;\nSELECT 3")).toEqual(["SELECT 1, 2", "SELECT 3"]);
  });

  it("com a linha em branco desligada, nada muda: dois SELECT separados só pela linha em branco vão juntos, e o cursor na linha em branco fica com o de baixo", () => {
    const sql = "SELECT 1 FROM t\n\nSELECT 2 FROM t";

    expect(splitStatements(sql)).toHaveLength(1);
    expect(splitStatements(sql, db2, { blankLines: false })).toHaveLength(1);
    expect(at("SELECT 1 FROM t\n\nSELECT §2 FROM t", postgres, false)).toBe(sql);
    expect(at("SELECT 1;\n§\nSELECT 2", postgres, false)).toBe("SELECT 2");
    expect(at("§\n\nSELECT 1", postgres, false)).toBe("SELECT 1");
  });

  it("a conta da seleção continua só pelo `;`: a linha em branco não divide a seleção (RN-SQL-001)", () => {
    for (const engine of engines) {
      expect(statementCount("SELECT 1 FROM t\n\nSELECT 2 FROM t", engine)).toBe(1);
      expect(statementCount("SELECT 1 FROM t;\n\nSELECT 2 FROM t", engine)).toBe(2);
    }
  });

  it("o comando que a linha em branco separou é um comando só para o executor", () => {
    const sql = "SELECT 1 FROM t\n\nSELECT 2 FROM t\n\nUPDATE t SET a = 1\n\nWHERE b = 2";
    for (const engine of engines) for (const statement of texts(sql, engine)) expect(statementCount(statement, engine), statement).toBe(1);
  });

  it("texto de 1 MB com linhas em branco separa sem custo quadrático", () => {
    const line = "select id, nome, 'a;b' as texto, \"col;x\" from producao.apontamento\nwhere id = 42 -- comentário; aqui\n\n";
    const sql = line.repeat(Math.ceil((1024 * 1024) / line.length));

    const startedAt = performance.now();
    const statements = splitStatements(sql, postgres, { blankLines: true });
    const elapsed = performance.now() - startedAt;

    expect(statements).toHaveLength(sql.length / line.length);
    // Folgado de propósito (a máquina pode estar ocupada): o que ele pega é a leitura que volta ao começo a cada linha em branco.
    expect(elapsed).toBeLessThan(2000);
  });
});
