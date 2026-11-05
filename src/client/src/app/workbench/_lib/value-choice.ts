import type { QueryClient } from "@tanstack/react-query";

import type { Engine } from "@/components/ui/engine-tag";
import type { ApiResult } from "@/lib/api/prism-api";

import { databaseSessionQuery } from "./database-sessions.service";
import { checkColumnValues, getColumnValues, type ColumnValuesRequest } from "./query.service";
import type { ColumnValues } from "./query.schema";
import { columnsQuery, foreignKeysQuery } from "./table-structure.service";
import { variableFieldsCopy as copy } from "./variable-fields.copy";
import { descriptionColumnOf, restrictionOf, type Restriction, type VariableKind } from "./variable-inference";
import { toParameter } from "./variables/bind";
import type { ColumnRead } from "./variables/column-types";
import { displayValue, type Value } from "./variables/values";

/*
 * A escolha do diálogo (RN-VAR-031): de qual coluna vêm os valores (a restrição, RN-VAR-030) e a coluna de descrição, lidas no cache da Estrutura pela sessão da árvore
 * da conexão e do banco (RN-ARVORE-006); a página dos valores e a conferência do valor digitado, pela rota dos valores (RN-VAR-035) na mesma sessão.
 */

/** A escolha de um campo: a coluna dos valores, a de descrição (nula sem nenhuma) e o nome da tabela como as frases o escrevem ("estoque.cliente", ou "pedido"). */
export type Choice = Restriction & { description: string | null; tableText: string };

/** A sessão da árvore em que a escolha fala com o banco. */
export type ChoiceScope = { queryClient: QueryClient; connectionId: string; database?: string; engine: Engine | undefined };

/**
 * A escolha da coluna lida de um tipo de coluna (`let c: pedido.cliente_id`) ou de uma inferência (`compared`, `variable`, RN-VAR-030); nula quando a coluna não
 * restringe ou o catálogo não respondeu: o campo fica livre.
 */
export async function choiceOf(scope: ChoiceScope, target: { schema: string; table: string; column: string }, how: { compared: boolean; columnType: boolean; variable: VariableKind }, schemaWritten: boolean): Promise<Choice | null> {
  const { queryClient, connectionId, database, engine } = scope;
  try {
    const [columns, keys] = await Promise.all([
      queryClient.fetchQuery(columnsQuery(connectionId, target.schema, target.table, queryClient, true, database)),
      queryClient.fetchQuery(foreignKeysQuery(connectionId, target.schema, target.table, queryClient, true, database)),
    ]);
    const restriction = restrictionOf(target, how, columns, keys, engine);
    if (restriction === null) return null;
    const same = restriction.schema === target.schema && restriction.table === target.table;
    const referenced = same ? columns : await queryClient.fetchQuery(columnsQuery(connectionId, restriction.schema, restriction.table, queryClient, true, database));
    const tableText = same && !schemaWritten ? restriction.table : `${restriction.schema}.${restriction.table}`;
    return { ...restriction, description: descriptionColumnOf(referenced, restriction.column, engine), tableText };
  } catch {
    return null;
  }
}

/** A escolha do campo de tipo de coluna (RN-VAR-030: o tipo de coluna diz a coluna). */
export const columnChoiceOf = (scope: ChoiceScope, read: ColumnRead & { ok: true }, schemaWritten: boolean) =>
  choiceOf(scope, { schema: read.schema, table: read.table, column: read.column }, { compared: false, columnType: true, variable: null }, schemaWritten);

const sessionOf = async (scope: ChoiceScope) => (await scope.queryClient.ensureQueryData(databaseSessionQuery(scope.connectionId, scope.database))).id;

/** Uma página dos valores da escolha (100 por vez), com a busca. A falha (a sessão que não abriu) volta como a recusa da API. */
export async function choiceValues(scope: ChoiceScope, choice: Choice, request: Omit<ColumnValuesRequest, "column" | "description">, signal?: AbortSignal): Promise<ApiResult<ColumnValues> | { ok: false; error: { title: string } }> {
  try {
    const id = await sessionOf(scope);
    return await getColumnValues(id, choice.schema, choice.table, { column: choice.column, ...(choice.description === null ? {} : { description: choice.description }), limit: 100, ...request }, signal);
  } catch (error) {
    return { ok: false, error: { title: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * RN-VAR-031: os valores digitados que não existem na coluna da escolha, pela conferência da API; nulo quando a conferência não respondeu (o valor continua aceito, e
 * a execução segue: o banco tem a última palavra).
 */
export async function missingValues(scope: ChoiceScope, choice: Choice, values: readonly Value[]): Promise<string[] | null> {
  if (values.length === 0) return [];
  try {
    const id = await sessionOf(scope);
    const params = values.map((value) => {
      const { type, value: text } = toParameter(value, "", null, scope.engine, undefined);
      return { type, value: text };
    });
    const checked = await checkColumnValues(id, choice.schema, choice.table, choice.column, params);
    return checked.ok ? checked.data.missing.map((position) => displayValue(values[position])) : null;
  } catch {
    return null;
  }
}

/** A frase do valor que não existe: "O valor 999 não existe em estoque.cliente (id)." */
export const missingMessage = (choice: Choice, values: readonly string[]) => copy.missing(values, choice.tableText, choice.column);
