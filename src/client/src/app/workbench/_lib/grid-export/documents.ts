import { dataRowOf, utf8Length, wellFormed, type DocumentContext, type DocumentCounts, type DocumentFormat, type DocumentRow, type DocumentWriter } from "./document";
import { csvWriter } from "./to-csv";
import { htmlWriter } from "./to-html";
import { jsonWriter } from "./to-json";
import { markdownWriter } from "./to-markdown";
import { sourceCodeWriter } from "./to-source-code";
import { sqlWriter } from "./to-sql";
import { txtWriter } from "./to-txt";
import { dbUnitWriter, xmlWriter } from "./to-xml";

const writers: Record<DocumentFormat, (context: DocumentContext) => DocumentWriter> = {
  csv: csvWriter,
  sourceCode: sourceCodeWriter,
  dbUnit: dbUnitWriter,
  html: htmlWriter,
  json: jsonWriter,
  markdown: markdownWriter,
  sql: sqlWriter,
  txt: txtWriter,
  xml: xmlWriter,
};

/**
 * O escritor do formato, com o que os formatos de dados fazem antes de escrever cada linha: o nulo no lugar do binário com "Deixar vazio" e no da célula
 * "gerado pelo banco", e a conta dos valores que ficaram cortados (`notWhole`). O SQL recebe a linha como ela é: ele mesmo decide o literal do binário, a
 * linha comentada e o nulo do binário com "NULL" (RN-EXPORT-011, RN-GRADE-016).
 */
export function documentStepper(format: DocumentFormat, context: DocumentContext): { writer: DocumentWriter; write: (row: DocumentRow) => string } {
  const writer = writers[format](context);
  if (format === "sql") return { writer, write: writer.write };

  const binaryEmpty = context.options[format].binary === "null";
  return {
    writer,
    write: (row) => {
      const data = dataRowOf(row, context.columns, binaryEmpty);
      writer.counts.notWhole += data.cut?.length ?? 0;
      return writer.write(data);
    },
  };
}

/** O documento inteiro de uma vez, sem limite: para os testes e para quem já sabe que ele é pequeno. O par substituto solto sai como U+FFFD, como no UTF-8. */
export function writeDocument(format: DocumentFormat, context: DocumentContext, rows: Iterable<DocumentRow>): { text: string; counts: DocumentCounts } {
  const { writer, write } = documentStepper(format, context);
  let text = writer.begin();
  for (const row of rows) text += write(row);
  text += writer.end();
  return { text: wellFormed(text), counts: writer.counts };
}

export type BuildControl = {
  /** O teto do texto em UTF-8 (`clipboardLimitBytes`, na área de transferência): passar dele para na hora, sem montar o resto. Sem ele, não há teto. */
  limitBytes?: number;
  signal?: AbortSignal;
  /** Como ceder a vez à tela entre as partes; o padrão é um `setTimeout` de zero. */
  pause?: () => Promise<void>;
  /** Quantas células entre uma pausa e a seguinte (5.000 por padrão). */
  cellsPerPause?: number;
};

export type BuiltDocument = { kind: "built"; text: string; bytes: number; counts: DocumentCounts } | { kind: "tooLarge" } | { kind: "cancelled" };

/**
 * O documento montado em partes (RN-GRADE-002 e 016): cada linha é um pedaço, e a cada `cellsPerPause` células a montagem cede a vez à tela (`pause`), e
 * cem mil células não prendem a janela. O tamanho em UTF-8 é somado enquanto ele cresce, e passar de `limitBytes` para na hora (`tooLarge`), sem montar o
 * resto; o `signal` desiste entre duas partes (`cancelled`).
 */
export async function buildDocument(format: DocumentFormat, context: DocumentContext, rows: Iterable<DocumentRow>, control: BuildControl = {}): Promise<BuiltDocument> {
  const limit = control.limitBytes ?? Number.POSITIVE_INFINITY;
  const pause = control.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const cellsPerPause = control.cellsPerPause ?? 5000;
  const { writer, write } = documentStepper(format, context);
  const parts: string[] = [];
  let bytes = 0;
  const add = (part: string) => {
    if (part === "") return true;
    bytes += utf8Length(part);
    parts.push(part);
    return bytes <= limit;
  };

  if (!add(writer.begin())) return { kind: "tooLarge" };
  let cells = 0;
  for (const row of rows) {
    if (control.signal?.aborted === true) return { kind: "cancelled" };
    if (!add(write(row))) return { kind: "tooLarge" };
    cells += Math.max(1, row.values.length);
    if (cells >= cellsPerPause) {
      cells = 0;
      await pause();
    }
  }
  if (control.signal?.aborted === true) return { kind: "cancelled" };
  if (!add(writer.end())) return { kind: "tooLarge" };
  return { kind: "built", text: wellFormed(parts.join("")), bytes, counts: writer.counts };
}
