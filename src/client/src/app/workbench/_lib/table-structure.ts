import { ApiRequestError } from "@/lib/api/prism-api";

import type { Column, ForeignKey, TableIndex } from "./database-sessions.schema";

/** Uma coluna da tabela de colunas. `keys` na ordem em que aparecem: a primária, depois a estrangeira. */
export type StructureColumn = { position: number; name: string; type: string; nullable: boolean; keys: ("PK" | "FK")[] };

/**
 * As colunas na ordem da posição, com as marcas de chave (RN-TABELA-003). A chave primária é do
 * catálogo; a estrangeira é a coluna estar em alguma chave estrangeira da tabela (uma composta marca
 * todas as colunas dela). Enquanto as chaves estrangeiras não chegaram (`undefined`), só a primária
 * é marcada: as marcas estrangeiras aparecem quando a lista chegar.
 */
export function structureColumns(columns: Column[], foreignKeys: ForeignKey[] | undefined): StructureColumn[] {
  const inForeignKey = new Set((foreignKeys ?? []).flatMap((foreignKey) => foreignKey.columns));

  return [...columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => ({
      position: column.position,
      name: column.name,
      type: column.type,
      nullable: column.isNullable,
      keys: [...(column.isPrimaryKey ? (["PK"] as const) : []), ...(inForeignKey.has(column.name) ? (["FK"] as const) : [])],
    }));
}

export type StructureForeignKey = { name: string; columns: string; references: string };

/** Nome, colunas e `tabela (colunas)`; o esquema da tabela referenciada só aparece quando é outro (como na árvore). */
export function structureForeignKeys(foreignKeys: ForeignKey[], schema: string): StructureForeignKey[] {
  return foreignKeys.map((foreignKey) => {
    const table = foreignKey.referencedSchema === schema ? foreignKey.referencedTable : `${foreignKey.referencedSchema}.${foreignKey.referencedTable}`;

    return { name: foreignKey.name, columns: foreignKey.columns.join(", "), references: `${table} (${foreignKey.referencedColumns.join(", ")})` };
  });
}

export type StructureIndex = { name: string; columns: string; unique: boolean };

export function structureIndexes(indexes: TableIndex[]): StructureIndex[] {
  return indexes.map((index) => ({ name: index.name, columns: index.columns.join(", "), unique: index.isUnique }));
}

/**
 * O que uma seção da Estrutura mostra: carregando, o erro (com a mensagem do banco, como veio),
 * vazio ou pronto. Cada seção tem a sua consulta, então uma falha não esconde as outras.
 */
export type LevelView = { kind: "loading" } | { kind: "error"; message: string; sessionLost: boolean } | { kind: "empty" } | { kind: "ready" };

/** A parte de uma consulta (`UseQueryResult`) de que o estado de uma seção depende. */
type LevelQuery = { data: readonly unknown[] | { tables: readonly unknown[] } | undefined; error: unknown; isError: boolean; isFetching: boolean };

/**
 * O erro da última busca vence o dado que veio antes dela: um "Atualizar" que falha (a sessão caiu, o banco
 * recusou) mostra o erro, com "Tentar de novo", e não o dado velho como se estivesse pronto. Buscando de novo
 * depois de um erro, a seção volta a carregar (o "Tentar de novo" tem de mostrar que fez algo); com dado
 * já na tela e nenhum erro, buscar de novo ("Atualizar") não o apaga.
 */
export function levelView(query: LevelQuery): LevelView {
  if (query.isError) return query.isFetching ? { kind: "loading" } : errorView(query.error);
  if (query.data === undefined) return { kind: "loading" };
  return ("tables" in query.data ? query.data.tables.length : query.data.length) === 0 ? { kind: "empty" } : { kind: "ready" };
}

function errorView(error: unknown): LevelView {
  if (error instanceof ApiRequestError) return { kind: "error", message: error.error.detail ?? error.error.title, sessionLost: error.error.code === "DATABASE_SESSION_NOT_FOUND" };
  return { kind: "error", message: error instanceof Error ? error.message : String(error), sessionLost: false };
}
