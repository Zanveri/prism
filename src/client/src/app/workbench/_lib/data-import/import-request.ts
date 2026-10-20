import { limits } from "../variables/variables.copy";
import { commitEveryOfChoices } from "./import-load";
import type { CommitChoices, ImportChoices } from "./import-choices";
import { entriesOf, type Targets } from "./import-mapping";
import type { DetectedEncoding, ImportFormat, ImportLoad, ImportPreviewRequest, ImportRead, ImportReader, ImportReadRequest, ImportStartRequest, ImportTarget } from "./imports.schema";

/**
 * Os corpos das rotas da importação (seção 36, "Rotas e respostas"), montados só aqui, de um estado já conferido pela tela. A leitura manda as escolhas da
 * pessoa (`auto` inclusive); a prévia e o começo mandam o que a leitura achou (a codificação e o separador, as chaves do JSON, a planilha), para a API não
 * percorrer o arquivo de novo.
 */

/** O destino como a API o lê: a conexão, o banco de dados (quando não é o da conexão), o esquema e a tabela, como estão no catálogo. */
export type ImportPlace = { connectionId: string; database?: string; schema: string; table: string };

export function targetOf(place: ImportPlace): ImportTarget {
  return { connectionID: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }), schema: place.schema, table: place.table };
}

/**
 * O leitor da leitura (`imports/read`). Com a codificação "Automática" e a que uma leitura anterior deste arquivo já achou, vai a achada: só a codificação
 * automática percorre o arquivo inteiro (RN-IMPORT-004), e o arquivo não muda. O separador automático vai como `auto`: ele olha só as primeiras linhas.
 */
export function readerForRead(format: ImportFormat, choices: ImportChoices, { sheet, detectedEncoding }: { sheet: string | null; detectedEncoding: DetectedEncoding | null }): ImportReader {
  switch (format) {
    case "csv": {
      const { encoding, ...rest } = choices.csv;
      return { ...rest, encoding: encoding === "auto" && detectedEncoding !== null ? detectedEncoding : encoding };
    }
    case "tsv": {
      const { encoding, ...rest } = choices.tsv;
      return { ...rest, encoding: encoding === "auto" && detectedEncoding !== null ? detectedEncoding : encoding, delimiter: "\t" };
    }
    case "json":
      return {};
    case "xlsx":
      return { ...(sheet === null ? {} : { sheet }), ...choices.xlsx };
  }
}

/** O leitor da prévia e do começo: o que a leitura achou no lugar de `auto`, as chaves do JSON e a planilha lida. */
export function readerForLoad(format: ImportFormat, choices: ImportChoices, read: ImportRead): ImportReader {
  switch (format) {
    case "csv": {
      const { encoding, delimiter, ...rest } = choices.csv;
      const found = read.delimiter;
      return {
        ...rest,
        encoding: encoding === "auto" ? (read.encoding?.name ?? "auto") : encoding,
        delimiter: delimiter === "auto" ? (found === ";" || found === "," || found === "\t" || found === "|" ? found : "auto") : delimiter,
      };
    }
    case "tsv": {
      const { encoding, ...rest } = choices.tsv;
      return { ...rest, encoding: encoding === "auto" ? (read.encoding?.name ?? "auto") : encoding, delimiter: "\t" };
    }
    case "json":
      return { keys: [...read.columns] };
    case "xlsx":
      return { ...(read.sheet === null || read.sheet === undefined ? {} : { sheet: read.sheet }), ...choices.xlsx };
  }
}

export function readRequest(fileId: string, format: ImportFormat, reader: ImportReader): ImportReadRequest {
  return { fileID: fileId, format, reader };
}

/** A prévia convertida: sem mapeamento, a API devolve o automático (RN-IMPORT-009). O mapeamento vazio não vai (a API pede de 1 a 16.384). */
export function previewRequest(fileId: string, format: ImportFormat, choices: ImportChoices, read: ImportRead, place: ImportPlace, targets: Targets | null): ImportPreviewRequest {
  const mapping = targets === null ? [] : entriesOf(targets);
  return { fileID: fileId, format, reader: readerForLoad(format, choices, read), values: choices.values, target: targetOf(place), ...(mapping.length === 0 ? {} : { mapping }) };
}

/** A carga do pedido (RN-IMPORT-012). */
export function loadOf(commit: CommitChoices, empty: boolean, check: boolean): ImportLoad {
  return { empty, commitEvery: commitEveryOfChoices(commit), check };
}

export function startRequest(
  fileId: string,
  format: ImportFormat,
  choices: ImportChoices,
  read: ImportRead,
  place: ImportPlace,
  targets: Targets,
  empty: boolean,
  windowId: number,
): ImportStartRequest {
  return {
    fileID: fileId,
    format,
    reader: readerForLoad(format, choices, read),
    values: choices.values,
    target: targetOf(place),
    mapping: entriesOf(targets),
    load: loadOf(choices.load, empty, choices.load.check),
    windowID: windowId,
  };
}

/** O limite do corpo dos pedidos (as notas das rotas): 16 MiB em UTF-8 (RN-IMPORT-013; era 8 MiB antes dos `source.params`). A tela confere antes de mandar e não manda o que passa. */
export const maxImportRequestBytes = limits.transferBodyBytes;

export function importRequestBytes(request: unknown): number {
  return new TextEncoder().encode(JSON.stringify(request)).length;
}
