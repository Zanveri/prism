import type { Engine } from "@/components/ui/engine-tag";

import type { ForeignKey } from "./database-sessions.schema";
import type { QueryColumn } from "./query.schema";
import type { TableRef } from "./table-diagram";
import { equalsCondition } from "./table-sql";

/** Para onde o valor de uma coluna leva (RN-TABELA-007): a tabela referenciada e a coluna dela. */
export type ColumnLink = { table: TableRef; column: string };

/**
 * As colunas do resultado que são chave estrangeira da tabela, e o que cada uma referencia. Uma coluna que está em mais de uma chave
 * leva pela primeira, na ordem do catálogo; numa chave composta, cada coluna leva à sua parceira: a que ocupa a mesma posição na lista
 * das referenciadas. Uma chave que a API devolveu sem a parceira daquela posição (lista curta) não dá link.
 */
export function foreignKeyLinks(columns: readonly QueryColumn[], foreignKeys: readonly ForeignKey[]): ReadonlyMap<number, ColumnLink> {
  const links = new Map<number, ColumnLink>();

  columns.forEach((column, index) => {
    for (const foreignKey of foreignKeys) {
      const position = foreignKey.columns.indexOf(column.name);
      const target = foreignKey.referencedColumns[position];
      if (position < 0 || target === undefined) continue;

      links.set(index, { table: { schema: foreignKey.referencedSchema, name: foreignKey.referencedTable }, column: target });
      return;
    }
  });
  return links;
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
