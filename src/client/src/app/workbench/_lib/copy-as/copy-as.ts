import type { Engine } from "@/components/ui/engine-tag";

import { duplicateOf, formattingProblems, type FieldProblems, type FormatOptions } from "../data-export/export-options";
import { clipboardLimitBytes, utf8Length, wellFormed, type DocumentColumn, type DocumentContext, type DocumentCounts, type DocumentFormat, type DocumentRow } from "../grid-export/document";
import { buildDocument, documentStepper } from "../grid-export/documents";
import { copyAsCopy } from "./copy-as.copy";
import { noTarget, type CopyTarget } from "./copy-as-choices";

/**
 * O "Copiar como <formato>" e o "Copiar avançado…" (RN-GRADE-003 e 016): o que vai para a área de transferência, montado na tela pelos escritores da
 * exportação (`grid-export/documents.ts`), com o mesmo texto que a API escreveria para as mesmas linhas e opções. Puro, com as peças de fora injetadas
 * (a busca dos valores completos, a área de transferência, a pausa entre as partes): quem liga à grade é a tela, que monta a origem (`CopySource`) da
 * seleção.
 */

/** Uma coluna do que se copia: o nome, o tipo do banco, o da grade e, quando o alvo da edição o diz, se o banco a calcula sempre (`generated`). */
export type CopyColumn = DocumentColumn;

/**
 * Uma linha do que se copia, como a grade a mostra (RN-GRADE-016): `values` com a pendência, a linha marcada para exclusão com o lido e a linha nova com o
 * que foi preenchido (o resto nulo), o binário como `0x…`; `number`, o da grade (`null` na linha nova ainda não salva); `cut`, as colunas que ainda estão
 * cortadas; `generated`, as "gerado pelo banco — execute de novo para ver".
 */
export type CopyRow = DocumentRow;

/**
 * A origem de uma cópia: o que a seleção escolheu (as linhas na ordem da grade e, nelas, as colunas), com o que os formatos pedem dela.
 *
 * - `engine`: o banco da aba, que decide os literais do SQL e as linhas por comando do Informix.
 * - `sourceName`: o nome da origem (RN-EXPORT-006): o da tabela nos Registros, `resultado` (`resultSourceName`) no resultado de um comando.
 * - `table`: a tabela de destino do SQL e do DbUnit, quando se sabe: a dos Registros, ou a do alvo da edição quando ele diz que o resultado é de uma tabela
 *   só (o `tables` com um item só, que não é `elsewhere`, RN-GRADE-020); `null` quando não se sabe.
 */
export type CopySource = { engine: Engine; sourceName: string; table: { schema: string; name: string } | null; columns: readonly CopyColumn[]; rows: readonly CopyRow[] };

/** O que o "Copiar avançado…" copia (RN-GRADE-003): as células escolhidas, as linhas inteiras da seleção, ou todas as linhas carregadas. */
export type CopyScope = "cells" | "rows" | "loaded";

export const copyScopes: readonly CopyScope[] = ["cells", "rows", "loaded"];

/** O nome da origem no resultado de um comando (RN-EXPORT-006). */
export const resultSourceName = "resultado";

/** A tabela de destino da origem como as opções a guardam. */
export const targetOf = (source: Pick<CopySource, "table">): CopyTarget => (source.table === null ? noTarget : { schema: source.table.schema, table: source.table.name });

/** O tamanho de uma origem, que o "Copiar avançado…" mostra em cada escolha ("3 linhas e 2 colunas"). */
export const sourceSize = (source: CopySource) => ({ rows: source.rows.length, columns: source.columns.length });

/** A origem com só estas colunas (posições nela), nesta ordem: as marcas de corte e de "gerado pelo banco" vão junto com a coluna. */
export function pickColumns(source: CopySource, columns: readonly number[]): CopySource {
  const at = new Map(columns.map((column, index) => [column, index]));
  const remap = (list: readonly number[] | undefined) => (list ?? []).flatMap((column) => (at.has(column) ? [at.get(column) ?? column] : []));
  return {
    ...source,
    columns: columns.map((column) => source.columns[column]),
    rows: source.rows.map((row) => ({ number: row.number, values: columns.map((column) => row.values[column]), cut: remap(row.cut), generated: remap(row.generated) })),
  };
}

/**
 * O SQL e o DbUnit precisam da tabela de destino (RN-GRADE-016): a das opções (o campo do "Copiar avançado…"), ou a da origem. Sem nenhuma, o "Copiar como
 * SQL" e o "Copiar como DbUnit" abrem o "Copiar avançado…" com o formato escolhido e o foco no campo da tabela.
 */
export function needsTable(format: DocumentFormat, options: FormatOptions, source: Pick<CopySource, "table">): boolean {
  if (source.table !== null) return false;
  return (format === "sql" && options.sql.table === "") || (format === "dbUnit" && options.dbUnit.table === "");
}

/** As opções com a tabela de destino resolvida: a do campo, ou, vazio, a da origem (como a API faz com a tabela que não veio, RN-EXPORT-011). */
export function resolvedOptions(format: DocumentFormat, options: FormatOptions, source: Pick<CopySource, "table">): FormatOptions {
  if (source.table === null) return options;
  if (format === "sql" && options.sql.table === "") return { ...options, sql: { ...options.sql, table: source.table.name } };
  if (format === "dbUnit" && options.dbUnit.table === "") return { ...options, dbUnit: { ...options.dbUnit, table: source.table.name } };
  return options;
}

/** O documento que a cópia escreve, com a coluna da origem de cada coluna dele (`kept`). */
export type CopyDocument = { context: DocumentContext; rows: readonly CopyRow[]; kept: readonly number[] };

/**
 * O documento que a cópia escreve: as colunas que vão (no SQL sem "Incluir as colunas que o banco calcula", sem as que o alvo diz `generated: always`, como
 * na exportação, RN-EXPORT-011) e as opções resolvidas. `null` quando, tiradas essas, não sobra coluna.
 */
export function copyDocument(format: DocumentFormat, options: FormatOptions, source: CopySource): CopyDocument | null {
  const resolved = resolvedOptions(format, options, source);
  const kept = keptColumns(format, resolved, source);
  if (kept.length === 0) return null;

  const written = kept.length === source.columns.length ? source : pickColumns(source, kept);
  return { context: { engine: source.engine, sourceName: source.sourceName, columns: written.columns, options: resolved }, rows: written.rows, kept };
}

/** As colunas da origem que o documento escreve: todas, menos, no SQL sem "Incluir as colunas que o banco calcula", as que o alvo diz `generated: always`. */
function keptColumns(format: DocumentFormat, options: FormatOptions, source: Pick<CopySource, "columns">): number[] {
  const dropsGenerated = format === "sql" && !options.sql.includeGenerated;
  return source.columns.flatMap((column, index) => (dropsGenerated && column.generated === "always" ? [] : [index]));
}

/**
 * RN-GRADE-016 e RN-EXPORT-011: no SQL, o primeiro nome que aparece duas vezes entre as colunas que vão no `INSERT` (as escolhidas, sem as que o banco calcula
 * quando elas ficam fora), como a exportação confere: duas colunas com o mesmo nome fariam um `INSERT` que o banco recusa. Nos outros formatos, `null`. Lê só
 * os nomes das colunas, sem montar as linhas do documento: o diálogo confere a cada mudança das opções.
 */
export function duplicateColumnOf(format: DocumentFormat, options: FormatOptions, source: Pick<CopySource, "columns">): string | null {
  if (format !== "sql") return null;
  return duplicateOf(keptColumns(format, options, source).map((index) => source.columns[index].name));
}

/** A recusa da coluna repetida do "Copiar como SQL" (RN-GRADE-016), com a causa da exportação; `null` sem ela. */
export function duplicateColumnRefusal(format: DocumentFormat, options: FormatOptions, source: Pick<CopySource, "columns">): string | null {
  const duplicate = duplicateColumnOf(format, options, source);
  return duplicate === null ? null : copyAsCopy.notice.duplicateColumn(duplicate);
}

/**
 * RN-SQL-017: a coluna do documento cuja célula cortada ele escreve com o valor dela, e por isso precisa do valor completo. Não precisa o binário com "Deixar
 * vazio" (nos formatos de dados) ou com "NULL" (no SQL), que sai nulo (RN-EXPORT-006: é assim que se copia uma tabela de imagens sem as imagens), nem, no SQL
 * do Informix, o binário, que não tem literal e deixa a linha comentada com qualquer valor (RN-EXPORT-011).
 */
function writesTheValue(format: DocumentFormat, context: DocumentContext, column: number): boolean {
  if (context.columns[column]?.kind !== "binary") return true;
  if (format === "sql") return context.options.sql.binary !== "null" && context.engine !== 3;
  return context.options[format].binary !== "null";
}

/**
 * RN-SQL-017: as células cortadas que a cópia busca, [linha, coluna] da origem: só as das colunas que o documento escreve (no SQL, fora as que o banco calcula
 * e que ficam fora do `INSERT`), e nelas só as que ele escreve com o valor (`writesTheValue`).
 */
export function cutCellsToFetch(format: DocumentFormat, document: CopyDocument): (readonly [number, number])[] {
  const cells: (readonly [number, number])[] = [];
  document.rows.forEach((row, index) => {
    for (const column of row.cut ?? []) if (writesTheValue(format, document.context, column)) cells.push([index, document.kept[column]]);
  });
  return cells;
}

/**
 * As recusas das opções no "Copiar avançado…" e no "Configurar comandos 'Copiar como'…", cada uma no campo dela, as da etapa Formatação da exportação
 * (RN-EXPORT-006 a 012): a tabela de destino é obrigatória quando a origem não a tem. A coluna repetida do SQL é recusada como na exportação (RN-GRADE-016), em
 * `columns`, o lugar dela na etapa Formatação, com a frase do "Copiar como" (`duplicateColumnRefusal`).
 */
export function copyProblems(format: DocumentFormat, options: FormatOptions, source: CopySource): FieldProblems {
  const problems = formattingProblems(format, options, { engine: source.engine, tableRequired: source.table === null, columns: [] });
  const duplicate = duplicateColumnRefusal(format, options, source);
  return duplicate === null ? problems : { ...problems, columns: duplicate };
}

/**
 * As recusas do "Configurar comandos 'Copiar como'…" (RN-GRADE-017): as do formato, sem a tabela de destino, que é da origem e não aparece nele. As opções
 * valem para qualquer banco: as linhas por comando se conferem também quando a aba é do Informix, que escreve sempre uma.
 */
export function configureProblems(format: DocumentFormat, options: FormatOptions): FieldProblems {
  return formattingProblems(format, options, { engine: undefined, tableRequired: false, columns: [] });
}

/** O que a prévia do "Copiar avançado…" mostra no máximo (RN-GRADE-003): o começo do texto, até 100 linhas e 64 KB. */
export const previewLimits = { lines: 100, units: 64 * 1024 };

const lineBreaks = (text: string) => {
  let count = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) count++;
  return count;
};

/** O texto até a `lines`-ésima linha e até `units` unidades UTF-16, sem partir um par substituto. */
function previewCut(text: string): string {
  let end = text.length;
  let breaks = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    if (++breaks === previewLimits.lines) {
      end = index;
      break;
    }
  }
  if (end > previewLimits.units) {
    end = previewLimits.units;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return text.slice(0, end);
}

/**
 * A prévia (RN-GRADE-003): o começo do texto que sairia, com a célula cortada como a grade a tem (a prévia não pede nada à API), e se há alguma célula
 * cortada na origem (para a frase que diz que a cópia leva os valores completos). Só as linhas que o começo precisa são escritas. No SQL com a coluna repetida,
 * a prévia não mostra o `INSERT` que a cópia recusa: vem vazia, com a recusa (`refusal`), que o diálogo mostra no lugar do texto (RN-GRADE-016).
 */
export function previewOf(format: DocumentFormat, options: FormatOptions, source: CopySource): { text: string; cut: boolean; refusal: string | null } {
  const cut = source.rows.some((row) => (row.cut?.length ?? 0) > 0);
  const refusal = duplicateColumnRefusal(format, options, source);
  if (refusal !== null) return { text: "", cut, refusal };
  const document = copyDocument(format, options, source);
  if (document === null) return { text: "", cut, refusal: null };

  const { writer, write } = documentStepper(format, document.context);
  let text = writer.begin();
  let lines = lineBreaks(text);
  let index = 0;
  while (index < document.rows.length && lines < previewLimits.lines && text.length < previewLimits.units) {
    const part = write(document.rows[index++]);
    text += part;
    lines += lineBreaks(part);
  }
  if (index === document.rows.length) text += writer.end();
  return { text: wellFormed(previewCut(text)), cut, refusal: null };
}

/** O aviso depois de copiar (RN-GRADE-016): quantas linhas, em que formato, e o resumo do que não saiu inteiro, no tom de atenção. */
export function copyAsNotice(format: DocumentFormat, rows: number, counts: DocumentCounts): { tone: "success" | "warning"; text: string } {
  const n = copyAsCopy.notice;
  const parts = [
    n.copied(rows, format),
    ...(counts.cutValues > 0 ? [n.cutValues(counts.cutValues)] : []),
    ...(counts.removedCharacters > 0 ? [n.removed(counts.removedCharacters)] : []),
    ...(counts.skippedRows > 0 ? [n.skipped(counts.skippedRows)] : []),
    ...(counts.notWhole > 0 ? [n.notWhole(counts.notWhole)] : []),
  ];
  return { tone: parts.length > 1 ? "warning" : "success", text: parts.join(" ") };
}

export type CopyRequest = { format: DocumentFormat; options: FormatOptions; source: CopySource };

/**
 * Onde a cópia está: escrevendo o texto (a faixa diz "Copiando…" passado meio segundo), buscando os valores completos ("Buscando os valores completos…") ou,
 * com colunas inteiras, carregando as linhas que faltam (RN-GRADE-023, "Carregando as linhas que faltam… 1.400 linhas").
 */
export type CopyPhase = "writing" | "fetching" | "loading";

/** Um valor completo que a busca trouxe (RN-SQL-017), na linha e na coluna da origem; `null` quando ele não veio. */
export type FetchedValue = { row: number; column: number; value: string | null };

export type CopyDeps = {
  /**
   * Os valores completos das células cortadas `cells` ([linha, coluna] da origem, RN-SQL-017): a mesma origem, linha por linha e coluna por coluna, com o
   * valor inteiro no lugar e as marcas de corte só das que não vieram e das que não foram pedidas; `null` quando a busca foi cancelada. Só é chamada quando
   * há célula cortada que a cópia escreve. `keepGoing` recebe cada lote que chegou, menos o último, e diz se a busca continua: falso quando o texto já passou
   * do limite, e aí a resposta vem com `stopped`.
   */
  complete: (source: CopySource, cells: readonly (readonly [number, number])[], keepGoing: (batch: readonly FetchedValue[]) => boolean, signal: AbortSignal | undefined) => Promise<{ source: CopySource; stopped: boolean } | null>;
  /** Põe o texto na área de transferência (`navigator.clipboard.writeText`); `false` quando ela recusa. */
  write: (text: string) => Promise<boolean>;
  signal?: AbortSignal;
  pause?: () => Promise<void>;
  onPhase?: (phase: CopyPhase) => void;
  /** O teto em bytes; o padrão é o da área de transferência, 10 MiB. */
  limitBytes?: number;
};

export type CopyOutcome =
  | { kind: "copied"; text: string; notice: { tone: "success" | "warning"; text: string } }
  /** O SQL ou o DbUnit sem tabela de destino: a tela abre o "Copiar avançado…" com o formato e o foco no campo da tabela. */
  | { kind: "needsTable" }
  /** No SQL, todas as colunas escolhidas são das que o banco calcula, e nenhuma iria no `INSERT`. */
  | { kind: "noColumns"; message: string }
  /** No SQL, duas colunas que iriam no `INSERT` têm o mesmo nome (a junção com dois `id`), e o banco o recusaria (RN-GRADE-016 e RN-EXPORT-011). */
  | { kind: "duplicateColumn"; message: string }
  | { kind: "tooLarge"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

/** A frase do SQL sem coluna nenhuma, que a especificação não escreve. */
export const noColumnsMessage = 'As colunas escolhidas são todas calculadas pelo banco e ficam fora do INSERT: ligue "Incluir as colunas que o banco calcula" nas opções do SQL.';

/**
 * RN-SQL-017 e RN-GRADE-016: o "para de pedir quando o texto passa do limite" da busca dos valores completos, exato. A cada lote que chega, as linhas do
 * começo que já têm todos os valores pedidos são escritas, como o documento as escreveria, só para medir (o texto não fica); o tamanho delas, em UTF-8, é um
 * piso do texto inteiro, e passado o limite a busca para. O piso vale em todos os formatos: a largura máxima do TXT, o que o HTML e o XML tiram e a linha
 * que o SQL comenta já estão na conta, porque a linha é escrita, e não estimada pelo tamanho do valor.
 */
function fetchMeter(format: DocumentFormat, document: CopyDocument, cells: readonly (readonly [number, number])[], limitBytes: number): (batch: readonly FetchedValue[]) => boolean {
  const { writer, write } = documentStepper(format, document.context);
  const columnOf = new Map(document.kept.map((column, index) => [column, index]));
  const asked = new Map<number, number>();
  for (const [row] of cells) asked.set(row, (asked.get(row) ?? 0) + 1);
  const arrived = new Map<number, Map<number, string | null>>();
  let bytes = utf8Length(writer.begin());
  let next = 0;

  return (batch) => {
    for (const { row, column, value } of batch) {
      const at = columnOf.get(column);
      if (at === undefined) continue;
      const values = arrived.get(row) ?? new Map<number, string | null>();
      values.set(at, value);
      arrived.set(row, values);
    }
    while (next < document.rows.length) {
      const got = arrived.get(next);
      if ((got?.size ?? 0) < (asked.get(next) ?? 0)) break;
      const row = document.rows[next];
      const whole = got === undefined ? row : { ...row, values: row.values.map((value, column) => got.get(column) ?? value), cut: (row.cut ?? []).filter((column) => (got.get(column) ?? null) === null) };
      bytes += utf8Length(write(whole));
      arrived.delete(next);
      next++;
    }
    return bytes <= limitBytes;
  };
}

/**
 * Copia no formato (RN-GRADE-016, RN-GRADE-003): no SQL, recusa a coluna repetida, antes de tudo (a tabela de destino não a resolve); confere a tabela de destino; com célula cortada, monta antes o texto com o que a grade tem (cada valor
 * cortado conta, no mínimo, o que a grade tem dele) e, se ele já passa do limite, para sem buscar nada; busca os valores completos; monta o texto em partes,
 * com o limite de 10 MiB; e o põe na área de transferência, que fica como estava em qualquer recusa. O aviso diz o formato e o resumo.
 */
export async function runCopyAs({ format, options, source }: CopyRequest, deps: CopyDeps): Promise<CopyOutcome> {
  const duplicate = duplicateColumnRefusal(format, options, source);
  if (duplicate !== null) return { kind: "duplicateColumn", message: duplicate };
  if (needsTable(format, options, source)) return { kind: "needsTable" };
  const limitBytes = deps.limitBytes ?? clipboardLimitBytes;
  const control = { limitBytes, signal: deps.signal, pause: deps.pause };
  const tooLarge = { kind: "tooLarge", message: copyAsCopy.notice.tooLarge } as const;

  let current = source;
  let document = copyDocument(format, options, current);
  if (document === null) return { kind: "noColumns", message: noColumnsMessage };

  deps.onPhase?.("writing");
  const cells = cutCellsToFetch(format, document);
  if (cells.length > 0) {
    const first = await buildDocument(format, document.context, document.rows, control);
    if (first.kind !== "built") return first.kind === "tooLarge" ? tooLarge : first;

    deps.onPhase?.("fetching");
    const completed = await deps.complete(current, cells, fetchMeter(format, document, cells, limitBytes), deps.signal);
    if (completed === null || deps.signal?.aborted === true) return { kind: "cancelled" };
    if (completed.stopped) return tooLarge;
    current = completed.source;
    document = copyDocument(format, options, current);
    if (document === null) return { kind: "noColumns", message: noColumnsMessage };
    deps.onPhase?.("writing");
  }

  const built = await buildDocument(format, document.context, document.rows, control);
  if (built.kind !== "built") return built.kind === "tooLarge" ? tooLarge : built;
  // A recusa da área de transferência, e também a exceção dela na hora (sem `navigator.clipboard`), é `failed`: o texto não foi.
  let written: boolean;
  try {
    written = await deps.write(built.text);
  } catch {
    written = false;
  }
  if (!written) return { kind: "failed", message: copyAsCopy.notice.failed };
  return { kind: "copied", text: built.text, notice: copyAsNotice(format, current.rows.length, built.counts) };
}
