import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { irreversibleOf } from "./irreversible";

const engines: [string, Engine][] = [
  ["PostgreSQL", 1],
  ["Db2", 2],
  ["Informix", 3],
];

describe.each(engines)("irreversibleOf no %s (RN-PROT-001)", (_, engine) => {
  it.each([
    ["DROP TABLE producao.apontamento", { kind: "drop", target: "producao.apontamento" }],
    ["drop view if exists v_turno", { kind: "drop", target: "v_turno" }],
    ["DROP INDEX ix_apontamento_data", { kind: "drop", target: "ix_apontamento_data" }],
    ['DROP TABLE "Produção"."Apontamento"', { kind: "drop", target: '"Produção"."Apontamento"' }],
    ["TRUNCATE TABLE producao.apontamento", { kind: "truncate", target: "producao.apontamento" }],
    ["truncate apontamento", { kind: "truncate", target: "apontamento" }],
    ["ALTER TABLE producao.apontamento DROP COLUMN turno", { kind: "alterDrop", target: "producao.apontamento" }],
    ["ALTER TABLE apontamento DROP CONSTRAINT fk_ordem", { kind: "alterDrop", target: "apontamento" }],
    ["DELETE FROM producao.apontamento", { kind: "delete", target: "producao.apontamento" }],
    ["DELETE FROM apontamento;", { kind: "delete", target: "apontamento" }],
    ["UPDATE producao.apontamento SET turno = 2", { kind: "update", target: "producao.apontamento" }],
    // O WHERE da subconsulta não é o do UPDATE: ele altera todas as linhas.
    ["UPDATE ordem SET total = (SELECT SUM(qtd) FROM apontamento a WHERE a.ordem = ordem.id)", { kind: "update", target: "ordem" }],
    ["DELETE FROM ordem WHERE 1 = 1 OR id IN (SELECT ordem FROM apontamento)", null],
    // Depois de um WITH, o comando principal.
    ["WITH velhas AS (SELECT id FROM ordem WHERE criada < CURRENT DATE) DELETE FROM apontamento", { kind: "delete", target: "apontamento" }],
    ["WITH velhas AS (SELECT id FROM ordem) DELETE FROM apontamento WHERE ordem IN (SELECT id FROM velhas)", null],
  ] as const)("%s", (sql, expected) => {
    expect(irreversibleOf(sql, engine)).toEqual(expected);
  });

  it.each([
    "SELECT * FROM apontamento",
    "DELETE FROM apontamento WHERE id = 7",
    "UPDATE apontamento SET turno = 2 WHERE id = 7",
    "INSERT INTO apontamento (id, turno) VALUES (1, 2)",
    "ALTER TABLE apontamento ADD COLUMN turno INT",
    "CREATE TABLE apontamento (id INT)",
    "SELECT * FROM apontamento FOR UPDATE",
    "GRANT SELECT, UPDATE ON apontamento TO leitor",
    // O texto, o nome entre aspas e o comentário não contam.
    "SELECT 'DROP TABLE apontamento' FROM ordem",
    'SELECT "delete" FROM ordem',
    "-- DELETE FROM apontamento\nSELECT 1 FROM ordem",
    "/* TRUNCATE apontamento */ SELECT 1 FROM ordem",
    "",
    "   ",
  ])("não é irreversível: %s", (sql) => {
    expect(irreversibleOf(sql, engine)).toBeNull();
  });

  it("criar uma rotina não executa o corpo dela: o DELETE de dentro não conta", () => {
    expect(irreversibleOf("CREATE PROCEDURE limpar() DELETE FROM apontamento; END PROCEDURE", engine)).toBeNull();
  });

  it("na dúvida, pergunta: uma coluna chamada update sem aspas, logo depois do parêntese, conta como o começo de um UPDATE", () => {
    expect(irreversibleOf("INSERT INTO ordem (update) VALUES (1)", engine)?.kind).toBe("update");
  });
});

describe("o que só um banco tem", () => {
  it("PostgreSQL: o $tag$ não conta, e o EXPLAIN sem ANALYZE só planeja; com ANALYZE, executa o comando", () => {
    expect(irreversibleOf("SELECT $$DROP TABLE apontamento$$", 1)).toBeNull();
    expect(irreversibleOf("EXPLAIN DELETE FROM apontamento", 1)).toBeNull();
    expect(irreversibleOf("EXPLAIN ANALYZE DELETE FROM apontamento", 1)).toEqual({ kind: "delete", target: "apontamento" });
    expect(irreversibleOf("EXPLAIN (ANALYZE, BUFFERS) UPDATE apontamento SET turno = 1", 1)).toEqual({ kind: "update", target: "apontamento" });
  });

  it("PostgreSQL: o DELETE de dentro do WITH, o ONLY e o DROP MATERIALIZED VIEW; o ON CONFLICT DO UPDATE não começa um comando", () => {
    expect(irreversibleOf("WITH apagadas AS (DELETE FROM apontamento RETURNING *) SELECT count(*) FROM apagadas", 1)).toEqual({ kind: "delete", target: "apontamento" });
    expect(irreversibleOf("WITH apagadas AS (DELETE FROM apontamento WHERE turno = 3 RETURNING *) SELECT count(*) FROM apagadas", 1)).toBeNull();
    expect(irreversibleOf("DELETE FROM ONLY producao.apontamento", 1)).toEqual({ kind: "delete", target: "producao.apontamento" });
    expect(irreversibleOf("DROP MATERIALIZED VIEW IF EXISTS mv_turno", 1)).toEqual({ kind: "drop", target: "mv_turno" });
    expect(irreversibleOf("INSERT INTO turno (id, nome) VALUES (1, 'A') ON CONFLICT (id) DO UPDATE SET nome = 'A'", 1)).toBeNull();
  });

  it("PostgreSQL: o comentário aninhado esconde o comando inteiro", () => {
    expect(irreversibleOf("/* um /* dois */ DROP TABLE apontamento */ SELECT 1", 1)).toBeNull();
  });

  it("Db2: o UPDATE dentro do FINAL TABLE e o DELETE de um bloco BEGIN ... END", () => {
    expect(irreversibleOf("SELECT * FROM FINAL TABLE (UPDATE apontamento SET turno = 2)", 2)).toEqual({ kind: "update", target: "apontamento" });
    expect(irreversibleOf("SELECT * FROM FINAL TABLE (UPDATE apontamento SET turno = 2 WHERE id = 1)", 2)).toBeNull();
    expect(irreversibleOf("BEGIN\n  DELETE FROM apontamento;\nEND", 2)).toEqual({ kind: "delete", target: "apontamento" });
    expect(irreversibleOf("BEGIN ATOMIC\n  UPDATE ordem SET total = 0 WHERE id = 1;\n  DROP TABLE tmp_ordem;\nEND", 2)).toEqual({ kind: "drop", target: "tmp_ordem" });
  });

  it("Db2: o comentário aninhado esconde o comando, e o EXPLAIN PLAN FOR não executa nada", () => {
    expect(irreversibleOf("/* um /* dois */ DELETE FROM apontamento */ VALUES 1", 2)).toBeNull();
    expect(irreversibleOf("EXPLAIN PLAN FOR DELETE FROM apontamento", 2)).toBeNull();
  });

  it("Informix: o comentário entre chaves não conta, o DELETE sem FROM é um DELETE, e o UPDATE STATISTICS não é um UPDATE", () => {
    expect(irreversibleOf("{ DROP TABLE apontamento } SELECT 1 FROM systables WHERE tabid = 1", 3)).toBeNull();
    expect(irreversibleOf("DELETE apontamento", 3)).toEqual({ kind: "delete", target: "apontamento" });
    expect(irreversibleOf("UPDATE STATISTICS FOR TABLE apontamento", 3)).toBeNull();
    expect(irreversibleOf("DELETE FROM apontamento WHERE CURRENT OF c_apontamento", 3)).toBeNull();
  });

  it("no Informix o primeiro fecho encerra o comentário de bloco: o que vem depois dele é comando", () => {
    expect(irreversibleOf("/* um /* dois */ DELETE FROM apontamento", 3)).toEqual({ kind: "delete", target: "apontamento" });
  });
});
