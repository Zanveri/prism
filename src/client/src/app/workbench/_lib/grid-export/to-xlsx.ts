import { gridExportCopy } from "./grid-export.copy";
import { truncatedIn, type GridSlice } from "./grid-slice";
import { decimalParts, strictNumber } from "./number-text";
import { escapeXmlAttribute, escapeXmlText, isXmlChar, stripUnaccepted } from "./text-escape";
import { zipStored } from "./zip";

/** O teto do Excel: 1.048.576 linhas (o cabeçalho conta) e 16.384 colunas (A a XFD). A tela pode conferir antes; `toXlsx` lança `RangeError` acima disso. */
export const xlsxLimits = { maxRows: 1_048_576, maxColumns: 16_384 };

export type XlsxOptions = { sheetName?: string };

/** O texto de uma célula do Excel tem no máximo 32.767 caracteres. */
const maxCellLength = 32_767;

/** O menor número normal de um `double`: abaixo dele o valor perde dígitos, e o Excel não o guarda. */
const minNormalNumber = 2.2250738585072014e-308;

/** O maior número que o Excel guarda (9,99999999999999E+307, a documentação dele): acima disso, texto. */
const maxExcelNumber = 9.99999999999999e307;

/**
 * O número como vai no `<v>` de uma célula numérica, ou `null` quando ele não cabe sem perder precisão e tem de ser texto: o Excel guarda um
 * `double` e só garante 15 dígitos significativos. Entra só o decimal escrito sem sinal de mais, sem zero à esquerda e sem `.5`/`5.` (o mesmo do JSON,
 * `strictNumber`: `007` é texto), com no máximo 15 dígitos significativos (os zeros das pontas não contam), finito, na faixa normal do `double` e até o maior
 * que o Excel guarda (`maxExcelNumber`).
 * Sai pelo `String` do JavaScript (`12.50` vira `12.5`, `1e5` vira `100000`), que o Excel lê.
 */
export function spreadsheetNumber(text: string): string | null {
  const parts = strictNumber.test(text) ? decimalParts(text) : null;
  if (parts === null || parts.digits.length > 15) return null;

  const number = Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > maxExcelNumber || (parts.digits !== "" && Math.abs(number) < minNormalNumber)) return null;

  return String(number);
}

/** A letra da coluna (a primeira é 0 e vale `A`; depois de `Z`, `AA`; a 16.383 é `XFD`). */
export function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/**
 * O texto de uma célula como vai dentro de `<t>` (o tipo `ST_Xstring` do formato): `&`, `<` e `>` escapados no XML, e o que o XML 1.0 não escreve (os
 * controles fora da tabulação e da quebra de linha, o retorno de carro, que o leitor trocaria por `\n`, U+FFFE, U+FFFF e o par substituto solto) como
 * `_xHHHH_`, com 4 dígitos hexadecimais maiúsculos. O que PODE virar um escape tem o sublinhado que o abre escapado (`_x005F_`): todo `_` seguido de
 * `xHHHH`, com ou sem o sublinhado do fim. Sem o do fim também, porque o escape que esta função escreve logo depois (`linha_x0041` + CR dá `linha_x0041_x000D_`)
 * o fecharia e o Excel leria `A`. Escapar a mais não custa nada: `_x005F_` sempre volta `_`. É o de cada padrão que COMEÇA no original, mesmo quando dois
 * se tocam, para a leitura de volta dar o texto de ida.
 */
export function xlsxText(text: string): string {
  const spared = text.replace(/_(?=x[0-9A-Fa-f]{4})/g, "_x005F_");
  let escaped = "";

  for (const char of spared) {
    const code = char.codePointAt(0) ?? 0;
    escaped += code === 0xd || !isXmlChar(code) ? `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_` : char;
  }
  return escapeXmlText(escaped);
}

/** O texto até o limite da célula (32.767 unidades UTF-16), sem partir um par substituto ao meio: o mesmo corte da exportação da API (RN-EXPORT-013), conferido pela fixture `xlsx-cell.json`. */
export function withinCell(text: string): string {
  if (text.length <= maxCellLength) return text;

  const splitsPair = (text.charCodeAt(maxCellLength - 1) & 0xfc00) === 0xd800 && (text.charCodeAt(maxCellLength) & 0xfc00) === 0xdc00;
  return text.slice(0, splitsPair ? maxCellLength - 1 : maxCellLength);
}

/**
 * O nome da planilha que o Excel aceita: sem controles, par solto, U+FFFE nem U+FFFF (o que o XML 1.0 não escreve: com eles o `workbook.xml` fica mal formado e o
 * arquivo não abre), sem `[ ] : * ? / \` (viram `_`), sem espaço nem apóstrofo nas pontas, com no máximo 31 caracteres (unidades UTF-16, sem partir um par),
 * nunca vazio (cai no título padrão) e nunca `History`, que o Excel reserva (ganha um `_`).
 */
export function sheetNameOf(name: string): string {
  const edges = (text: string) => text.replace(/^['\s]+|['\s]+$/g, "");
  let cut = "";

  for (const char of edges(stripUnaccepted(name, isXmlChar).text.replace(/\p{Cc}/gu, "").replace(/[[\]:*?/\\]/g, "_"))) {
    if (cut.length + char.length > 31) break;
    cut += char;
  }

  const result = edges(cut) || gridExportCopy.documentTitle;
  return result.toLowerCase() === "history" ? `${result}_` : result;
}

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const sheetNs = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const typePrefix = "application/vnd.openxmlformats-officedocument.spreadsheetml";

const contentTypes = `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${typePrefix}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${typePrefix}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${typePrefix}.styles+xml"/></Types>`;

const rootRelations = `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const workbookRelations = `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relNs}/styles" Target="styles.xml"/></Relationships>`;

/** Dois estilos de célula: o 0, o padrão, e o 1, o negrito do cabeçalho. O Excel exige os dois preenchimentos de sempre (`none` e `gray125`) e o estilo `Normal`. */
const styles = `${declaration}<styleSheet ${sheetNs}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * O recorte como uma pasta de trabalho do Excel (XLSX) de uma planilha: um ZIP sem compressão (`zipStored`, com o teto dele) com as seis partes mínimas.
 * O cabeçalho (os nomes das colunas) é em negrito e fica congelado. Coluna `number` vira número só quando `spreadsheetNumber` aceita o texto (até 15
 * dígitos significativos; senão texto, e a célula cortada nunca é número); todo o resto, data e booleano inclusive, é texto embutido (`inlineStr`) e NUNCA
 * fórmula: `=1+1` chega como o texto `=1+1`. O nulo é a célula ausente. Texto com o escape `_xHHHH_` (`xlsxText`), `xml:space="preserve"` e no máximo
 * 32.767 caracteres. Acima do teto do Excel (`xlsxLimits`) lança `RangeError`. O mesmo recorte dá os mesmos bytes.
 */
export function toXlsx(slice: GridSlice, options: XlsxOptions = {}): Uint8Array {
  return xlsxWorkbook(slice, options).content;
}

/**
 * O mesmo que `toXlsx`, e com `removed`: quantos pontos de código a planilha cortou por passar do limite da célula (32.767 caracteres), no cabeçalho ou no
 * corpo. Hoje a API corta as células aos 10.000 (RN-SQL-011) e isto não acontece; se esse teto mudar, o corte não fica calado (é o `removed` do registro).
 */
export function xlsxWorkbook(slice: GridSlice, options: XlsxOptions = {}): { content: Uint8Array; removed: number } {
  if (slice.columns.length > xlsxLimits.maxColumns || slice.rows.length + 1 > xlsxLimits.maxRows) throw new RangeError(gridExportCopy.xlsxTooBig);

  const cut = truncatedIn(slice);
  const letters = slice.columns.map((_, index) => columnLetters(index));
  let removed = 0;
  const fitted = (text: string) => {
    const kept = withinCell(text);
    removed += Array.from(text.slice(kept.length)).length;
    return kept;
  };
  const textCell = (ref: string, text: string, style: string) => `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xlsxText(fitted(text))}</t></is></c>`;

  const header = slice.columns.map((column, index) => textCell(`${letters[index]}1`, column.name, ' s="1"'));
  const rows = slice.rows.map((row, rowIndex) =>
    row
      .map((value, index) => {
        if (value === null) return "";

        const ref = `${letters[index]}${rowIndex + 2}`;
        const number = slice.columns[index].kind === "number" && !cut(rowIndex, index) ? spreadsheetNumber(value) : null;
        return number === null ? textCell(ref, value, "") : `<c r="${ref}"><v>${number}</v></c>`;
      })
      .join(""),
  );

  const hasColumns = slice.columns.length > 0;
  const sheetData = hasColumns ? [header.join(""), ...rows].map((cells, index) => `<row r="${index + 1}">${cells}</row>`).join("") : "";
  const pane = hasColumns ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : "";
  const sheet = `${declaration}<worksheet ${sheetNs}><dimension ref="${hasColumns ? `A1:${letters[letters.length - 1]}${rows.length + 1}` : "A1"}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${sheetData}</sheetData></worksheet>`;
  const workbook = `${declaration}<workbook ${sheetNs} xmlns:r="${relNs}"><bookViews><workbookView/></bookViews><sheets><sheet name="${escapeXmlAttribute(sheetNameOf(options.sheetName ?? gridExportCopy.documentTitle))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const encoder = new TextEncoder();
  const content = zipStored(
    [
      ["[Content_Types].xml", contentTypes],
      ["_rels/.rels", rootRelations],
      ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", workbookRelations],
      ["xl/styles.xml", styles],
      ["xl/worksheets/sheet1.xml", sheet],
    ].map(([name, xml]) => ({ name, data: encoder.encode(xml) })),
  );

  return { content, removed };
}
