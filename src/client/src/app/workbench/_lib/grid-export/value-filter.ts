import type { Engine } from "@/components/ui/engine-tag";

import type { QueryColumn } from "../query.schema";
import { isInsideComment } from "../sql-statements";
import { quoteIdentifier, sqlLiteral } from "../table-sql";
import { gridExportCopy } from "./grid-export.copy";

export type ValueFilterId = "eq" | "ne" | "gt" | "lt" | "like" | "isNull" | "isNotNull";

/** Uma entrada do menu "Filtrar" de uma célula. `condition` é o texto que vai ao campo de filtro; `null` quando a opção não se aplica (a tela a mostra desabilitada). */
export type ValueFilterOption = { id: ValueFilterId; label: string; condition: string | null };

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

const maxShown = 28;

/**
 * O valor como o rótulo o mostra: quebra de linha, tabulação, os demais controles, os caracteres invisíveis, as marcas de direção de texto (U+202E
 * inverteria o que está em volta) e o par solto viram um espaço só, as pontas são aparadas e o que passa de 28 caracteres (pontos de código, e
 * nunca no meio de um par) é cortado com reticências.
 */
function shown(value: string): string {
  const flat = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Z}]+/gu, " ").trim();
  const points = Array.from(flat);

  return points.length > maxShown ? `${points.slice(0, maxShown - 1).join("")}…` : flat;
}

/**
 * As opções da RN-GRADE-005 para uma célula, sempre as sete, na ordem do menu (igual, diferente, maior, menor, contém, é nulo, não é nulo), para a tela
 * desabilitar a que não se aplica em vez de fazê-la sumir ("Remover filtro" não tem condição e é da tela). Os de nulo valem para qualquer célula.
 * As comparações só valem para célula com valor, não cortada (RN-SQL-011: o valor da tela não é o do banco) e de coluna não binária, e quando o valor
 * vira literal (`sqlLiteral`: quebra de linha, tabulação e os demais controles não; no Informix, também a data e hora com mais de cinco casas e o lógico
 * que não seja `true` nem `false`); `contém` só em coluna de texto e com valor não vazio; maior e menor não valem para o lógico no Informix, que não o ordena.
 * O rótulo leva o valor encurtado quando as comparações valem para ele.
 */
export function valueFilterOptions(engine: Engine, column: QueryColumn, value: string | null, truncated: boolean): ValueFilterOption[] {
  const name = quoteIdentifier(column.name);
  const usable = value !== null && !truncated && column.kind !== "binary";
  const literal = usable ? sqlLiteral(engine, value, column.kind) : null;
  const pattern = usable && column.kind === "text" && value !== "" ? sqlLiteral(engine, likePattern(value), "text") : null;
  const labels = gridExportCopy.filter;
  const labelOf = (base: string) => (usable ? `${base} ${column.kind === "number" ? shown(value) : `“${shown(value)}”`}` : base);
  const compare = (operator: string) => (literal === null ? null : `${name} ${operator} ${literal}`);
  // O Informix não ordena o lógico: `"ativo" > 't'` dá -674 (`Routine (greaterthan) can not be resolved`), provado contra o servidor.
  const ordered = (operator: string) => (engine === 3 && column.kind === "boolean" ? null : compare(operator));

  return [
    { id: "eq", label: labelOf(labels.eq), condition: compare("=") },
    { id: "ne", label: labelOf(labels.ne), condition: compare("<>") },
    { id: "gt", label: labelOf(labels.gt), condition: ordered(">") },
    { id: "lt", label: labelOf(labels.lt), condition: ordered("<") },
    { id: "like", label: labelOf(labels.like), condition: pattern === null ? null : `${name} LIKE ${pattern} ESCAPE '${likeEscape}'` },
    { id: "isNull", label: labels.isNull, condition: `${name} IS NULL` },
    { id: "isNotNull", label: labels.isNotNull, condition: `${name} IS NOT NULL` },
  ];
}

/** A condição sem o espaço das pontas e sem o `;` do FIM, que é só o fim do comando que a pessoa escreveu (como o filtro dos Registros faz). */
function trimmed(condition: string): string {
  let text = condition.trim();
  while (text.endsWith(";")) text = text.slice(0, -1).trimEnd();
  return text;
}

/**
 * Junta a condição de "Filtrar pelo valor" ao que já está no campo (RN-GRADE-005): `(existente) AND (nova)`; campo vazio, só de espaços ou só de `;`
 * vira só a nova, e sem condição nova o campo fica como estava.
 *
 * `existing` é SÓ a parte da condição. O campo dos Registros também carrega a ordem (`ORDER BY …`, RN-TABELA-010), e esta função não a procura nem a
 * trata: quem chama separa o `ORDER BY` do fim do campo ANTES, passa só a condição e recoloca a ordem DEPOIS, com a função da tarefa da ordem. Com a
 * ordem dentro de `existing` o resultado seria `(a = 1 ORDER BY b) AND (…)`, que não é SQL.
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
