import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { scriptStatements, statementCount } from "./sql-statements";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const texts = (sql: string, engine?: Engine, blankLines = false) => scriptStatements(sql, engine, { blankLines }).map((statement) => statement.text);

// O "Executar script" (RN-SQL-019) divide o texto pelas regras do Ctrl+Enter, com o mesmo leitor (`scan`), e o bloco com `;` no corpo continua um
// comando só, pela conta de `statementCount` (a mesma da API): cada pedaço daqui é um comando que a API aceita sozinho.
describe("scriptStatements: os comandos do script (RN-SQL-019)", () => {
  it("divide pelo `;`, sem os espaços em volta nem o `;`, e diz onde cada comando está no texto", () => {
    const sql = "select 1;\nselect 2;  \n";

    expect(scriptStatements(sql)).toEqual([
      { text: "select 1", start: 0, end: 8 },
      { text: "select 2", start: 10, end: 18 },
    ]);
  });

  it("o trecho vazio, o de `;` soltos e o só de comentários não é comando", () => {
    expect(texts(";;\n-- só um comentário\n;select 1; /* nada */ ;\n-- fim")).toEqual(["select 1"]);
    expect(texts("")).toEqual([]);
    expect(texts("-- nada; aqui\n/* nem; aqui */")).toEqual([]);
  });

  it("o comentário logo acima do comando vai com ele, como no Ctrl+Enter", () => {
    expect(texts("-- cria\ncreate table t (a int);\n-- lê\nselect * from t")).toEqual(["-- cria\ncreate table t (a int)", "-- lê\nselect * from t"]);
  });

  it("um comando só também é script: um pedaço", () => {
    expect(texts("select * from pedido")).toEqual(["select * from pedido"]);
  });

  it("com a preferência, a linha em branco separa nas condições da RN-SQL-018; sem ela, só o `;`", () => {
    const sql = "SELECT 1 FROM t\n\nSELECT 2 FROM t\n\nDELETE FROM t\n\nWHERE id = 1";

    expect(texts(sql, postgres, true)).toEqual(["SELECT 1 FROM t", "SELECT 2 FROM t", "DELETE FROM t\n\nWHERE id = 1"]);
    expect(texts(sql, postgres, false)).toEqual([sql]);
  });

  it("o `;` e a linha em branco juntos: cada um separa onde separa", () => {
    expect(texts("INSERT INTO t (a)\n\nSELECT a FROM s;\nUPDATE t SET a = 1\n\nSELECT * FROM t", postgres, true)).toEqual(["INSERT INTO t (a)\n\nSELECT a FROM s", "UPDATE t SET a = 1", "SELECT * FROM t"]);
  });

  it("o CREATE SCHEMA com os objetos dele é um comando só, também com a linha em branco entre eles", () => {
    const schema = "CREATE SCHEMA loja\n\nCREATE TABLE loja.t (a int)\n\nGRANT SELECT ON loja.t TO leitor";

    expect(texts(`${schema};\n\nSELECT 1`, postgres, true)).toEqual([schema, "SELECT 1"]);
  });

  describe("o bloco com `;` no corpo é um comando só (RN-SQL-001)", () => {
    it("PostgreSQL: CREATE FUNCTION com BEGIN ATOMIC … END, e o corpo entre `$$`", () => {
      const atomic = "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END";
      const dollar = "create function g() returns int as $$ select 1; $$ language sql";

      expect(texts(`${atomic};\nSELECT 3;\n${dollar};`, postgres)).toEqual([atomic, "SELECT 3", dollar]);
    });

    it("Db2: o procedimento depois de um comando comum é outro comando; o bloco vai até o fim do texto", () => {
      const procedure = "CREATE PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END";

      expect(texts(`UPDATE t SET a = 0; ${procedure}`, db2)).toEqual(["UPDATE t SET a = 0", procedure]);
      // A mesma conta da API: o que vem depois do bloco vai junto, e o banco recusa sem executar nada.
      expect(texts("BEGIN UPDATE t SET a = 1; END; UPDATE t SET a = 2", db2)).toEqual(["BEGIN UPDATE t SET a = 1; END; UPDATE t SET a = 2"]);
    });

    it("Db2, com a linha em branco: o corte antes do procedimento vale, e dentro dele nada separa", () => {
      const procedure = "CREATE PROCEDURE p () BEGIN\n  UPDATE t SET a = 1;\n\n  UPDATE t SET a = 2;\nEND";

      expect(texts(`SELECT 1 FROM t\n\n${procedure}`, db2, true)).toEqual(["SELECT 1 FROM t", procedure]);
    });

    it("Informix: a rotina vai até o END PROCEDURE, e depois o `;` volta a separar; sem o fim, todo `;` separa", () => {
      const routine = "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE";

      expect(texts(`${routine}; DROP TABLE x`, informix)).toEqual([routine, "DROP TABLE x"]);
      expect(texts("CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; UPDATE t SET a = 3", informix)).toEqual(["CREATE PROCEDURE p () UPDATE t SET a = 1", "UPDATE t SET a = 2", "UPDATE t SET a = 3"]);
    });

    it("o `BEGIN` fora de rotina não é bloco no PostgreSQL e no Informix: cada `;` separa", () => {
      expect(texts("BEGIN; UPDATE t SET a = 1; COMMIT", postgres)).toEqual(["BEGIN", "UPDATE t SET a = 1", "COMMIT"]);
      expect(texts("BEGIN WORK; UPDATE t SET a = 1; COMMIT WORK", informix)).toEqual(["BEGIN WORK", "UPDATE t SET a = 1", "COMMIT WORK"]);
    });
  });

  // A garantia que importa: o script manda à API só pedaços que ela aceita como um comando (`statementCount` é a conta dela), e o número de pedaços é
  // a conta do texto inteiro. Nos três bancos, com textos dos testes de `statementCount`.
  describe("cada pedaço é um comando para a API, e o texto inteiro dá a conta dela", () => {
    const samples = [
      "UPDATE t SET a = 1; UPDATE t SET a = 2",
      "UPDATE t SET a = 1 WHERE b = 'x;y'; UPDATE t SET a = 2 -- fim; aqui",
      ";;UPDATE t SET a = 1; /* ; */ UPDATE t SET a = 2;;",
      "SELECT 'a; UPDATE t SET a = 2' FROM t; SELECT 1 AS \"b;c\" FROM t",
      "UPDATE t SET a = 1; CREATE PROCEDURE p () UPDATE t SET a = 2; UPDATE t SET a = 3; END PROCEDURE; SELECT 1",
      "UPDATE t SET a = 1; CREATE PROCEDURE p () LANGUAGE SQL BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT case when true then 1 end; SELECT 2; END; SELECT 3; SELECT 4",
      "CREATE TRIGGER g AFTER INSERT ON t FOR EACH ROW BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END",
      "CREATE PROCEDURE a () SELECT 1; SELECT 2; END PROCEDURE; CREATE PROCEDURE b () UPDATE t SET a = 1; UPDATE t SET a = 2;",
      "UPDATE t SET a = 1 { ; UPDATE t SET a = 2 ; }; SELECT 1",
      "bloco: BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END bloco",
      "create function g() returns int as $f$ begin return 1; end; $f$ language plpgsql; select 2",
    ];

    it.each(samples.flatMap((sql) => [postgres, db2, informix].map((engine) => [engine, sql] as const)))("banco %i: %j", (engine, sql) => {
      const pieces = scriptStatements(sql, engine);

      expect(pieces).toHaveLength(statementCount(sql, engine));
      for (const piece of pieces) {
        expect(statementCount(piece.text, engine)).toBe(1);
        expect(sql.slice(piece.start, piece.end)).toBe(piece.text);
      }
    });

    it.each(samples.flatMap((sql) => [postgres, db2, informix].map((engine) => [engine, sql.replaceAll("; ", ";\n\n")] as const)))("com a linha em branco, banco %i: %j", (engine, sql) => {
      const pieces = scriptStatements(sql, engine, { blankLines: true });

      for (const [index, piece] of pieces.entries()) {
        expect(statementCount(piece.text, engine)).toBe(1);
        expect(sql.slice(piece.start, piece.end)).toBe(piece.text);
        if (index > 0) expect(piece.start).toBeGreaterThanOrEqual(pieces[index - 1].end);
      }
    });
  });
});
