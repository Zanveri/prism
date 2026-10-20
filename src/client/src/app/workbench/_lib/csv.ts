import { exportFileName } from "../../../../electron/file-name";

import type { RowsState } from "./use-query-runner";
import { workbenchCopy } from "./workbench.copy";

/**
 * O CSV das linhas carregadas (RN-TABELA-006): UTF-8 com BOM (o Excel o lê em UTF-8 só com ele), separador
 * `;` (o que o Excel em português espera), aspas dobradas e CRLF no fim de cada linha.
 */
export const csvBom = "\uFEFF";

const needsQuotes = /[;"\r\n]/;

/** Uma planilha executa como fórmula o campo cujo primeiro caractere, depois de espaços, tabulação e retorno de carro (ela os ignora), é `=`, `+`, `-` ou `@`. */
const startsAsFormula = /^[ \t\r]*[=+\-@]/;

/**
 * Um número simples, negativo ou não, com vírgula ou ponto decimal e expoente se tiver: dígitos, no máximo um separador, e nada mais. Não pode
 * ser fórmula (`-1+1` tem mais que isso), e a coluna que o recebe segue somando.
 */
const simpleNumber = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Um campo do CSV (RN-TABELA-006). O nulo é um campo vazio. O valor cujo primeiro caractere depois de espaços, tabulação ou retorno de carro é `=`,
 * `+`, `-` ou `@` vai precedido de um apóstrofo, para a planilha não o executar; o número simples, inclusive o negativo (`-1,5`), sai como está
 * (a regra olha o texto, e não o tipo da coluna). O que tem `;`, aspa ou quebra de linha vai entre aspas, com a aspa dobrada.
 */
export function csvFieldOf(value: string | null): string {
  if (value === null) return "";

  const guarded = startsAsFormula.test(value) && !simpleNumber.test(value) ? `'${value}` : value;
  return needsQuotes.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** O arquivo: o BOM, a linha dos nomes das colunas e uma linha por registro, cada uma terminada por CRLF. */
export function toCsv(columns: readonly string[], rows: readonly (readonly (string | null)[])[]): string {
  const lines = [columns.map(csvFieldOf), ...rows.map((row) => row.map(csvFieldOf))];
  return `${csvBom}${lines.map((line) => `${line.join(";")}\r\n`).join("")}`;
}

/**
 * O nome que o diálogo de salvar propõe: `esquema.tabela.csv`, sem o que o sistema de arquivos recusa (caracteres de controle e de direção saem; o que o Windows
 * não aceita vira `_`) e, se o que vem antes do primeiro ponto é um nome de dispositivo do Windows (`con.pedido.csv` não abre), com um `_` na frente. As regras
 * moram em `electron/file-name.ts` (`safeFileBase`), as mesmas do "Exportar dados" e do processo principal (RN-EXPORT-014 e 019): o corte em 120 é por ponto de
 * código, sem partir um par substituto.
 */
export function csvFileName(schema: string, name: string): string {
  return exportFileName(`${schema}.${name}`, "csv");
}

/**
 * O aviso depois de exportar (RN-TABELA-006): quantas linhas saíram e, havendo mais a ler, que as que ainda não
 * foram carregadas não entram. O valor que chegou cortado (RN-SQL-011) sai inteiro (RN-SQL-017); o que não pôde vir
 * inteiro (`cut`) sai cortado, e o aviso diz quantos.
 */
export function exportNotice(rows: { count: number; hasMore: boolean; cut: number }): { tone: "success" | "warning"; text: string } {
  const copy = workbenchCopy.tableTab.records;
  const base = rows.hasMore ? copy.exportedPartial(rows.count) : copy.exported(rows.count);

  return { tone: rows.hasMore || rows.cut > 0 ? "warning" : "success", text: rows.cut > 0 ? `${base} ${copy.exportedCut(rows.cut)}` : base };
}

/**
 * O que "Exportar CSV" entrega (RN-TABELA-006): o nome do arquivo, o texto das linhas CARREGADAS (as que ainda não foram lidas não entram) e o
 * aviso que a pessoa lê depois. `hasMore` vale também com o cursor fechado: as linhas que faltam seguem de fora. Quem chama já pôs nas linhas o
 * valor completo das células cortadas (`withFullValues`, RN-SQL-017): as marcas de corte que sobram são as que não puderam vir inteiras.
 */
export function csvExportOf(result: Pick<RowsState, "columns" | "rows" | "hasMore" | "truncated">, schema: string, name: string): { fileName: string; text: string; notice: ReturnType<typeof exportNotice> } {
  return {
    fileName: csvFileName(schema, name),
    text: toCsv(
      result.columns.map((column) => column.name),
      result.rows,
    ),
    notice: exportNotice({ count: result.rows.length, hasMore: result.hasMore, cut: [...result.truncated.values()].reduce((total, columns) => total + columns.size, 0) }),
  };
}
