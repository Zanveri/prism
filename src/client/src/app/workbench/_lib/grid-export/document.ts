import type { Engine } from "@/components/ui/engine-tag";

import { dataFormats, type DataFormat, type FormatOptions } from "../data-export/export-options";
import type { QueryColumn } from "../query.schema";

/**
 * Os documentos dos nove formatos de texto da exportação de dados (RN-EXPORT-006 a 012), escritos na tela com o mesmo texto que a API escreve para a mesma
 * entrada e as mesmas opções (RN-GRADE-016, RN-EXPORT-024): o "Copiar como" e o "Copiar avançado" os montam das linhas da grade, e as fixtures de ouro de
 * `src/test-fixtures/export/` conferem os dois lados. Cada formato é um escritor como o da API (`ExportWriter`, em C#): `begin` uma vez, `write` a cada
 * linha, na ordem, e `end` no fim, cada um devolvendo o pedaço de texto que escreveu, para quem monta somar o tamanho e ceder a vez à tela entre os pedaços.
 * Puro: nada daqui lê a tela, o relógio ou a rede.
 */

/** Os nove formatos de texto, na ordem da lista da exportação e do submenu do "Copiar avançado" (RN-EXPORT-004, RN-GRADE-003): o XLSX não é texto. */
export const documentFormats = dataFormats.filter((format): format is DocumentFormat => format !== "xlsx");

export type DocumentFormat = Exclude<DataFormat, "xlsx">;

/**
 * Uma coluna do documento: o nome, o tipo do banco (o do cabeçalho da grade; decide o literal do binário do Db2, RN-EXPORT-011) e o da grade, que decide o
 * número sem aspas, o alinhamento e o binário. `generated` é o que o alvo da edição diz dela (`always`: o banco a calcula sempre; nulo sem o alvo): só o
 * "Incluir as colunas que o banco calcula" do SQL a lê, antes de escolher as colunas que vão (`copy-as.ts`).
 */
export type DocumentColumn = { name: string; type: string; kind: QueryColumn["kind"]; generated?: "always" | "byDefault" | null };

/**
 * Uma linha do documento, como a grade a mostra (RN-GRADE-016): um valor por coluna (o texto, o binário como `0x…` em maiúsculas, ou nulo), com a
 * pendência no lugar do lido, a linha marcada para exclusão com o lido e a linha nova com o que foi preenchido.
 *
 * - `number`: o número da linha na grade, a partir de 1, que o comentário do SQL escreve; `null` na linha nova ainda não salva (a grade mostra "+").
 * - `cut`: as colunas (posições em `values`) cujo valor chegou cortado (RN-SQL-011) e não veio inteiro (RN-SQL-017). Saem como estão, contadas no aviso; no
 *   SQL a linha vira comentário. No JSON e no Código fonte o valor cortado é sempre texto, nunca número.
 * - `generated`: as colunas "gerado pelo banco — execute de novo para ver" (RN-EDIT-009), que não têm valor na grade: nulo nos formatos de dados, e a linha
 *   vira comentário no SQL.
 */
export type DocumentRow = { values: readonly (string | null)[]; number: number | null; cut?: readonly number[]; generated?: readonly number[] };

/**
 * O que o formato precisa além das linhas: o banco (os literais do SQL), o nome da origem (o título do HTML, a chave do JSON, a variável do PHP, a raiz do
 * XML; RN-EXPORT-006), as colunas que vão, na ordem, e as opções. No SQL e no DbUnit, a tabela de destino já vem resolvida nas opções.
 */
export type DocumentContext = { engine: Engine; sourceName: string; columns: readonly DocumentColumn[]; options: FormatOptions };

/**
 * O que do dado não saiu inteiro, para o aviso (RN-EXPORT-022 e RN-GRADE-016): os valores cortados na largura máxima do TXT, os caracteres que o formato
 * não aceita e foram tirados (HTML, XML, DbUnit, Código fonte), as linhas que viraram comentário no SQL, e, só na tela, os valores que não vieram inteiros
 * (`notWhole`: saem cortados nos formatos de dados; no SQL a linha deles é uma das comentadas).
 */
export type DocumentCounts = { cutValues: number; removedCharacters: number; skippedRows: number; notWhole: number };

export const emptyCounts = (): DocumentCounts => ({ cutValues: 0, removedCharacters: 0, skippedRows: 0, notWhole: 0 });

/** Um formato escrito por partes, como o `ExportWriter` da API. `counts` é o mesmo objeto do começo ao fim, e cresce enquanto ele escreve. */
export type DocumentWriter = {
  begin: () => string;
  write: (row: DocumentRow) => string;
  end: () => string;
  readonly counts: DocumentCounts;
};

/** RN-EXPORT-014 e RN-GRADE-002: o limite do texto que vai para a área de transferência, 10 MiB em UTF-8. Passar dele recusa; chegar nele, não. */
export const clipboardLimitBytes = 10 * 1024 * 1024;

/**
 * O tamanho do texto em UTF-8, como a área de transferência o recebe: o par substituto são 4 bytes, e o par solto, que o UTF-8 não escreve, conta como o
 * U+FFFD que o substitui (3 bytes).
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * O texto como o UTF-8 o guarda (RN-EXPORT-006): o par substituto solto vira U+FFFD, a troca que o `UTF8Encoding` da API faz ao gravar o arquivo. Os
 * formatos que escapam o par solto (o JSON) ou o tiram (HTML, XML, DbUnit) já não o têm; os outros (CSV, TXT, Markdown, SQL, Código fonte) o levam até aqui.
 */
export const wellFormed = (text: string) => text.replace(/\p{Cs}/gu, "\uFFFD");

/** Os pontos de código do texto (RN-EXPORT-008: a largura do TXT, sem a largura de exibição): o par substituto conta um, e o solto também. */
export function codePointCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) index++;
    count++;
  }
  return count;
}

/** O nulo no lugar do valor que o formato de dados não escreve: o binário com "Deixar vazio" (RN-EXPORT-006) e a célula "gerado pelo banco" (RN-GRADE-016). */
export function dataRowOf(row: DocumentRow, columns: readonly DocumentColumn[], binaryEmpty: boolean): DocumentRow {
  const generated = row.generated ?? [];
  const emptied = binaryEmpty && columns.some((column) => column.kind === "binary");
  if (generated.length === 0 && !emptied) return row;

  const values = row.values.map((value, index) => (generated.includes(index) || (emptied && columns[index].kind === "binary") ? null : value));
  return { ...row, values, cut: (row.cut ?? []).filter((index) => values[index] !== null) };
}
