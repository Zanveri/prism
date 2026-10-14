import type { Engine } from "@/components/ui/engine-tag";

import { gridFilterCopy } from "../grid-filter.copy";
import type { QueryColumn, QueryRow } from "../query.schema";
import { isInsideComment, sqlTokens } from "../sql-statements";
import { filterParts, fitsFilter, quoteIdentifier, sqlLiteral } from "../table-sql";

const reasons = gridFilterCopy.reasons;

export type ValueFilterId = "eq" | "ne" | "gt" | "lt" | "like" | "isNull" | "isNotNull";

/**
 * Uma entrada do "Valor da célula" do "Filtrar" (RN-GRADE-010 do "Filtrar como no DBeaver"). `condition` é o texto que vai ao campo de filtro, e `label`,
 * a mesma condição como o menu a mostra (com o valor encurtado); `null` quando a opção não se aplica, e então `reason` diz por quê (a tela a mostra
 * desabilitada, com o motivo).
 */
export type ValueFilterOption = { id: ValueFilterId; label: string; condition: string | null; reason: string | null };

/** Os operadores das comparações, na ordem do menu: igual, diferente, maior e menor. */
export type CompareOperator = "eq" | "ne" | "gt" | "lt";

export const compareOperators: readonly CompareOperator[] = ["eq", "ne", "gt", "lt"];

const operatorText: Record<CompareOperator, string> = { eq: "=", ne: "<>", gt: ">", lt: "<" };

/**
 * O caractere de escape do `LIKE` de "contém". `!` e não a barra invertida: ele não tem papel nenhum dentro de um literal de texto dos três
 * bancos, enquanto a barra invertida tem (o PostgreSQL a lê como escape dentro de `E'...'`, RN-TABELA-007).
 */
export const likeEscape = "!";

/**
 * O padrão do "contém": `%valor%` com os curingas do PRÓPRIO valor (`%` e `_`) e o escape (`!`) precedidos do escape, para valerem como texto. É o
 * `LIKE padrão ESCAPE '!'` do padrão SQL, aceito pelo PostgreSQL, pelo Db2 e pelo Informix, que casa exatamente os textos que contêm o valor.
 */
export function likePattern(value: string): string {
  return `%${value.replace(/[!%_]/g, `${likeEscape}$&`)}%`;
}

/** Quantos caracteres (pontos de código) de cada parte (o nome, o literal) o rótulo mostra. */
const maxShown = 30;

/**
 * Um pedaço da condição como o rótulo o mostra: os controles, os invisíveis, as marcas de direção de texto (U+202E inverteria o que está em volta), os
 * separadores de linha e de parágrafo e o par solto viram um espaço, e o que passa de 30 caracteres (pontos de código, e nunca no meio de um par) é
 * cortado com reticências. Só o rótulo: a condição que vai ao campo é a inteira.
 */
export function shownPart(text: string): string {
  const flat = text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+/gu, " ");
  const points = Array.from(flat);

  return points.length > maxShown ? `${points.slice(0, maxShown - 1).join("")}…` : flat;
}

/** Por que o valor da célula não vira literal: controle (não cabe numa linha), ou o Informix, que só aceita algumas formas de lógico e de data e hora. */
function literalReason(value: string): string {
  return fitsFilter(value) ? reasons.informix : reasons.controls;
}

/**
 * As opções do "Valor da célula" para uma célula, sempre as sete, na ordem do menu (igual, diferente, maior, menor, contém, é nulo, não é nulo), para a tela
 * desabilitar a que não se aplica em vez de fazê-la sumir. Os de nulo valem para qualquer célula. As comparações só valem para célula com valor, não cortada
 * (RN-SQL-011: o valor da tela não é o do banco) e de coluna não binária, e quando o valor vira literal (`sqlLiteral`: quebra de linha, tabulação e os demais
 * controles não; no Informix, também a data e hora com mais de cinco casas e o lógico que não seja `true` nem `false`); `contém` só em coluna de texto e com
 * valor não vazio; maior e menor não valem para o lógico no Informix, que não o ordena. O rótulo é a condição como ela entra no campo, com o nome e o literal
 * encurtados; a que não se aplica mostra o operador com "(valor da célula)" no lugar do valor.
 */
export function valueFilterOptions(engine: Engine, column: QueryColumn, value: string | null, truncated: boolean): ValueFilterOption[] {
  const name = quoteIdentifier(column.name);
  const shownName = shownPart(name);
  const blocked = value === null ? reasons.nullCell : truncated ? reasons.truncated : column.kind === "binary" ? reasons.binary : null;
  const literal = blocked === null && value !== null ? sqlLiteral(engine, value, column.kind) : null;
  const unusable = blocked ?? (literal === null && value !== null ? literalReason(value) : null);
  // O Informix não ordena o lógico: `"ativo" > 't'` dá -674 (`Routine (greaterthan) can not be resolved`), provado contra o servidor.
  const unordered = engine === 3 && column.kind === "boolean" ? reasons.informixOrder : null;

  const compare = (id: CompareOperator): ValueFilterOption => {
    const operator = operatorText[id];
    const reason = unusable ?? (id === "gt" || id === "lt" ? unordered : null);
    if (reason !== null || literal === null) return { id, label: `${shownName} ${operator} ${gridFilterCopy.menu.noValue}`, condition: null, reason: reason ?? reasons.nullCell };
    return { id, label: `${shownName} ${operator} ${shownPart(literal)}`, condition: `${name} ${operator} ${literal}`, reason: null };
  };

  const like = (): ValueFilterOption => {
    const reason = column.kind !== "text" ? reasons.textOnly : (unusable ?? (value === "" ? reasons.emptyLike : null));
    const pattern = reason === null && value !== null ? sqlLiteral(engine, likePattern(value), "text") : null;
    if (pattern === null) return { id: "like", label: `${shownName} LIKE ${gridFilterCopy.menu.noValue}`, condition: null, reason: reason ?? reasons.controls };
    return { id: "like", label: `${shownName} LIKE ${shownPart(pattern)}`, condition: `${name} LIKE ${pattern} ESCAPE '${likeEscape}'`, reason: null };
  };

  return [
    ...compareOperators.map(compare),
    like(),
    { id: "isNull", label: `${shownName} IS NULL`, condition: `${name} IS NULL`, reason: null },
    { id: "isNotNull", label: `${shownName} IS NOT NULL`, condition: `${name} IS NOT NULL`, reason: null },
  ];
}

/** Uma entrada do "Personalizado": o rótulo (`"coluna" = …`), e o motivo quando não se aplica. A condição só existe depois de a pessoa escrever o valor. */
export type CustomFilterOption = { id: CompareOperator; label: string; reason: string | null };

/** As quatro comparações do "Personalizado" (`=`, `<>`, `>` e `<`), que pedem o valor num campo; maior e menor não valem para o lógico no Informix. */
export function customFilterOptions(engine: Engine, column: QueryColumn): CustomFilterOption[] {
  const name = shownPart(quoteIdentifier(column.name));
  const unordered = engine === 3 && column.kind === "boolean" ? reasons.informixOrder : null;
  return compareOperators.map((id) => ({ id, label: `${name} ${operatorText[id]} ${gridFilterCopy.menu.typed}`, reason: id === "gt" || id === "lt" ? unordered : null }));
}

/** O operador do "Personalizado" com o nome, para o rótulo do campo do valor (`"coluna" =`). */
export function customPrefix(column: QueryColumn, operator: CompareOperator): string {
  return `${shownPart(quoteIdentifier(column.name))} ${operatorText[operator]}`;
}

/**
 * A condição do "Personalizado" com o valor que a pessoa escreveu: o valor vira literal pela mesma regra da célula (RN-TABELA-007, `sqlLiteral`), e nunca
 * entra como SQL. `null` quando o valor não vira literal (caractere de controle; no Informix, as formas que o servidor não aceita).
 */
export function customCondition(engine: Engine, column: QueryColumn, operator: CompareOperator, typed: string): { condition: string } | { problem: "controls" | "informix" } {
  const literal = sqlLiteral(engine, typed, column.kind);
  if (literal === null) return { problem: fitsFilter(typed) ? "informix" : "controls" };
  return { condition: `${quoteIdentifier(column.name)} ${operatorText[operator]} ${literal}` };
}

/** Um valor distinto de uma coluna, nas linhas carregadas: quantas vezes aparece e se entra no filtro (o cortado e o que não vira literal não entram). */
export type DistinctValue = { value: string | null; count: number; usable: boolean };

/**
 * Os valores distintos de uma coluna nas linhas carregadas, para o "Filtrar por valor…": cada um com quantas vezes aparece, do mais frequente para o
 * menos (empate: o que aparece primeiro na grade). O nulo é um valor como os outros. A célula cortada (RN-SQL-011) é contada à parte, como um valor que
 * não entra no filtro: o texto da tela não é o do banco.
 */
export function distinctValues(engine: Engine, column: QueryColumn, rows: readonly QueryRow[], columnIndex: number, truncated: ReadonlyMap<number, ReadonlySet<number>>): DistinctValue[] {
  const found = new Map<string, DistinctValue & { first: number }>();

  rows.forEach((row, index) => {
    const value = row[columnIndex] ?? null;
    const cut = value !== null && truncated.get(index)?.has(columnIndex) === true;
    const key = value === null ? "n" : `${cut ? "c" : "v"}${value}`;
    const held = found.get(key);
    if (held !== undefined) held.count++;
    else found.set(key, { value, count: 1, usable: value === null || (!cut && sqlLiteral(engine, value, column.kind) !== null), first: index });
  });

  return [...found.values()].sort((a, b) => b.count - a.count || a.first - b.first).map(({ value, count, usable }) => ({ value, count, usable }));
}

/**
 * A condição dos valores marcados no "Filtrar por valor…": `coluna IN (…)`, ou `coluna = valor` com um valor só, e o nulo marcado como `coluna IS NULL`,
 * juntos por `OR`. Os valores viram literal pela RN-TABELA-007; o que não vira não entra (a lista não deixa marcá-lo). `null` sem nada marcado.
 */
export function valuesCondition(engine: Engine, column: QueryColumn, chosen: readonly (string | null)[]): string | null {
  const name = quoteIdentifier(column.name);
  const literals = [...new Set(chosen.flatMap((value) => (value === null ? [] : [sqlLiteral(engine, value, column.kind)])).filter((literal): literal is string => literal !== null))];
  const parts = [literals.length === 1 ? `${name} = ${literals[0]}` : literals.length > 1 ? `${name} IN (${literals.join(", ")})` : null, chosen.includes(null) ? `${name} IS NULL` : null].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(" OR ");
}

/** A condição sem o espaço das pontas e sem o `;` do FIM, que é só o fim do comando que a pessoa escreveu (como o filtro dos Registros faz). */
function trimmed(condition: string): string {
  let text = condition.trim();
  while (text.endsWith(";")) text = text.slice(0, -1).trimEnd();
  return text;
}

/**
 * Junta a condição do "Filtrar" à condição que já está no campo: `(existente) AND (nova)`; campo vazio, só de espaços ou só de `;` vira só a nova, e sem
 * condição nova o campo fica como estava.
 *
 * `existing` é SÓ a parte da condição. O campo também carrega a ordem (`ORDER BY …`, RN-TABELA-010), e esta função não a procura nem a trata: quem junta
 * o campo inteiro é `joinFilter`, que separa a ordem antes e a recoloca depois.
 *
 * Um comentário `--` no fim da condição existente engoliria o parêntese e a condição nova; então, e só então, uma quebra de linha o encerra antes do
 * parêntese (o comentário de bloco fechado no fim também a leva, sem prejuízo).
 */
export function mergeCondition(existing: string, added: string): string {
  const current = trimmed(existing);
  const next = trimmed(added);
  if (current === "") return next;
  if (next === "") return current;

  return `(${current}${isInsideComment(current, current.length - 1) ? "\n" : ""}) AND (${next})`;
}

/**
 * O texto do campo fecha tudo o que abre? Um `)` depois dele (numa linha nova, que encerra o `--` nos três bancos) tem de ser um pedaço de código, e não
 * parte de um texto entre aspas, de um comentário de bloco, do `{ … }` do Informix ou de um `$tag$` do PostgreSQL que ficou aberto.
 */
function closes(text: string, engine: Engine): boolean {
  const last = sqlTokens(`${text}\n)`, engine).at(-1);
  return last !== undefined && last.text === ")" && last.start === text.length + 1;
}

/**
 * O texto do campo tem um `;` que não é o do fim (fora de aspas e de comentário)? No comando dos Registros (`SELECT … WHERE <campo>`) ele separaria dois
 * comandos, mesmo no começo do campo (`; a = 1`), e a condição nova juntada a ele também.
 */
function separates(text: string, engine: Engine): boolean {
  const tokens = sqlTokens(text, engine);
  let last = tokens.length;
  while (last > 0 && tokens[last - 1].text === ";") last--;
  return tokens.slice(0, last).some((token) => token.text === ";");
}

/** O que `joinFilter` devolve: o texto novo do campo, ou por que a condição não se junta com segurança. */
export type JoinedFilter = { text: string } | { problem: "several" | "open" };

/**
 * O texto do campo de filtro com a condição do "Filtrar" junta ao que estava lá (RN-GRADE-010 do "Filtrar"): por `AND`, entre parênteses
 * (`mergeCondition`), com a ordem e o que vem depois dela (`ORDER BY …`, o `;`, o comentário do fim) recolocados como estavam (`filterParts`).
 *
 * Não se junta, e o item fica desabilitado com o motivo, quando o campo tem mais de um comando (`several`) ou deixa aberto um texto entre aspas, um
 * comentário de bloco ou um `$tag$` (`open`): a condição nova cairia dentro dele. A condição existente nunca termina num comentário (ele fica na
 * parte de depois), então o campo continua numa linha só.
 */
export function joinFilter(engine: Engine, field: string, added: string): JoinedFilter {
  if (separates(field, engine)) return { problem: "several" };
  if (!closes(field, engine)) return { problem: "open" };

  const { condition, tail } = filterParts(field, engine);
  return { text: [mergeCondition(condition, added), tail].filter((part) => part !== "").join(" ") };
}
