import type { Engine } from "@/components/ui/engine-tag";

import { existsAsDate, fieldsFromMilliseconds, type DateFields } from "./dates";
import { canonicalNumberText } from "./numbers";
import { booleanValue, dateValue, forbiddenMembers, listValue, nullValue, numberValue, objectValue, refuse, stringValue, typeLabel, withoutNull, type Type, type Value } from "./values";
import { phrase } from "./variables.copy";

/*
 * A variável de consulta (RN-VAR-011): o que a rota da consulta da variável devolveu (RN-VAR-034) vira um valor da linguagem. Pura: quem fala com a API é o executor
 * da aba, e quem confere a anotação e guarda o valor é o `ScriptRun` (`assign`). As células vêm no texto da grade (RN-SQL-011), inteiras.
 */

export type VariableQueryColumn = { name: string; type: string; kind: "text" | "number" | "datetime" | "boolean" | "binary" };
export type VariableQueryResult = { columns: readonly VariableQueryColumn[]; rows: readonly (readonly (string | null)[])[]; elapsedMs: number };

/** A coluna de data de dia (RN-VAR-004): `date` no PostgreSQL, `DATE` no Db2 e no Informix, e o `DATETIME YEAR TO DAY` do Informix. */
const isDayColumn = (type: string): boolean => /^date$/i.test(type.trim()) || /year\s+to\s+day$/i.test(type.trim());

const cellDate = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
/** O texto de instante que a API aceita de volta como parâmetro (RN-VAR-032): até 6 casas, e o fuso só no PostgreSQL. */
const sendableInstant = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}(?::\d{2})?)?$/;

/** A data de uma célula `datetime`, com o texto exato que veio (RN-VAR-007), ou nulo quando o texto não é uma data (a hora, o intervalo: viram texto). */
function cellDateValue(text: string, dayColumn: boolean, engine: Engine | undefined): Value | null {
  const match = cellDate.exec(text);
  if (match === null) return null;
  const written: DateFields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").slice(0, 3).padEnd(3, "0") || 0),
  };
  if (!existsAsDate(written)) return null;

  if (dayColumn || match[4] === undefined) {
    const day = { ...written, hour: 0, minute: 0, second: 0, millisecond: 0 };
    return dateValue(day, "day", `${match[1]}-${match[2]}-${match[3]}`);
  }

  const zone = match[8];
  let fields = written;
  if (zone !== undefined) {
    // O instante com fuso (o `timestamptz` do PostgreSQL) vira a hora local da máquina; o texto exato volta como veio (RN-VAR-007 e 017).
    const minutes = zone === "Z" ? 0 : (zone.startsWith("-") ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.replace(":", "").slice(3, 5) || 0));
    const utc = new Date(0);
    utc.setUTCFullYear(written.year, written.month - 1, written.day);
    utc.setUTCHours(written.hour, written.minute, written.second, written.millisecond);
    const local = fieldsFromMilliseconds(utc.getTime() - minutes * 60_000);
    if (local === null) return null;
    fields = local;
  }
  // ponytail: o texto com mais de 6 casas (o TIMESTAMP(12) do Db2) ou com fuso fora do PostgreSQL vai pelos campos, até o milissegundo; a API não o aceitaria de volta.
  const exact = sendableInstant.test(text) && (zone === undefined || engine === 1) ? text : undefined;
  return dateValue(fields, "instant", exact);
}

/** O valor de uma célula pelo `kind` da coluna (RN-VAR-011). O nulo é `null`; o binário já foi recusado. */
export function cellValue(text: string | null, column: VariableQueryColumn, engine: Engine | undefined): Value {
  if (text === null) return nullValue;
  switch (column.kind) {
    case "number": {
      const value = Number(text);
      if (!Number.isFinite(value) || text.trim() === "") throw refuse(phrase.queryNotJsNumber(text, column.name));
      return numberValue(value, canonicalNumberText(text));
    }
    case "boolean":
      if (text === "true" || text === "t" || text === "1") return booleanValue(true);
      if (text === "false" || text === "f" || text === "0") return booleanValue(false);
      return stringValue(text);
    case "datetime":
      return cellDateValue(text, isDayColumn(column.type), engine) ?? stringValue(text);
    default:
      return stringValue(text);
  }
}

/**
 * A forma do valor (RN-VAR-011), pelo que a consulta devolveu: uma coluna e uma linha é a célula; uma coluna e várias linhas, a lista; várias colunas e uma linha, o
 * objeto; várias e várias, a lista dos objetos; nenhuma linha, `null`. `declared` é o tipo da anotação, quando há: a lista sempre devolve a lista (a vazia também), e o
 * valor só recusa mais de uma linha. Lança a frase (sem posição; quem chama põe a da declaração).
 */
export function queryValue(name: string, result: VariableQueryResult, declared: Type | null, engine: Engine | undefined): Value {
  const { columns, rows } = result;
  for (const column of columns) if (column.kind === "binary") throw refuse(phrase.queryBinaryColumn(column.name));

  const base = declared === null ? null : withoutNull(declared);
  const wantsList = base?.tag === "list";
  const single = columns.length === 1;

  if (!single) {
    const seen = new Set<string>();
    for (const column of columns) {
      if (forbiddenMembers.has(column.name)) throw refuse(phrase.queryForbiddenColumn(column.name));
      if (seen.has(column.name)) throw refuse(phrase.queryDuplicateColumn(name, column.name));
      seen.add(column.name);
    }
  }

  const rowValue = (row: readonly (string | null)[]): Value =>
    single ? cellValue(row[0] ?? null, columns[0], engine) : objectValue(columns.map((column, index) => [column.name, cellValue(row[index] ?? null, column, engine)] as const));

  if (wantsList) return listValue(rows.map(rowValue));
  if (rows.length === 0) return nullValue;
  if (rows.length === 1) return rowValue(rows[0]);
  if (base !== null) throw refuse(phrase.queryTooManyRows(name, rows.length, typeLabel(base)));
  return listValue(rows.map(rowValue));
}
