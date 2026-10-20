import type { Engine } from "@/components/ui";

import { fold } from "../navigator-search";
import { dataImportCopy } from "./data-import.copy";
import type { ImportTable, MappingEntry, PreviewRow, TableColumn } from "./imports.schema";

/**
 * O mapeamento das colunas (RN-IMPORT-009 e 024), o mesmo da importação e da cópia, sem React: uma escolha por coluna do arquivo (ou da origem), na ordem
 * dela, com o nome da coluna da tabela ou `null` ("Não importar"). As marcas, os motivos de uma coluna não valer, o automático pelo nome, o que fica com o
 * padrão da tabela e os avisos saem daqui; a tela só desenha.
 */

/** A escolha de cada coluna do arquivo, pela posição dela: o nome da coluna da tabela, ou `null` ("Não importar"). */
export type Targets = readonly (string | null)[];

const m = dataImportCopy.mapping;

/** O mapeamento do pedido: as colunas que recebem valor, na ordem do arquivo. */
export function entriesOf(targets: Targets): MappingEntry[] {
  return targets.flatMap((target, source) => (target === null ? [] : [{ source, target }]));
}

/** O mapeamento da resposta da API, posto nas colunas do arquivo; a posição que não existe na leitura fica de fora. */
export function targetsOf(entries: readonly MappingEntry[], sources: number): (string | null)[] {
  const targets: (string | null)[] = Array.from({ length: sources }, () => null);
  for (const entry of entries) if (entry.source >= 0 && entry.source < sources && targets[entry.source] === null) targets[entry.source] = entry.target;
  return targets;
}

export const mappedCount = (targets: Targets) => targets.filter((target) => target !== null).length;

/** "Escolha ao menos uma coluna da tabela para receber valores.": sem nenhuma mapeada, "Avançar" fica desabilitado. */
export function noneMappedProblem(targets: Targets): string | null {
  return mappedCount(targets) === 0 ? m.noneMapped : null;
}

/** A marca que vale para a coluna da tabela: a obrigatória, a que o banco preenche (a identidade por padrão, o serial) ou a que ele calcula. */
export type ColumnMark = "required" | "filledByDatabase" | "computedByDatabase";

export function columnMark(column: TableColumn): ColumnMark | null {
  if (column.generated === "always") return "computedByDatabase";
  if (column.generated === "byDefault") return "filledByDatabase";
  if (!column.nullable && (column.defaultValue ?? null) === null) return "required";
  return null;
}

export const markLabel: Record<ColumnMark, string> = { required: m.required, filledByDatabase: m.filledByDatabase, computedByDatabase: m.computedByDatabase };

/**
 * Por que a coluna da tabela não pode ser escolhida (RN-IMPORT-009, 010 e 024), ou `null`: a calculada pelo banco, a de um tipo que o Prism não importa naquele
 * banco (o motivo da API, quando vem) e, na cópia, o par em que só um dos lados é binário (`pairBlocker`).
 */
export function columnBlocker(column: TableColumn, pairBlocker: string | null = null): string | null {
  if (column.generated === "always") return m.computedReason;
  if (!column.importable) return column.reason ?? m.typeReason;
  return pairBlocker;
}

/** A nota da escolha do `money` do PostgreSQL de destino, que o banco lê pelo formato de moeda do servidor (RN-IMPORT-010). */
export function columnNote(column: TableColumn, engine: Engine | undefined): string | null {
  return engine === 1 && /^money\b/i.test(column.type.trim()) ? m.money : null;
}

/** Como o automático compara os nomes que não são iguais letra por letra: sem caixa nem acento, e o espaço, o hífen e o sublinhado iguais (RN-IMPORT-009). */
export const nameKey = (name: string) => fold(name).replace(/[\s\-_]/g, "_");

/**
 * O mapeamento automático (RN-IMPORT-009). Pelo nome (com cabeçalho, no JSON e na cópia): primeiro a coluna da tabela de nome igual, letra por letra; sem ela,
 * a igual pelo `nameKey`, quando é uma só (com duas, a coluna do arquivo fica sem, e entra em `ambiguous`, para a dica). Duas colunas do arquivo que casam com
 * a mesma da tabela: a primeira fica com ela. Pela posição (sem cabeçalho): a coluna N do arquivo vai para a N da tabela. A coluna que não pode ser escolhida
 * (`blocked`, por posição da coluna do arquivo e nome da coluna da tabela) nunca é escolhida.
 */
export function autoTargets(
  sources: readonly string[],
  table: Pick<ImportTable, "columns">,
  { byName, blocked = () => null }: { byName: boolean; blocked?: (source: number, column: TableColumn) => string | null },
): { targets: (string | null)[]; ambiguous: ReadonlySet<number> } {
  const targets: (string | null)[] = sources.map(() => null);
  const ambiguous = new Set<number>();
  const taken = new Set<string>();
  const allowed = (source: number, column: TableColumn) => columnBlocker(column, blocked(source, column)) === null;

  sources.forEach((name, source) => {
    if (!byName) {
      const column = table.columns[source];
      if (column !== undefined && allowed(source, column) && !taken.has(column.name)) {
        targets[source] = column.name;
        taken.add(column.name);
      }
      return;
    }
    const candidates = table.columns.filter((column) => allowed(source, column));
    const exact = candidates.filter((column) => column.name === name);
    let chosen: TableColumn | undefined = exact[0];
    if (chosen === undefined) {
      const key = nameKey(name);
      const loose = candidates.filter((column) => nameKey(column.name) === key);
      if (loose.length > 1) ambiguous.add(source);
      else chosen = loose[0];
    }
    if (chosen !== undefined && !taken.has(chosen.name)) {
      targets[source] = chosen.name;
      taken.add(chosen.name);
    }
  });
  return { targets, ambiguous };
}

/**
 * A escolha à mão (RN-IMPORT-009): a coluna da tabela que já recebia outra coluna do arquivo sai dela, que passa a "Não importar", e a resposta diz qual foi,
 * para a frase com papel de estado ("total deixou de receber Total (R$).").
 */
export function chooseTarget(targets: Targets, source: number, target: string | null): { targets: (string | null)[]; moved: { target: string; from: number } | null } {
  let moved: { target: string; from: number } | null = null;
  const next = targets.map((current, index) => {
    if (index === source) return target;
    if (target !== null && current === target) {
      moved = { target, from: index };
      return null;
    }
    return current;
  });
  return { targets: next, moved };
}

/** A frase de quem deixou de receber (`chooseTarget`). */
export const movedText = (moved: { target: string; from: number }, sources: readonly string[]) => m.moved(moved.target, sources[moved.from] ?? "");

/**
 * O mapeamento que continua depois de ler o arquivo de novo (RN-IMPORT-011): nas colunas do arquivo que continuam lá, pelo nome (com cabeçalho, no JSON e
 * na cópia), ou pela posição (sem cabeçalho); as que sumiram saem dele. Com o nome repetido, vale a primeira ocorrência.
 */
export function carryTargets(before: readonly string[], after: readonly string[], targets: Targets, byName: boolean): (string | null)[] {
  if (!byName) return after.map((_name, index) => targets[index] ?? null);
  const byNameMap = new Map<string, string | null>();
  before.forEach((name, index) => {
    if (!byNameMap.has(name)) byNameMap.set(name, targets[index] ?? null);
  });
  const used = new Set<string>();
  return after.map((name) => {
    const target = byNameMap.get(name) ?? null;
    if (target === null || used.has(target)) return null;
    used.add(target);
    return target;
  });
}

/** O que fica com o padrão da tabela (RN-IMPORT-009): as colunas que não recebem coluna do arquivo, cada uma com o padrão, a marca ou "nulo". */
export function stayingDefaults(table: Pick<ImportTable, "columns">, targets: Targets): { name: string; value: string }[] {
  const mapped = new Set(targets.filter((target): target is string => target !== null));
  return table.columns
    .filter((column) => !mapped.has(column.name))
    .map((column) => {
      const mark = columnMark(column);
      if (mark === "computedByDatabase" || mark === "filledByDatabase") return { name: column.name, value: markLabel[mark] };
      return { name: column.name, value: column.defaultValue ?? m.nullDefault };
    });
}

/**
 * Os avisos do mapeamento, no tom de atenção (RN-IMPORT-009): a obrigatória que não recebe valor (uma frase para todas), a preenchida pelo banco que recebe
 * valor (fora do Informix, em que o `SERIAL` passa a contar do maior valor) e a que não aceita nulo, tem padrão e recebe uma coluna (o nulo vai como nulo).
 */
export function mappingWarnings(table: Pick<ImportTable, "columns">, targets: Targets, { engine, copy }: { engine: Engine | undefined; copy: boolean }): string[] {
  const mapped = new Set(targets.filter((target): target is string => target !== null));
  const warnings: string[] = [];
  const required = table.columns.filter((column) => columnMark(column) === "required" && !mapped.has(column.name)).map((column) => column.name);
  if (required.length > 0) warnings.push(m.requiredWarning(required));
  for (const column of table.columns) {
    if (!mapped.has(column.name)) continue;
    if (column.generated === "byDefault" && engine !== 3) warnings.push(m.byDefaultWarning(column.name, copy));
    if (!column.nullable && column.generated == null && column.defaultValue != null) warnings.push(m.notNullDefaultWarning(column.name, column.defaultValue, copy));
  }
  return warnings;
}

/**
 * O resumo da prévia convertida (RN-IMPORT-011): quantos valores não convertem (o problema da linha inteira conta como um) e a linha do arquivo em que a
 * importação vai parar (a primeira com problema), ou `null` quando as linhas convertem. A linha completada com nulo não é problema.
 */
export function previewSummary(rows: readonly PreviewRow[]): { rows: number; problems: number; stopLine: number | null } {
  let problems = 0;
  let stopLine: number | null = null;
  for (const row of rows) {
    const count = (row.problem == null ? 0 : 1) + row.cells.filter((cell) => cell.problem != null).length;
    if (count > 0 && stopLine === null) stopLine = row.line;
    problems += count;
  }
  return { rows: rows.length, problems, stopLine };
}

/** A frase do resumo, em cima da prévia convertida. */
export function previewSummaryText(summary: ReturnType<typeof previewSummary>): string {
  if (summary.stopLine === null) return m.convertsAll(summary.rows);
  return m.problems(summary.problems, summary.rows, summary.stopLine);
}

/** "8 de 10 colunas do arquivo, em 8 das 12 colunas da tabela", com os pares na dica ("Nome → nome"). */
export function columnsSummary(sources: readonly string[], targets: Targets, tableColumns: number, copy: boolean): { text: string; pairs: string } {
  const mapped = mappedCount(targets);
  const text = dataImportCopy.confirmation.columnsOf(mapped, sources.length, mapped, tableColumns, copy);
  const pairs = targets.flatMap((target, index) => (target === null ? [] : [dataImportCopy.confirmation.pair(sources[index] ?? "", target)])).join(", ");
  return { text, pairs };
}

/** O comando que o aviso da RN-PROT-001 mostra: os nomes entre aspas duplas, com a aspa de dentro dobrada (RN-TABELA-002), e só as colunas mapeadas. */
export function insertPreview(schema: string, table: string, targets: Targets): string {
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const columns = targets.filter((target): target is string => target !== null).map(quote);
  return `INSERT INTO ${quote(schema)}.${quote(table)} (${columns.join(", ")}) VALUES (…)`;
}

export function deletePreview(schema: string, table: string): string {
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  return `DELETE FROM ${quote(schema)}.${quote(table)}`;
}
