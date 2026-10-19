import type { Engine } from "@/components/ui/engine-tag";

import { isJoin, rowProblem, tableOfColumn, type RowContext } from "./cell-editing";
import { activeColumnChoice, type GridLayout, type GridSelection } from "./grid-selection";
import { multiEditCopy } from "./multi-edit.copy";
import type { QueryColumn } from "./query.schema";
import { columnEditsOf, type EditValue, type PendingEdits } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";
import { sqlTokens, type SqlToken } from "./sql-statements";
import { sqlLiteral } from "./table-sql";

const copy = multiEditCopy;

/** RN-EDIT-017: a edição vale para até 100.000 células de uma vez (o teto das linhas que a grade carrega para copiar, RN-GRADE-023). */
export const groupLimit = 100_000;

/**
 * RN-EDIT-017 e 018: para quem a edição da célula ativa vale: só ela (`one`: sem outras escolhidas na coluna dela, ou com ela fora da seleção); as células
 * escolhidas da coluna dela (`cells`, as posições na grade, as lidas e as novas, em ordem); ou a coluna inteira (`all`, com as posições das linhas novas que
 * já existem, que recebem o valor como uma alteração delas).
 */
export type EditScope = { kind: "one" } | { kind: "cells"; column: number; rows: readonly number[] } | { kind: "all"; column: number; added: readonly number[] };

export function editScopeOf(selection: GridSelection, layout: GridLayout): EditScope {
  const choice = activeColumnChoice(selection, layout);
  if (choice === null) return { kind: "one" };
  if (choice.allRows) return { kind: "all", column: choice.column, added: choice.rows.filter((row) => row >= layout.read) };
  return choice.rows.length > 1 ? { kind: "cells", column: choice.column, rows: choice.rows } : { kind: "one" };
}

/** A dica do campo de edição (e o fim da dica do "Editar célula" da barra): para quantas a edição vale; nula com uma célula só. */
export function scopeHint(scope: EditScope, column: string, where: "editor" | "bar" = "editor"): string | null {
  const texts = where === "editor" ? copy.hint : copy.bar;
  if (scope.kind === "cells") return texts.cells(scope.rows.length, column);
  if (scope.kind === "all") return texts.all(column);
  return null;
}

/** RN-EDIT-017: o rótulo do "Definir como nulo": com uma célula, o de sempre; com várias, para quantas; com a coluna inteira, ela. */
export function setNullLabel(scope: EditScope, single: string): string {
  if (scope.kind === "cells") return copy.setNull.cells(scope.rows.length);
  if (scope.kind === "all") return copy.setNull.all;
  return single;
}

/**
 * RN-EDIT-017: a conferência das células escolhidas antes de o campo abrir (e do "Definir como nulo"), sem consulta, sobre as linhas que a grade tem: a
 * primeira que não pode receber o valor, na ordem da grade, com o número da linha (`labelOf`: "linha 7", "linha nova 2"), já na frase da faixa; nula quando
 * todas podem. O motivo da tabela e o da coluna são os da célula ativa, que quem chama confere antes; aqui, os da linha (`rowProblem`). Acima de 100.000
 * células, o teto.
 */
export function groupRefusal({ target, column, rows, rowOf, labelOf }: { target: EditTarget | null; column: number; rows: readonly number[]; rowOf: (row: number) => RowContext; labelOf: (row: number) => string }): string | null {
  if (rows.length > groupLimit) return copy.tooMany;
  const table = tableOfColumn(target, column);
  for (const row of rows) {
    const problem = rowProblem(target, table, column, rowOf(row));
    if (problem === null) continue;
    const label = labelOf(row);
    if (problem.kind === "deleted") return copy.refused(copy.reasons.deleted(label));
    if (problem.kind === "truncated") return copy.refused(copy.reasons.truncated(label));
    if (problem.kind === "generated") return copy.refused(copy.reasons.generated(label));
    if (problem.problem === "noRowHere") return copy.refused(copy.reasons.noRowHere(label, target?.tables[problem.table]?.name ?? ""));
    return copy.refused(problem.problem === "truncated" ? copy.reasons.keyTruncated(label) : copy.reasons.keyGenerated(label));
  }
  return null;
}

/** O que o leitor do comando diz do texto do resultado, para a coluna inteira (RN-EDIT-018): o limite de linhas sem `ORDER BY`, algum limite, o `TABLESAMPLE`. */
export type CommandLimits = { limitWithoutOrder: boolean; limited: boolean; sample: boolean };

/** Os modificadores do Informix entre o `SELECT` e a lista, cada um com um número depois (`SELECT SKIP 2 FIRST 5 …`, `SELECT LIMIT 5 …`). */
const informixHead = new Set(["skip", "first", "limit", "middle"]);

/** A palavra é parte de um nome qualificado (`t.limit`), e não palavra do comando. */
const qualified = (list: readonly SqlToken[], at: number) => list[at - 1]?.text === "." || list[at + 1]?.text === ".";

/** O número de um modificador do Informix: uma constante ou um parâmetro. */
const isCount = (token: SqlToken | undefined) => token !== undefined && ((token.word && token.text.charCodeAt(0) >= 48 && token.text.charCodeAt(0) <= 57) || token.text === "?");

/**
 * RN-EDIT-018: lê o texto do comando pelo leitor do projeto (`sqlTokens`: texto, nomes entre aspas e comentários não contam), como o da API (`WholeColumnSql`):
 * `LIMIT`, `OFFSET`, `FETCH FIRST|NEXT`, e no Informix os `SKIP`, `FIRST`, `LIMIT` e `MIDDLE` logo depois do `SELECT`, no nível de fora ou dentro de
 * parênteses, sem um `ORDER BY` no mesmo nível; algum limite (com a ordem, a pergunta avisa dos empates); e o `TABLESAMPLE`. `filter` é o filtro do resultado
 * (RN-GRADE-011), que a API junta ao comando: o `ORDER BY` dele, no nível de fora, é a ordem de fora.
 */
export function commandLimits(sql: string, engine: Engine | undefined, filter?: string): CommandLimits {
  const list = sqlTokens(sql, engine);
  const scopes: { limit: boolean; order: boolean }[] = [{ limit: false, order: false }];
  let limitWithoutOrder = false;
  let limited = false;
  let sample = false;

  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (token.text === "(") {
      scopes.push({ limit: false, order: false });
      continue;
    }
    if (token.text === ")") {
      if (scopes.length > 1) {
        const closed = scopes.pop()!;
        limitWithoutOrder ||= closed.limit && !closed.order;
      }
      continue;
    }
    if (!token.word || qualified(list, at)) continue;
    const scope = scopes[scopes.length - 1];
    const next = list[at + 1];
    if (token.text === "order" && next?.word === true && next.text === "by") scope.order = true;
    else if (token.text === "limit" || token.text === "offset" || (token.text === "fetch" && next?.word === true && (next.text === "first" || next.text === "next"))) scope.limit = limited = true;
    else if (token.text === "tablesample") sample = true;
    else if (token.text === "select" && engine === 3) {
      while (list[at + 1]?.word === true && informixHead.has(list[at + 1].text) && isCount(list[at + 2])) {
        scope.limit = limited = true;
        at += 2;
      }
    }
  }

  const outer = scopes[0];
  if (filter !== undefined && outer.limit && !outer.order) outer.order = filterOrders(filter, engine);
  limitWithoutOrder ||= outer.limit && !outer.order;
  return { limitWithoutOrder, limited, sample };
}

/** O filtro do resultado tem `ORDER BY` no nível de fora. */
function filterOrders(filter: string, engine: Engine | undefined): boolean {
  const list = sqlTokens(filter, engine);
  let depth = 0;
  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (token.text === "(") depth++;
    else if (token.text === ")") depth = Math.max(depth - 1, 0);
    else if (depth === 0 && token.word && token.text === "order" && list[at + 1]?.text === "by") return true;
  }
  return false;
}

/**
 * RN-EDIT-018: por que a coluna inteira não vale neste resultado (nulo quando vale), na ordem da regra, sem consulta além da do alvo da edição: pelo alvo (a
 * junção, a coluna da chave, a coluna da chave com o nome repetido no resultado), pela página (o `read` falso) e pelo texto do comando que a tela executou
 * (o limite sem ordem, o `TABLESAMPLE`). O motivo vem cru: quem mostra o põe em "Indisponível: …". As regras da célula ativa (o resultado, a tabela, a coluna,
 * o somente leitura) são conferidas antes, por quem chama. Sem o alvo, só as da página e do texto.
 */
export function wholeColumnBlocker({ target, column, columns, read, sql, filter, engine }: { target: EditTarget | null; column: number; columns: readonly QueryColumn[]; read: boolean | null | undefined; sql: string; filter?: string; engine: Engine | undefined }): string | null {
  if (target !== null) {
    if (isJoin(target) || !target.rowOperations) return copy.wholeReasons.join;
    const table = target.tables[0];
    const base = target.columns[column]?.baseColumn ?? null;
    if (table !== undefined && base !== null && table.key.some((position) => target.columns[position]?.baseColumn === base)) return copy.wholeReasons.key(base, table.name);
    for (const position of table?.key ?? []) {
      const name = columns[position]?.name;
      if (name !== undefined && columns.filter((item) => item.name === name).length > 1) return copy.wholeReasons.repeatedKey(name, table!.name);
    }
  }
  if (read === false) return copy.wholeReasons.notRead;
  const limits = commandLimits(sql, engine, filter);
  if (limits.limitWithoutOrder) return copy.wholeReasons.limit;
  if (limits.sample) return copy.wholeReasons.sample;
  return null;
}

/** O valor como o "Ver SQL" o escreve (RN-EDIT-008): o literal do banco, ou `?` quando ele não tem um (caractere de controle); o nulo é `NULL`. */
export function literalOf(engine: Engine | undefined, value: EditValue, kind: QueryColumn["kind"]): string {
  if (value === null) return "NULL";
  if (engine === undefined) return kind === "number" && /^-?\d+(\.\d+)?$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
  return sqlLiteral(engine, value, kind) ?? "?";
}

/** O literal da faixa e do cabeçalho, cortado em 60 caracteres (pontos de código) com reticências (RN-EDIT-018); o valor enorme não é percorrido inteiro. */
function shortLiteral(literal: string): string {
  if (literal.length <= 60) return literal;
  let kept = "";
  let count = 0;
  for (const character of literal) {
    if (count === 60) return `${kept}…`;
    kept += character;
    count += 1;
  }
  return kept;
}

/** "preco = 10.00": a coluna inteira como a faixa, o cabeçalho e a pergunta a escrevem. */
export function assignmentOf(engine: Engine | undefined, column: QueryColumn | undefined, value: EditValue): string {
  return copy.assignment(column?.name ?? "", shortLiteral(literalOf(engine, value, column?.kind ?? "text")));
}

/** RN-EDIT-018: a linha da faixa das pendências, "Em todas as linhas do resultado: preco = 10.00; status = 'A'."; nula sem a coluna inteira. */
export function allRowsLine(edits: PendingEdits, columns: readonly QueryColumn[], engine: Engine | undefined): string | null {
  const wholes = columnEditsOf(edits);
  return wholes.length === 0 ? null : copy.allRows(wholes.map((edit) => assignmentOf(engine, columns[edit.column], edit.value)));
}

/**
 * RN-EDIT-018 e 021: o que a grade desenha da coluna inteira, por coluna: o valor e a dica do cabeçalho ("Alteração pendente em todas as linhas: preco =
 * 10.00", com a nota do Informix sem log que falhou no meio). Um mapa por pendências: desenhar a grade com ele custa o mesmo que sem ele.
 */
export type ColumnPending = { value: EditValue; hint: string; uncertain: boolean };

export function columnPendingOf(edits: PendingEdits, columns: readonly QueryColumn[], engine: Engine | undefined): ReadonlyMap<number, ColumnPending> | null {
  const wholes = columnEditsOf(edits);
  if (wholes.length === 0) return null;
  return new Map(
    wholes.map((edit) => {
      const hint = copy.headerPending(assignmentOf(engine, columns[edit.column], edit.value));
      return [edit.column, { value: edit.value, hint: edit.uncertain === true ? `${hint}\n${copy.uncertain}` : hint, uncertain: edit.uncertain === true }];
    }),
  );
}
