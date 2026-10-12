import { describe, expect, it } from "vitest";

import type { Column, ForeignKey, TableIndex } from "./database-sessions.schema";
import { approximateDdl, ddlState } from "./table-ddl";
import { workbenchCopy } from "./workbench.copy";

const warning = `-- ${workbenchCopy.tableTab.structure.ddl.warning}`;

const column = (name: string, position: number, over: Partial<Column> = {}): Column => ({ name, type: "bigint", isNullable: false, isPrimaryKey: false, position, ...over });
const fk = (name: string, columns: string[], referencedTable: string, referencedColumns: string[], referencedSchema = "producao"): ForeignKey => ({ name, columns, referencedSchema, referencedTable, referencedColumns });
const index = (name: string, columns: string[], isUnique = false): TableIndex => ({ name, columns, isUnique });

const apontamento = {
  engine: 1 as const,
  kind: "table" as const,
  schema: "producao",
  name: "apontamento",
  columns: [column("id", 1, { isPrimaryKey: true }), column("ordem_id", 2), column("quantidade", 3, { type: "numeric(12,3)", isNullable: true }), column("observacao", 4, { type: "character varying(80)", isNullable: true })],
  foreignKeys: [fk("fk_apontamento_ordem", ["ordem_id"], "ordem_producao", ["id"])],
  indexes: [index("pk_apontamento", ["id"], true), index("ix_apontamento_ordem", ["ordem_id"])],
};

describe("approximateDdl: o DDL aproximado de uma tabela (RN-TABELA-008)", () => {
  it("o CREATE TABLE com as colunas, o nulo, a chave primária e as chaves estrangeiras, e os índices depois", () => {
    expect(approximateDdl(apontamento)).toBe(
      [
        warning,
        'CREATE TABLE "producao"."apontamento" (',
        '  "id" bigint NOT NULL,',
        '  "ordem_id" bigint NOT NULL,',
        '  "quantidade" numeric(12,3),',
        '  "observacao" character varying(80),',
        '  PRIMARY KEY ("id"),',
        '  CONSTRAINT "fk_apontamento_ordem" FOREIGN KEY ("ordem_id") REFERENCES "producao"."ordem_producao" ("id")',
        ");",
        "",
        'CREATE INDEX "ix_apontamento_ordem" ON "producao"."apontamento" ("ordem_id");',
      ].join("\n"),
    );
  });

  it("a primeira linha é o aviso: a cópia não é tomada pelo DDL do banco", () => {
    expect(approximateDdl(apontamento)?.split("\n")[0]).toBe(warning);
    expect(warning).toContain("não é o DDL do banco");
  });

  it("as colunas saem na ordem da posição, qualquer que seja a ordem em que a API as devolveu", () => {
    const ddl = approximateDdl({ ...apontamento, columns: [...apontamento.columns].reverse() }) ?? "";

    expect(ddl.indexOf('"id" bigint')).toBeLessThan(ddl.indexOf('"ordem_id"'));
    expect(ddl.indexOf('"ordem_id"')).toBeLessThan(ddl.indexOf('"observacao"'));
  });

  it("a chave primária composta lista as colunas na ordem da posição", () => {
    const ddl = approximateDdl({ ...apontamento, columns: [column("b", 2, { isPrimaryKey: true }), column("a", 1, { isPrimaryKey: true }), column("c", 3)], foreignKeys: [], indexes: [] }) ?? "";

    expect(ddl).toContain('  PRIMARY KEY ("a", "b")');
  });

  it("sem chave primária, sem a cláusula; sem chaves estrangeiras e sem índices, só as colunas", () => {
    const ddl = approximateDdl({ ...apontamento, columns: [column("a", 1), column("b", 2, { isNullable: true })], foreignKeys: [], indexes: [] });

    expect(ddl).toBe([warning, 'CREATE TABLE "producao"."apontamento" (', '  "a" bigint NOT NULL,', '  "b" bigint', ");"].join("\n"));
  });

  it("o índice único das mesmas colunas da chave primária é o dela e não se repete; o outro único, sim, como UNIQUE", () => {
    const ddl = approximateDdl({ ...apontamento, indexes: [index("pk_apontamento", ["id"], true), index("uq_ordem", ["ordem_id"], true), index("ix_composto", ["id", "ordem_id"])] }) ?? "";

    expect(ddl).not.toContain("pk_apontamento");
    expect(ddl).toContain('CREATE UNIQUE INDEX "uq_ordem" ON "producao"."apontamento" ("ordem_id");');
    expect(ddl).toContain('CREATE INDEX "ix_composto" ON "producao"."apontamento" ("id", "ordem_id");');
  });

  it("um índice comum das colunas da chave primária não é o da chave: fica", () => {
    expect(approximateDdl({ ...apontamento, indexes: [index("ix_id", ["id"])] })).toContain('CREATE INDEX "ix_id"');
  });

  it("chave estrangeira composta: as colunas de cada lado, na ordem", () => {
    const ddl = approximateDdl({ ...apontamento, foreignKeys: [fk("fk_c", ["ordem_id", "id"], "agenda", ["ordem", "maquina"], "cadastro")] }) ?? "";

    expect(ddl).toContain('CONSTRAINT "fk_c" FOREIGN KEY ("ordem_id", "id") REFERENCES "cadastro"."agenda" ("ordem", "maquina")');
  });

  it("no Informix o nome da restrição vem depois da definição; no PostgreSQL e no Db2, antes", () => {
    const clause = (engine: 1 | 2 | 3) => (approximateDdl({ ...apontamento, engine })?.split("\n").find((line) => line.includes("FOREIGN KEY")) ?? "").trim();

    expect(clause(1)).toBe('CONSTRAINT "fk_apontamento_ordem" FOREIGN KEY ("ordem_id") REFERENCES "producao"."ordem_producao" ("id")');
    expect(clause(2)).toBe(clause(1));
    expect(clause(3)).toBe('FOREIGN KEY ("ordem_id") REFERENCES "producao"."ordem_producao" ("id") CONSTRAINT "fk_apontamento_ordem"');
  });

  it("os nomes hostis ficam inteiros entre aspas duplas, com a aspa dobrada: nada vira outro comando nem comentário", () => {
    const ddl =
      approximateDdl({
        engine: 1,
        kind: "table",
        schema: 'es"q',
        name: "t; DROP TABLE x; --",
        columns: [column('c"1', 1, { isPrimaryKey: true }), column("/* c */", 2, { isNullable: true })],
        foreignKeys: [fk('f"k', ['c"1'], "{ r }", ["a b"], 'o"utro')],
        indexes: [index("i;x", ["/* c */"])],
      }) ?? "";

    expect(ddl).toContain('CREATE TABLE "es""q"."t; DROP TABLE x; --" (');
    expect(ddl).toContain('"c""1" bigint NOT NULL');
    expect(ddl).toContain('"/* c */" bigint');
    expect(ddl).toContain('CONSTRAINT "f""k" FOREIGN KEY ("c""1") REFERENCES "o""utro"."{ r }" ("a b")');
    expect(ddl).toContain('CREATE INDEX "i;x" ON "es""q"."t; DROP TABLE x; --" ("/* c */");');
  });

  it("o tipo entra como o catálogo o escreve (o nome de um tipo do usuário já vem entre aspas dele)", () => {
    const ddl = approximateDdl({ ...apontamento, columns: [column("a", 1, { type: '"Meu Tipo"' }), column("b", 2, { type: "timestamp with time zone" }), column("c", 3, { type: "" })] }) ?? "";

    expect(ddl).toContain('"a" "Meu Tipo" NOT NULL');
    expect(ddl).toContain('"b" timestamp with time zone NOT NULL');
    expect(ddl).toContain('  "c" NOT NULL');
  });

  it("sem colunas não há o que montar", () => {
    expect(approximateDdl({ ...apontamento, columns: [] })).toBeNull();
  });

  it("um índice sem colunas (a API não o descreveu) não vira comando", () => {
    expect(approximateDdl({ ...apontamento, indexes: [index("vazio", [])] })).not.toContain("vazio");
  });
});

describe("approximateDdl: o tipo do objeto que a árvore sabe (tabela, visão ou nenhum dos dois)", () => {
  it("sem saber o tipo, o texto diz que pode ser uma visão, logo depois do aviso", () => {
    const lines = (approximateDdl({ ...apontamento, kind: "unknown" }) ?? "").split("\n");

    expect(lines[0]).toBe(warning);
    expect(lines[1]).toBe(`-- ${workbenchCopy.tableTab.structure.ddl.unknownLine}`);
    expect(lines[1]).toContain("visão");
    expect(lines[2]).toBe('CREATE TABLE "producao"."apontamento" (');
  });

  it("sabendo que é tabela, o texto é o de sempre, sem a linha do tipo", () => {
    expect(approximateDdl({ ...apontamento, kind: "table" })).not.toContain(workbenchCopy.tableTab.structure.ddl.unknownLine);
  });

  it("uma visão não tem CREATE TABLE: o Prism não monta o DDL de visões", () => {
    expect(approximateDdl({ ...apontamento, kind: "view" })).toBeNull();
  });
});

describe("ddlState: o que a seção DDL mostra", () => {
  const loaded = { engine: apontamento.engine, schema: apontamento.schema, name: apontamento.name, columns: apontamento.columns, foreignKeys: apontamento.foreignKeys, indexes: apontamento.indexes };

  it("uma visão diz que o Prism não monta o DDL de visões, mesmo antes de as listas chegarem", () => {
    expect(ddlState({ ...loaded, kind: "view" })).toEqual({ kind: "view" });
    expect(ddlState({ ...loaded, kind: "view", columns: undefined, foreignKeys: undefined, indexes: undefined })).toEqual({ kind: "view" });
  });

  it("uma tabela, com as três listas na mão: o texto", () => {
    const state = ddlState({ ...loaded, kind: "table" });

    expect(state).toMatchObject({ kind: "ready", maybeView: false });
    expect(state.kind === "ready" && state.text).toBe(approximateDdl({ ...apontamento, kind: "table" }));
  });

  it("sem saber o tipo: o texto sai, marcado como possível visão", () => {
    const state = ddlState({ ...loaded, kind: "unknown" });

    expect(state).toMatchObject({ kind: "ready", maybeView: true });
    expect(state.kind === "ready" && state.text).toContain(workbenchCopy.tableTab.structure.ddl.unknownLine);
  });

  it("enquanto alguma das três listas não chegou, ou o banco da conexão não é conhecido, ainda carrega", () => {
    expect(ddlState({ ...loaded, kind: "table", columns: undefined })).toEqual({ kind: "loading" });
    expect(ddlState({ ...loaded, kind: "table", foreignKeys: undefined })).toEqual({ kind: "loading" });
    expect(ddlState({ ...loaded, kind: "table", indexes: undefined })).toEqual({ kind: "loading" });
    expect(ddlState({ ...loaded, kind: "unknown", engine: undefined })).toEqual({ kind: "loading" });
  });

  it("uma tabela sem colunas não tem o que montar", () => {
    expect(ddlState({ ...loaded, kind: "table", columns: [] })).toEqual({ kind: "empty" });
  });
});
