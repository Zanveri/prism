import type { Engine } from "@/components/ui";

import type { ForeignKey, ReferencingForeignKey } from "./database-sessions.schema";
import { sqlName } from "./sql-completion";
import { isAliasWord } from "./sql-references";

/**
 * RN-SQL-025: o que o autocompletar sugere depois de `JOIN` e depois de `JOIN tabela ON`. Tudo puro: recebe as tabelas do comando com as chaves estrangeiras
 * delas e devolve os textos prontos.
 */

/** Uma tabela, como o catálogo a nomeia. */
export type TableName = { schema: string; name: string };

/**
 * Uma ligação por chave estrangeira, vista de uma tabela: `own` são as colunas dela e `other` as da tabela do outro lado, na ordem da chave. Uma chave que sai da
 * tabela (ela referencia a outra) e uma que chega a ela (a outra a referencia) são a mesma ligação vista dos dois lados.
 */
export type TableLink = { name: string; table: TableName; own: readonly string[]; other: readonly string[] };

/** As ligações de uma tabela: as chaves dela (`foreignKeys`) e as que apontam para ela (`referencedBy`). O que ainda não chegou (`undefined`) não liga nada. */
export function linksOf(foreignKeys: readonly ForeignKey[] | undefined, referencedBy: readonly ReferencingForeignKey[] | undefined): TableLink[] {
  return [
    ...(foreignKeys ?? []).map((key) => ({ name: key.name, table: { schema: key.referencedSchema, name: key.referencedTable }, own: key.columns, other: key.referencedColumns })),
    ...(referencedBy ?? []).map((key) => ({ name: key.name, table: { schema: key.referencingSchema, name: key.referencingTable }, own: key.referencedColumns, other: key.columns })),
  ];
}

/** Uma tabela do comando, para montar as condições: como o comando a chama (`qualifier`) e as ligações dela. */
export type StatementTable = TableName & {
  /** O apelido como está escrito, ou o nome da tabela como o autocompletar o escreve. */
  qualifier: string;
  links: readonly TableLink[];
  /** A tabela de origem foi escrita com o esquema na frente (`esquema.tabela`)? Quando `false`, a sugestão segue o padrão sem esquema. */
  qualified?: boolean;
};

/** Uma sugestão: o texto que entra (`label`) e a chave que a motivou (`detail`). */
export type LinkSuggestion = { label: string; detail: string };

const sameTable = (a: TableName, b: TableName) => a.schema === b.schema && a.name === b.name;

/**
 * O apelido de uma tabela nova: as iniciais das partes do nome separadas por `_` (`itens_pedido` → `ip`), em minúsculas, e só letras; sem nenhuma, `t`. Com o
 * apelido já em uso (`taken`, em minúsculas) ou sendo palavra reservada (`on`, `in`, `as`…), ganha 2, 3… (`ip2`).
 */
export function aliasFor(name: string, taken: ReadonlySet<string>): string {
  const initials = name
    .split("_")
    .map((part) => /[a-z]/i.exec(part.normalize("NFD"))?.[0].toLowerCase() ?? "")
    .join("");
  const base = initials === "" ? "t" : initials;

  let alias = base;
  for (let attempt = 2; taken.has(alias) || isAliasWord(alias); attempt++) alias = `${base}${attempt}`;
  return alias;
}

/**
 * O nome da tabela como o autocompletar o escreve (`sqlName`): o esquema na frente quando não é o padrão da sessão (`defaultSchemas`; no Informix, `null`, o
 * esquema vai sempre, como na lista de tabelas).
 */
export function writtenTable(table: TableName, engine: Engine | undefined, defaultSchemas: readonly string[] | null): string {
  const standard = defaultSchemas !== null && defaultSchemas.includes(table.schema);
  return `${standard ? "" : `${sqlName(table.schema, engine)}.`}${sqlName(table.name, engine)}`;
}

/** `a.x = b.y AND a.z = b.w`: as colunas do mesmo lugar na chave, na ordem dela. */
export function joinCondition(left: string, leftColumns: readonly string[], right: string, rightColumns: readonly string[], engine: Engine | undefined, uppercaseKeywords = true): string {
  const andKeyword = uppercaseKeywords ? " AND " : " and ";
  return leftColumns.map((column, index) => `${left}.${sqlName(column, engine)} = ${right}.${sqlName(rightColumns[index], engine)}`).join(andKeyword);
}

export type JoinInput = {
  /** As tabelas do comando que o catálogo conhece, na ordem em que estão escritas. */
  tables: readonly StatementTable[];
  /** Os nomes que um apelido novo não pode repetir (em minúsculas). */
  used: ReadonlySet<string>;
  /** O comando tem apelidos: a tabela nova ganha um. */
  usesAliases: boolean;
  engine: Engine | undefined;
  defaultSchemas: readonly string[] | null;
  /** Respeita a preferência de palavras-chave em maiúsculas (`ON`/`AND` vs `on`/`and`). Padrão: `true`. */
  uppercaseKeywords?: boolean;
};

/**
 * RN-SQL-025: as tabelas ligadas por chave estrangeira, nos dois sentidos, a alguma tabela do comando, com a condição pronta (`clientes c ON c.id =
 * p.cliente_id`). Primeiro as que ligam à última tabela escrita, depois as das outras, na ordem do comando; em cada tabela, as chaves dela e depois as que a
 * referenciam. Uma sugestão por chave. Uma tabela que já está no comando não se repete, menos a que se liga a si mesma, que ganha outro apelido (e nenhuma outra
 * ligação a traz de novo). Sem apelidos no comando, a tabela nova entra pelo nome inteiro (`clientes ON clientes.id = pedidos.cliente_id`), e só ganha apelido
 * se o nome já é de outra tabela do comando.
 */
export function joinSuggestions({ tables, used, usesAliases, engine, defaultSchemas, uppercaseKeywords = true }: JoinInput): LinkSuggestion[] {
  const last = tables.at(-1);
  if (last === undefined) return [];

  const onKeyword = uppercaseKeywords ? "ON" : "on";
  const suggestions: LinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const source of [last, ...tables.slice(0, -1)]) {
    for (const link of source.links) {
      const inStatement = tables.some((table) => sameTable(table, link.table));
      if (inStatement && !sameTable(source, link.table)) continue;

      const sameNameOtherSchema = tables.some((table) => table.name === link.table.name && table.schema !== link.table.schema);
      const plain = sqlName(link.table.name, engine);
      const written = source.qualified === false && !sameNameOtherSchema ? plain : writtenTable(link.table, engine, defaultSchemas);
      const aliased = usesAliases || inStatement || used.has(link.table.name.toLowerCase());
      const alias = aliased ? aliasFor(link.table.name, used) : null;
      const label = `${written}${alias === null ? "" : ` ${alias}`} ${onKeyword} ${joinCondition(alias ?? plain, link.other, source.qualifier, link.own, engine, uppercaseKeywords)}`;

      const key = `${label}\u0000${link.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ label, detail: link.name });
    }
  }

  return suggestions;
}

/**
 * RN-SQL-025: depois de `JOIN tabela [AS] [apelido] ON `, as condições que ligam a tabela do `JOIN` (`table`) às outras do comando (`others`, as que vêm antes
 * dela), `c.id = p.cliente_id`: primeiro as da última tabela escrita. Uma tabela que se liga a si mesma, junto de outra instância dela no comando, traz as duas
 * condições (a pai e a filha).
 */
export function onSuggestions(table: StatementTable, others: readonly StatementTable[], engine: Engine | undefined, uppercaseKeywords = true): LinkSuggestion[] {
  const suggestions: LinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const other of [...others].reverse()) {
    for (const link of table.links) {
      if (!sameTable(link.table, other)) continue;

      const label = joinCondition(table.qualifier, link.own, other.qualifier, link.other, engine, uppercaseKeywords);
      const key = `${label}\u0000${link.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ label, detail: link.name });
    }
  }

  return suggestions;
}
