import type { Engine, SelectOption } from "@/components/ui";

import { inDatabase, parseNavKey, type NavNode } from "./navigator-model";
import { withEditedSql } from "./saved-scripts";
import type { QueryTab } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

/**
 * O banco em que a aba de consulta roda e a troca dele (RN-ARVORE-007), sem React: o que a lista da barra do editor mostra e a aba depois de trocar. A
 * lista é a dos bancos do servidor da árvore (RN-ARVORE-006, `databaseNodes`), a mesma consulta e o mesmo cache; aqui ela só vira opções.
 */

const copy = workbenchCopy.editor.database;

/** O Db2 conecta num banco só por vez e não tem SQL que liste os outros da instância (RN-ARVORE-006): a lista fica presa ao banco da conexão. */
const db2: Engine = 2;

/**
 * O valor de um banco na lista, em JSON: o banco da conexão (a aba sem `database`) é `null`, e nenhum nome de banco, nem um chamado "null", se confunde com
 * ele nem com outro.
 */
export const databaseValue = (database: string | undefined): string => JSON.stringify(database ?? null);

/** O banco de um valor da lista; `undefined` é o banco da conexão (e o que não é valor da lista também vira ele, o que nunca troca de banco por engano). */
export function databaseOfValue(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type DatabaseChoices = { options: SelectOption[]; value: string; locked: boolean };

type ChoicesInput = {
  /** A lista da árvore, já em linhas (`databaseNodes`), ou `undefined` enquanto ela não veio. */
  nodes: readonly NavNode[] | undefined;
  /** O banco da aba; sem ele, o da conexão. */
  current: string | undefined;
  /** O banco do cadastro da conexão: o nome do padrão antes de a lista chegar. */
  connectionDatabase: string | undefined;
  engine: Engine | undefined;
};

/**
 * RN-ARVORE-007: as opções da lista dos bancos da aba e o valor dela. Com a lista da árvore, os bancos dela na mesma ordem (o da conexão primeiro, com o
 * nome que o servidor deu e marcado como o padrão); antes, só o banco da aba. O banco da aba que a lista não traz fica no fim, para o valor ter rótulo. No
 * Db2, só o banco da conexão, e a lista presa (`locked`).
 */
export function databaseChoices({ nodes, current, connectionDatabase, engine }: ChoicesInput): DatabaseChoices {
  const listed = (nodes ?? []).map((node) => ({ database: databaseOf(node), label: node.label }));
  const defaultLabel = copy.defaultName(listed.find((entry) => entry.database === undefined)?.label ?? connectionDatabase ?? copy.connectionDatabase);
  const option = (database: string | undefined): SelectOption => ({ value: databaseValue(database), label: database === undefined ? defaultLabel : database });

  if (engine === db2) return { options: [option(current)], value: databaseValue(current), locked: true };

  const options = listed.map((entry) => (entry.database === undefined ? option(undefined) : { value: databaseValue(entry.database), label: entry.label }));
  if (!options.some((candidate) => candidate.value === databaseValue(current))) options.push(option(current));
  return { options, value: databaseValue(current), locked: false };
}

/** O banco de uma linha da lista da árvore: o caminho do banco da conexão não leva nome. */
function databaseOf(node: NavNode): string | undefined {
  const path = parseNavKey(node.key);
  return path.type === "database" ? path.database : undefined;
}

/**
 * RN-ARVORE-007: a aba de consulta passa a outro banco do servidor da conexão (`undefined`: o da conexão). A sessão de antes era do banco anterior e não
 * serve mais (quem chama a fecha, e o executor novo abre a deste banco na próxima execução, como a aba aberta pela árvore); o texto fica, o do editor deste
 * instante (`sql`); a aba de um script recalcula o ponto pelo texto e pelo banco (RN-SCRIPT-001). `null` quando não há o que trocar: a aba de uma tabela
 * (ela é a tabela daquele banco), a aba sem conexão e o mesmo banco.
 */
export function withDatabase(tab: QueryTab, database: string | undefined, sql: string = tab.sql): QueryTab | null {
  if (tab.table !== undefined || tab.schemaTarget !== undefined || tab.databaseTarget !== undefined || tab.connectionId === null || tab.database === database) return null;

  const rest = { ...tab };
  delete rest.database;
  return withEditedSql({ ...rest, ...inDatabase(database), sessionId: null }, sql);
}
