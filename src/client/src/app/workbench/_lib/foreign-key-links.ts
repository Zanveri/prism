import type { Engine } from "@/components/ui/engine-tag";

import type { ForeignKey } from "./database-sessions.schema";
import type { QueryColumn } from "./query.schema";
import type { SqlTarget } from "./record-edits.schema";
import { tableKey, type TableRef } from "./table-diagram";
import { equalsCondition } from "./table-sql";

/** Para onde o valor de uma coluna leva (RN-TABELA-007): a tabela referenciada e a coluna dela. */
export type ColumnLink = { table: TableRef; column: string };

/**
 * Para onde leva a coluna de nome `name` numa tabela de chaves estrangeiras `foreignKeys`, ou `undefined`. A coluna que está em mais de uma chave leva pela
 * primeira, na ordem do catálogo; numa chave composta, leva à parceira: a que ocupa a mesma posição na lista das referenciadas. Uma chave que a API devolveu
 * sem a parceira daquela posição (lista curta) não dá link.
 */
function linkOfColumn(name: string, foreignKeys: readonly ForeignKey[]): ColumnLink | undefined {
  for (const foreignKey of foreignKeys) {
    const position = foreignKey.columns.indexOf(name);
    const target = foreignKey.referencedColumns[position];
    if (position < 0 || target === undefined) continue;

    return { table: { schema: foreignKey.referencedSchema, name: foreignKey.referencedTable }, column: target };
  }
  return undefined;
}

/**
 * As colunas do resultado que são chave estrangeira da tabela, e o que cada uma referencia, pelo nome que o resultado mostra (a vista Registros, onde as colunas
 * são as da tabela, `SELECT *`). Veja `linkOfColumn` para a chave em que cada uma cai.
 */
export function foreignKeyLinks(columns: readonly QueryColumn[], foreignKeys: readonly ForeignKey[]): ReadonlyMap<number, ColumnLink> {
  const links = new Map<number, ColumnLink>();

  columns.forEach((column, index) => {
    const link = linkOfColumn(column.name, foreignKeys);
    if (link !== undefined) links.set(index, link);
  });
  return links;
}

/** A tabela do `FROM` de onde vem a coluna do alvo, se ela é uma TABELA e a coluna é uma coluna dela (`baseColumn`); senão, `undefined`. */
function sourceOf(target: SqlTarget, column: SqlTarget["columns"][number]): { table: SqlTarget["tables"][number]; baseColumn: string } | undefined {
  const table = column.table === null ? undefined : target.tables[column.table];
  return table === undefined || table.kind !== "table" || column.baseColumn === null ? undefined : { table, baseColumn: column.baseColumn };
}

/**
 * RN-TABELA-007, no resultado da consulta e do script: a tabela de origem de cada coluna que é uma coluna de uma TABELA do `FROM` (`kind` `table`: a visão, o
 * sinônimo e o resto não têm chave estrangeira no catálogo do Prism), pelo alvo do "Gerar SQL" (`purpose: "sql"`, RN-GRADE-020). Cada tabela uma vez, na ordem
 * em que aparece; a coluna calculada, a de origem desconhecida (`baseColumn` nulo) e a tabela `elsewhere` não entram. É o que a tela pede ao catálogo das chaves.
 */
export function sourceTables(columnCount: number, target: SqlTarget | null): readonly TableRef[] {
  const tables = new Map<string, TableRef>();
  if (target === null) return [];

  for (const column of target.columns.slice(0, columnCount)) {
    const source = sourceOf(target, column);
    if (source !== undefined) tables.set(tableKey(source.table), { schema: source.table.schema, name: source.table.name });
  }
  return [...tables.values()];
}

/**
 * RN-TABELA-007, no resultado da consulta e do script: as colunas que são chave estrangeira da tabela de onde vêm. A origem é a do alvo (`SqlTarget.columns`,
 * uma por coluna do resultado, na ordem: a tabela do `FROM` e a coluna dela, `baseColumn`), e a chave é a da tabela dessa coluna (`foreignKeysOf`): compara-se
 * a coluna de origem, e não o nome que o resultado mostra, e por isso o apelido (`AS status`) e a junção (cada coluna com a chave da sua tabela) funcionam. As regras da
 * chave são as de `foreignKeyLinks`. Sem link, e sem aviso: a coluna calculada, a de origem desconhecida, a que vem de uma visão ou de outro tipo de objeto, e a
 * tabela de que o catálogo das chaves ainda não chegou.
 */
export function resultLinks(columnCount: number, target: SqlTarget, foreignKeysOf: (table: TableRef) => readonly ForeignKey[] | undefined): ReadonlyMap<number, ColumnLink> {
  const links = new Map<number, ColumnLink>();

  target.columns.slice(0, columnCount).forEach((column, index) => {
    const source = sourceOf(target, column);
    const foreignKeys = source === undefined ? undefined : foreignKeysOf({ schema: source.table.schema, name: source.table.name });
    const link = source === undefined || foreignKeys === undefined ? undefined : linkOfColumn(source.baseColumn, foreignKeys);
    if (link !== undefined) links.set(index, link);
  });
  return links;
}

/**
 * Os links que o resultado da consulta e do script mostram (RN-TABELA-007), ou `undefined` (nenhum valor é link): sem o alvo (a origem das colunas ainda não
 * chegou, o resultado é só leitura por outro motivo ou a pergunta falhou) ou com a aba SEM SESSÃO, a conexão desconectada: seguir a chave levaria um filtro à
 * tabela referenciada sem que nada fosse enviado, como nos Registros (`recordLinks`). As linhas que ficaram na tela dá para ler, não para seguir.
 */
export function shownResultLinks(connected: boolean, columnCount: number, target: SqlTarget | null, foreignKeysOf: (table: TableRef) => readonly ForeignKey[] | undefined): ReadonlyMap<number, ColumnLink> | undefined {
  return !connected || target === null ? undefined : resultLinks(columnCount, target, foreignKeysOf);
}

/**
 * Os links que a vista Registros mostra (RN-TABELA-007), ou `undefined` (nenhum valor é link): sem linhas na tela, sem o catálogo das chaves, ou com a conexão
 * DESCONECTADA pela pessoa. Desconectada, o valor volta a ser texto: seguir a chave levaria um filtro à tabela referenciada sem que nada fosse enviado (nada
 * reconecta sem o clique em "Atualizar", RN-SESSAO-004), e a tela só mostra como aplicado o filtro do comando que foi de fato enviado (RN-TABELA-005). As linhas
 * que ficaram na tela são o retrato de antes da desconexão: dá para ler, não para seguir. "Atualizar" reconecta, e os links voltam.
 */
export function recordLinks(columns: readonly QueryColumn[] | undefined, foreignKeys: readonly ForeignKey[] | undefined, disconnected: boolean): ReadonlyMap<number, ColumnLink> | undefined {
  return disconnected || columns === undefined || foreignKeys === undefined ? undefined : foreignKeyLinks(columns, foreignKeys);
}

/**
 * Os mesmos links, por conteúdo: a grade é memorizada e perde o `memo` com um mapa novo igual ao de antes, e a atualização automática redesenha a aba a cada
 * execução. `undefined` (nenhum valor é link) só é igual a `undefined`.
 */
export function sameLinks(a: ReadonlyMap<number, ColumnLink> | undefined, b: ReadonlyMap<number, ColumnLink> | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;

  for (const [index, link] of a) {
    const other = b.get(index);
    if (other === undefined || other.column !== link.column || other.table.schema !== link.table.schema || other.table.name !== link.table.name) return false;
  }
  return true;
}

/** O que o clique pede: abrir a tabela referenciada com este `WHERE` no campo do filtro. */
export type FollowRequest = { table: TableRef; where: string };

/**
 * O que o clique no valor de uma chave estrangeira pede (RN-TABELA-007). O nulo não tem para onde ir, e um valor cortado (RN-SQL-011) não é o valor
 * que o banco guarda: nenhum dos dois leva a lugar nenhum (`null`). O valor que não cabe no filtro (quebra de linha) também não.
 */
export function followOf(engine: Engine, column: QueryColumn, link: ColumnLink, value: string | null, truncated = false): FollowRequest | null {
  if (value === null || truncated) return null;

  const where = equalsCondition(engine, link.column, value, column.kind);
  return where === null ? null : { table: link.table, where };
}
