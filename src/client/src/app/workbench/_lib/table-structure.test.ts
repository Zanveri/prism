import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api/prism-api";

import type { Column, ForeignKey, TableIndex } from "./database-sessions.schema";
import { levelView, structureColumns, structureForeignKeys, structureIndexes } from "./table-structure";

const column = (name: string, position: number, over: Partial<Column> = {}): Column => ({ name, type: "bigint", isNullable: false, isPrimaryKey: false, position, ...over });
const foreignKey = (name: string, columns: string[], referencedTable: string, referencedColumns: string[], referencedSchema = "producao"): ForeignKey => ({ name, columns, referencedSchema, referencedTable, referencedColumns });

describe("structureColumns: a tabela de colunas da Estrutura (RN-TABELA-003)", () => {
  const columns = [column("refugo", 6, { type: "numeric(12,3)" }), column("id", 1, { isPrimaryKey: true }), column("ordem_id", 2), column("observacao", 7, { type: "text", isNullable: true })];
  const foreignKeys = [foreignKey("fk_apontamento_ordem", ["ordem_id"], "ordem_producao", ["id"])];

  it("na ordem da posição, com o tipo e se aceita nulo", () => {
    const rows = structureColumns(columns, foreignKeys);

    expect(rows.map((row) => row.name)).toEqual(["id", "ordem_id", "refugo", "observacao"]);
    expect(rows[2]).toMatchObject({ position: 6, type: "numeric(12,3)", nullable: false });
    expect(rows[3]).toMatchObject({ type: "text", nullable: true });
  });

  it("a chave primária vem do catálogo; a estrangeira, de a coluna estar em alguma chave estrangeira", () => {
    const rows = structureColumns(columns, foreignKeys);

    expect(rows.map((row) => row.keys)).toEqual([["PK"], ["FK"], [], []]);
  });

  it("a coluna que é chave primária e estrangeira tem as duas marcas, na ordem PK, FK", () => {
    const rows = structureColumns([column("id", 1, { isPrimaryKey: true })], [foreignKey("fk_id", ["id"], "outra", ["id"])]);

    expect(rows[0].keys).toEqual(["PK", "FK"]);
  });

  it("chave estrangeira composta marca todas as colunas dela", () => {
    const rows = structureColumns([column("a", 1), column("b", 2), column("c", 3)], [foreignKey("fk_ab", ["a", "b"], "outra", ["x", "y"])]);

    expect(rows.map((row) => row.keys)).toEqual([["FK"], ["FK"], []]);
  });

  it("enquanto as chaves estrangeiras não chegaram, só a chave primária é marcada", () => {
    expect(structureColumns(columns, undefined).map((row) => row.keys)).toEqual([["PK"], [], [], []]);
  });

  it("não muda a lista que recebeu", () => {
    const copy = [...columns];
    structureColumns(columns, foreignKeys);

    expect(columns).toEqual(copy);
  });
});

describe("structureForeignKeys", () => {
  it("o nome, as colunas e a tabela referenciada com as colunas dela", () => {
    const rows = structureForeignKeys([foreignKey("fk_apontamento_ordem", ["ordem_id"], "ordem_producao", ["id"])], "producao");

    expect(rows).toEqual([{ name: "fk_apontamento_ordem", columns: "ordem_id", references: "ordem_producao (id)" }]);
  });

  it("o esquema da tabela referenciada só aparece quando é outro", () => {
    const rows = structureForeignKeys([foreignKey("fk_a", ["a"], "t", ["id"], "cadastro"), foreignKey("fk_b", ["b"], "t", ["id"], "producao")], "producao");

    expect(rows.map((row) => row.references)).toEqual(["cadastro.t (id)", "t (id)"]);
  });

  it("chave composta lista as colunas de um lado e do outro, separadas por vírgula", () => {
    const rows = structureForeignKeys([foreignKey("fk_ab", ["a", "b"], "t", ["x", "y"])], "producao");

    expect(rows[0]).toMatchObject({ columns: "a, b", references: "t (x, y)" });
  });
});

describe("structureIndexes", () => {
  it("o nome, as colunas e se é único", () => {
    const indexes: TableIndex[] = [
      { name: "pk_apontamento", columns: ["id"], isUnique: true },
      { name: "ix_apontamento_maquina_data", columns: ["maquina_id", "registrado_em"], isUnique: false },
    ];

    expect(structureIndexes(indexes)).toEqual([
      { name: "pk_apontamento", columns: "id", unique: true },
      { name: "ix_apontamento_maquina_data", columns: "maquina_id, registrado_em", unique: false },
    ]);
  });
});

describe("levelView: carregando, erro, vazio e pronto têm cada um o seu estado", () => {
  const apiError = (code: string, title: string, detail: string | null) => new ApiRequestError({ status: 404, code, title, detail, errors: null, extensions: {} });

  it("sem dado e sem erro, carrega", () => {
    expect(levelView({ data: undefined, error: null, isError: false, isFetching: true })).toEqual({ kind: "loading" });
  });

  it("com dado vazio, é vazio; com dado, pronto", () => {
    expect(levelView({ data: [], error: null, isError: false, isFetching: false })).toEqual({ kind: "empty" });
    expect(levelView({ data: [1], error: null, isError: false, isFetching: false })).toEqual({ kind: "ready" });
  });

  it("o erro da API diz a mensagem do banco (detail) e, sem ela, a frase da API (title)", () => {
    expect(levelView({ data: undefined, error: apiError("SQL_EXECUTION_FAILED", "A consulta falhou.", "permission denied for table x"), isError: true, isFetching: false })).toEqual({ kind: "error", message: "permission denied for table x", sessionLost: false });
    expect(levelView({ data: undefined, error: apiError("SQL_EXECUTION_FAILED", "A consulta falhou.", null), isError: true, isFetching: false })).toEqual({ kind: "error", message: "A consulta falhou.", sessionLost: false });
  });

  it("a sessão que a API não conhece mais é marcada, para o 'Tentar de novo' abrir outra", () => {
    const view = levelView({ data: undefined, error: apiError("DATABASE_SESSION_NOT_FOUND", "Sessão não encontrada.", null), isError: true, isFetching: false });

    expect(view).toEqual({ kind: "error", message: "Sessão não encontrada.", sessionLost: true });
  });

  it("um erro que não é da API (rede, exceção) mostra a mensagem dele", () => {
    expect(levelView({ data: undefined, error: new Error("falhou"), isError: true, isFetching: false })).toEqual({ kind: "error", message: "falhou", sessionLost: false });
  });

  it("buscando de novo depois de um erro, volta a carregar: o erro antigo não fica na tela", () => {
    expect(levelView({ data: undefined, error: apiError("X", "x", null), isError: true, isFetching: true })).toEqual({ kind: "loading" });
  });

  it("buscando de novo com dado já na tela, o dado fica (Atualizar não apaga a tabela)", () => {
    expect(levelView({ data: [1], error: null, isError: false, isFetching: true })).toEqual({ kind: "ready" });
  });

  it("com dado velho e a última busca falhou (a atualização), mostra o erro: o dado velho não passa por pronto", () => {
    const lost = apiError("DATABASE_SESSION_NOT_FOUND", "Sessão não encontrada.", null);

    expect(levelView({ data: [1], error: lost, isError: true, isFetching: false })).toEqual({ kind: "error", message: "Sessão não encontrada.", sessionLost: true });
    expect(levelView({ data: [1], error: apiError("SQL_EXECUTION_FAILED", "A consulta falhou.", "permission denied"), isError: true, isFetching: false })).toEqual({ kind: "error", message: "permission denied", sessionLost: false });
  });

  it("com dado velho e erro, tentando de novo, volta a carregar (o 'Tentar de novo' mostra que fez algo)", () => {
    expect(levelView({ data: [1], error: apiError("X", "x", null), isError: true, isFetching: true })).toEqual({ kind: "loading" });
  });
});
