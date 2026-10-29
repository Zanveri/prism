import type { QueryColumn } from "./query.schema";

/** Os 5 formatos do painel "Valor" do DBeaver. */
export type CellValueFormat = "binary" | "html" | "json" | "text" | "xml";

/** Categorias de token para syntax highlighting no leitor de valores (mapeadas para `--color-syntax-*` do tema). */
export type CellHighlightKind = "plain" | "keyword" | "string" | "number" | "comment" | "variable";

/** Um fragmento colorido do texto exibido no leitor de célula. */
export type CellHighlightToken = {
  kind: CellHighlightKind;
  text: string;
};

/** As opções do seletor de formato do painel "Valor", na mesma ordem do DBeaver. */
export const CELL_VALUE_FORMATS: readonly { value: CellValueFormat; label: string }[] = [
  { value: "binary", label: "Binary" },
  { value: "html", label: "HTML" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
  { value: "xml", label: "XML" },
];

/** Uma linha de 16 bytes do visualizador hexadecimal (`Binary`). */
export type BinaryHexRow = {
  offset: string;
  hex: string[];
  hexLine: string;
  ascii: string;
};

/** O resultado da montagem do visualizador hexadecimal (`Binary`). */
export type BinaryHexDump = {
  rows: BinaryHexRow[];
  totalBytes: number;
  truncatedAt?: number;
};

const HEX_BINARY_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Inspeciona o conteúdo textual de uma célula (como `CLOB`, `TEXT` ou `VARCHAR`) para identificar se é JSON, HTML ou XML estruturado.
 */
function detectStructuredTextFormat(raw: string): "json" | "xml" | "html" | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return null;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        return "json";
      }
    } catch {
      // Não é JSON válido; segue como texto comum
    }
  }

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    if (
      /^<!doctype\s+html\b/i.test(trimmed) ||
      /^<(?:html|head|body|div|span|p|table|thead|tbody|tr|td|th|ul|ol|li|section|article|main|header|footer|form|a|img|br|hr|h[1-6])\b/i.test(trimmed)
    ) {
      return "html";
    }
    if (
      /^<\?xml\b/i.test(trimmed) ||
      /^<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>$/.test(trimmed) ||
      /^<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?\/>$/.test(trimmed)
    ) {
      return "xml";
    }
  }

  return null;
}

/**
 * Mapeia o tipo da coluna do banco (PostgreSQL, Db2 e Informix) e, opcionalmente, o conteúdo textual da célula para o formato inicial do visualizador de valor:
 * - `json`, `jsonb`, `bson` -> `"json"`
 * - `xml` -> `"xml"`
 * - `html` -> `"html"`
 * - `bytea`, `blob`, `binary`, `varbinary`, `byte`, `for bit data` ou `kind === "binary"` -> `"binary"`
 * - `text`, `varchar`, `clob`, `lvarchar` e demais tipos -> detecta `"json"`, `"html"` ou `"xml"` pelo conteúdo quando aplicável, ou `"text"` (padrão).
 */
export function detectCellValueFormat(
  column: Pick<QueryColumn, "name" | "type" | "kind"> | null | undefined,
  value?: string | null,
): CellValueFormat {
  if (column) {
    const normalized = column.type.trim().toLowerCase();

    if (normalized.includes("json") || normalized.includes("bson")) return "json";
    if (normalized.includes("xml")) return "xml";
    if (normalized === "html" || normalized.includes("html")) return "html";
    if (
      column.kind === "binary" ||
      normalized === "bytea" ||
      normalized === "blob" ||
      normalized === "binary" ||
      normalized === "varbinary" ||
      normalized === "long varbinary" ||
      normalized === "byte" ||
      normalized === "raw" ||
      normalized.includes("for bit data")
    ) {
      return "binary";
    }
  }

  if (typeof value === "string" && value.length > 0) {
    const detected = detectStructuredTextFormat(value);
    if (detected !== null) return detected;
  }

  return "text";
}

/** Confere se o texto tem a forma `"0x..."` gerada pela API para valores binários. */
export function isHexPrefixedBinary(value: string): boolean {
  return value === "0x" || HEX_BINARY_PATTERN.test(value);
}

/** Converte `Uint8Array` para a representação `"0x..."` em hexadecimal maiúsculo esperada pela API. */
export function bytesToHexPrefixed(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")
  );
}

/**
 * Normaliza o valor editado no painel "Valor" (`F7`) antes de gravar na célula (para `UPDATE` ou `INSERT`):
 * - No modo `json`, compacta o JSON em uma única linha (`JSON.stringify(JSON.parse(...))`), garantindo que a indentação e as quebras de linha do modo `Formatado` nunca sejam salvas no banco nem quebrem o `UPDATE`, o `INSERT` ou o "Ver SQL".
 * - Nos modos `xml` e `html`, remove as quebras de linha e a indentação entre tags geradas pela visualização formatada.
 * - Em colunas binárias (`BYTEA`, `BLOB`, `BINARY`, `VARBINARY`, `BYTE`), garante que o valor saia sempre no formato hexadecimal `"0x..."` esperado pela API.
 */
export function normalizeEditedCellValue(
  draft: string,
  options: { format: CellValueFormat; isBinaryColumn: boolean },
): string {
  let normalized = draft;

  if (options.format === "json") {
    const trimmed = draft.trim();
    if (trimmed.length > 0) {
      try {
        normalized = JSON.stringify(JSON.parse(trimmed));
      } catch {
        normalized = draft;
      }
    }
  } else if (options.format === "xml" || options.format === "html") {
    const trimmed = draft.trim();
    if (trimmed.startsWith("<") && (trimmed.includes("\n") || trimmed.includes("\r"))) {
      normalized = trimmed.replace(/>\s*\r?\n\s*</g, "><");
    }
  }

  if (options.isBinaryColumn) {
    const trimmed = normalized.trim();
    if (/^0x(?:[0-9a-fA-F]{2})*$/i.test(trimmed)) {
      return "0x" + trimmed.slice(2).toUpperCase();
    }
    if (/^\\x(?:[0-9a-fA-F]{2})*$/i.test(trimmed)) {
      return "0x" + trimmed.slice(2).toUpperCase();
    }
    return bytesToHexPrefixed(new TextEncoder().encode(normalized));
  }

  return normalized;
}

/** Converte um texto `"0x..."` em `Uint8Array`, ou `null` quando não é hexadecimal par. */
export function hexToBytes(value: string): Uint8Array | null {
  if (!isHexPrefixedBinary(value)) return null;
  const rawHex = value.slice(2);
  const length = rawHex.length / 2;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const parsed = Number.parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(parsed)) return null;
    bytes[i] = parsed;
  }
  return bytes;
}

/** Lê uma string C terminada em `0x00` dentro de um documento BSON. */
function readBsonCString(bytes: Uint8Array, start: number, end: number, decoder: TextDecoder): { value: string; next: number } | null {
  let pos = start;
  while (pos < end && bytes[pos] !== 0x00) pos++;
  if (pos >= end) return null;
  return {
    value: decoder.decode(bytes.subarray(start, pos)),
    next: pos + 1,
  };
}

/**
 * Decodifica um documento BSON binário (`Uint8Array`) em objeto JavaScript, ou devolve `undefined` se os bytes não formam um BSON válido.
 */
export function decodeBsonBytes(bytes: Uint8Array, start = 0): unknown | undefined {
  if (bytes.length - start < 5) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const docLength = view.getInt32(start, true);
  const docEnd = start + docLength;
  if (docLength < 5 || docEnd > bytes.length || (start === 0 && docEnd !== bytes.length)) return undefined;
  if (bytes[docEnd - 1] !== 0x00) return undefined;

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const result: Record<string, unknown> = {};
  let offset = start + 4;

  while (offset < docEnd - 1) {
    const elementType = bytes[offset++];
    const cstr = readBsonCString(bytes, offset, docEnd - 1, decoder);
    if (!cstr) return undefined;
    offset = cstr.next;
    const key = cstr.value;

    switch (elementType) {
      case 0x01: {
        // Double (64-bit IEEE 754)
        if (offset + 8 > docEnd - 1) return undefined;
        result[key] = view.getFloat64(offset, true);
        offset += 8;
        break;
      }
      case 0x02: {
        // UTF-8 string
        if (offset + 4 > docEnd - 1) return undefined;
        const strLen = view.getInt32(offset, true);
        offset += 4;
        if (strLen < 1 || offset + strLen > docEnd - 1 || bytes[offset + strLen - 1] !== 0x00) return undefined;
        result[key] = decoder.decode(bytes.subarray(offset, offset + strLen - 1));
        offset += strLen;
        break;
      }
      case 0x03:
      case 0x04: {
        // Documento embutido (0x03) ou Array (0x04)
        if (offset + 4 > docEnd - 1) return undefined;
        const subLen = view.getInt32(offset, true);
        if (subLen < 5 || offset + subLen > docEnd - 1) return undefined;
        const subDoc = decodeBsonBytes(bytes.subarray(offset, offset + subLen), 0);
        if (subDoc === undefined || typeof subDoc !== "object" || subDoc === null) return undefined;
        result[key] = elementType === 0x04 ? Object.values(subDoc as Record<string, unknown>) : subDoc;
        offset += subLen;
        break;
      }
      case 0x05: {
        // Binário
        if (offset + 5 > docEnd - 1) return undefined;
        const binLen = view.getInt32(offset, true);
        offset += 5; // 4 bytes tamanho + 1 byte subtipo
        if (binLen < 0 || offset + binLen > docEnd - 1) return undefined;
        const slice = bytes.subarray(offset, offset + binLen);
        result[key] =
          "0x" +
          Array.from(slice)
            .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
            .join("");
        offset += binLen;
        break;
      }
      case 0x07: {
        // ObjectId (12 bytes)
        if (offset + 12 > docEnd - 1) return undefined;
        const oid = bytes.subarray(offset, offset + 12);
        result[key] = Array.from(oid)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        offset += 12;
        break;
      }
      case 0x08: {
        // Booleano
        if (offset + 1 > docEnd - 1) return undefined;
        const flag = bytes[offset++];
        if (flag !== 0x00 && flag !== 0x01) return undefined;
        result[key] = flag === 0x01;
        break;
      }
      case 0x09: {
        // UTC datetime (int64 ms)
        if (offset + 8 > docEnd - 1) return undefined;
        const ms = Number(view.getBigInt64(offset, true));
        result[key] = new Date(ms).toISOString();
        offset += 8;
        break;
      }
      case 0x0a: {
        // Null
        result[key] = null;
        break;
      }
      case 0x10: {
        // Int32
        if (offset + 4 > docEnd - 1) return undefined;
        result[key] = view.getInt32(offset, true);
        offset += 4;
        break;
      }
      case 0x11:
      case 0x12: {
        // Timestamp / Int64
        if (offset + 8 > docEnd - 1) return undefined;
        const big = view.getBigInt64(offset, true);
        const num = Number(big);
        result[key] = Number.isSafeInteger(num) ? num : big.toString();
        offset += 8;
        break;
      }
      default:
        return undefined;
    }
  }

  return offset === docEnd - 1 ? result : undefined;
}

/**
 * Converte o valor da célula em bytes (`Uint8Array`):
 * - Se a coluna é binária (ou o valor é `"0x..."` de BSON/binário), decodifica o hexadecimal.
 * - Caso contrário, codifica o texto em UTF-8 (igual ao modo `Binary` do DBeaver em células de texto).
 */
export function cellValueToBytes(value: string, isBinaryColumn: boolean): Uint8Array {
  if (isHexPrefixedBinary(value)) {
    const decoded = hexToBytes(value);
    if (decoded !== null && (isBinaryColumn || decodeBsonBytes(decoded) !== undefined)) {
      return decoded;
    }
  }
  return new TextEncoder().encode(value);
}

/**
 * Formata o valor para o modo `JSON`, permitindo ver tanto a forma crua (`formatted = false`) quanto a forma formatada (`formatted = true`).
 * Suporta também valores BSON binários (`0x...`).
 */
export function formatJsonValue(raw: string, formatted: boolean): { text: string; valid: boolean } {
  if (isHexPrefixedBinary(raw)) {
    const bytes = hexToBytes(raw);
    const bson = bytes ? decodeBsonBytes(bytes) : undefined;
    if (bson !== undefined) {
      return {
        valid: true,
        text: formatted ? JSON.stringify(bson, null, 2) : JSON.stringify(bson),
      };
    }
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { text: raw, valid: false };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (formatted) {
      return {
        valid: true,
        text: JSON.stringify(parsed, null, 2),
      };
    }
    // Na forma crua: se o original já está em uma linha só, preserva a escrita exata da célula; se veio quebrado em linhas, compacta em uma linha.
    const isMultiLine = raw.includes("\n") || raw.includes("\r");
    return {
      valid: true,
      text: isMultiLine ? JSON.stringify(parsed) : raw,
    };
  } catch {
    return { text: raw, valid: false };
  }
}

/** Formata marcação XML ou HTML com indentação de 2 espaços. */
function prettyPrintMarkup(raw: string, htmlMode: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("<")) return raw;

  const tokens = trimmed
    .replace(/>\s+</g, "><")
    .split(/(<[^>]+>)/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const lines: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Combina `<tag>texto</tag>` folha em uma única linha quando o fechamento corresponde à abertura
    const openMatch = /^<([a-zA-Z0-9:-]+)(?:\s|>)/.exec(token);
    const openName = openMatch ? openMatch[1].toLowerCase() : "";
    if (
      openName.length > 0 &&
      !(htmlMode && HTML_VOID_ELEMENTS.has(openName)) &&
      !token.startsWith("</") &&
      !token.startsWith("<?") &&
      !token.startsWith("<!") &&
      !token.endsWith("/>") &&
      i + 2 < tokens.length &&
      !tokens[i + 1].startsWith("<") &&
      tokens[i + 2].toLowerCase() === `</${openName}>`
    ) {
      lines.push(`${"  ".repeat(depth)}${token}${tokens[i + 1]}${tokens[i + 2]}`);
      i += 2;
      continue;
    }

    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      lines.push(`${"  ".repeat(depth)}${token}`);
      continue;
    }

    if (token.startsWith("<?") || token.startsWith("<!") || token.endsWith("/>")) {
      lines.push(`${"  ".repeat(depth)}${token}`);
      continue;
    }

    if (token.startsWith("<")) {
      const tagMatch = /^<([a-zA-Z0-9:-]+)/.exec(token);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : "";
      const isVoid = htmlMode && HTML_VOID_ELEMENTS.has(tagName);
      lines.push(`${"  ".repeat(depth)}${token}`);
      if (!isVoid) depth += 1;
      continue;
    }

    lines.push(`${"  ".repeat(depth)}${token}`);
  }

  return lines.join("\n");
}

/** Formata o valor para o modo `XML` (formatado com indentação ou cru). */
export function formatXmlValue(raw: string, formatted: boolean): string {
  return formatted ? prettyPrintMarkup(raw, false) : raw;
}

/** Formata o valor para o modo `HTML` (formatado com indentação ou cru). */
export function formatHtmlValue(raw: string, formatted: boolean): string {
  return formatted ? prettyPrintMarkup(raw, true) : raw;
}

/**
 * Gera a grade hexadecimal + ASCII (16 bytes por linha) idêntica à exibição `Binary` do DBeaver.
 */
export function formatBinaryHexDump(bytes: Uint8Array, maxBytes = 65_536): BinaryHexDump {
  const limit = Math.min(bytes.length, maxBytes);
  const rows: BinaryHexRow[] = [];

  for (let offset = 0; offset < limit; offset += 16) {
    const slice = bytes.subarray(offset, Math.min(offset + 16, limit));
    const hex: string[] = [];
    let ascii = "";

    for (let i = 0; i < 16; i++) {
      if (i < slice.length) {
        const byte = slice[i];
        hex.push(byte.toString(16).padStart(2, "0").toUpperCase());
        ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
      } else {
        hex.push("");
      }
    }

    const hexLine = hex.map((pair) => (pair === "" ? "  " : pair)).join(" ").trimEnd();
    rows.push({
      offset: offset.toString(16).padStart(8, "0").toUpperCase(),
      hex,
      hexLine,
      ascii,
    });
  }

  return {
    rows,
    totalBytes: bytes.length,
    ...(bytes.length > maxBytes ? { truncatedAt: maxBytes } : {}),
  };
}

/** Formata o dump hexadecimal em texto corrido (para copiar ou abrir no editor externo quando em modo `Binary`). */
export function formatBinaryHexText(bytes: Uint8Array, maxBytes = 65_536): string {
  const dump = formatBinaryHexDump(bytes, maxBytes);
  const header = "Offset    00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  ASCII";
  const lines = dump.rows.map((row) => `${row.offset}  ${row.hexLine.padEnd(47, " ")}  ${row.ascii}`);
  return [header, ...lines].join("\n");
}

/**
 * Formata o valor da célula de acordo com o formato escolhido (`binary`, `html`, `json`, `text`, `xml`) e o modo (`formatted` vs `cru`).
 */
export function formatCellValue(
  raw: string,
  options: { format: CellValueFormat; formatted: boolean; isBinaryColumn: boolean },
): { text: string; validJson?: boolean; hexDump?: BinaryHexDump } {
  const { format, formatted, isBinaryColumn } = options;

  switch (format) {
    case "binary": {
      const bytes = cellValueToBytes(raw, isBinaryColumn);
      return {
        text: formatBinaryHexText(bytes),
        hexDump: formatBinaryHexDump(bytes),
      };
    }
    case "json": {
      const res = formatJsonValue(raw, formatted);
      return { text: res.text, validJson: res.valid };
    }
    case "xml":
      return { text: formatXmlValue(raw, formatted) };
    case "html":
      return { text: formatHtmlValue(raw, formatted) };
    case "text":
    default: {
      if (isBinaryColumn && isHexPrefixedBinary(raw)) {
        const bytes = hexToBytes(raw);
        if (bytes) {
          return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
        }
      }
      return { text: raw };
    }
  }
}

/** A extensão de arquivo padrão para cada formato do visualizador de valor. */
export function cellFormatExtension(format: CellValueFormat): string {
  switch (format) {
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "html":
      return "html";
    case "binary":
      return "bin";
    case "text":
    default:
      return "txt";
  }
}

/** Sugere o nome do arquivo para salvar o valor da célula a partir do nome da coluna e do formato ativo. */
export function suggestedCellFileName(columnName: string | null | undefined, format: CellValueFormat): string {
  const sanitized = (columnName ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = sanitized.length > 0 ? sanitized : "valor";
  return `${base}.${cellFormatExtension(format)}`;
}

/** Monta o conteúdo, o tipo MIME e o nome de arquivo para salvar o valor da célula em disco. */
export function cellFilePayload(
  raw: string,
  format: CellValueFormat,
  formatted: boolean,
  isBinaryColumn: boolean,
  columnName?: string | null,
): { content: string | Uint8Array; mime: string; filename: string } {
  const filename = suggestedCellFileName(columnName, format);
  if (format === "binary") {
    return {
      content: cellValueToBytes(raw, isBinaryColumn),
      mime: "application/octet-stream",
      filename,
    };
  }

  const rendered = formatCellValue(raw, { format, formatted, isBinaryColumn });
  const mimeByFormat: Record<Exclude<CellValueFormat, "binary">, string> = {
    json: "application/json;charset=utf-8",
    xml: "application/xml;charset=utf-8",
    html: "text/html;charset=utf-8",
    text: "text/plain;charset=utf-8",
  };
  return {
    content: rendered.text,
    mime: mimeByFormat[format],
    filename,
  };
}

function pushHighlightToken(tokens: CellHighlightToken[], kind: CellHighlightKind, text: string): void {
  if (text.length === 0) return;
  const last = tokens[tokens.length - 1];
  if (last !== undefined && last.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
}

function tokenizeJsonHighlight(text: string): CellHighlightToken[] {
  const tokens: CellHighlightToken[] = [];
  const pattern = /(\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\])*")(\s*:)?|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushHighlightToken(tokens, "plain", text.slice(cursor, index));
    }

    if (match[1] !== undefined) {
      pushHighlightToken(tokens, "comment", match[1]);
    } else if (match[2] !== undefined) {
      if (match[3] !== undefined) {
        pushHighlightToken(tokens, "variable", match[2]);
        pushHighlightToken(tokens, "plain", match[3]);
      } else {
        pushHighlightToken(tokens, "string", match[2]);
      }
    } else if (match[4] !== undefined) {
      pushHighlightToken(tokens, "number", match[4]);
    } else if (match[5] !== undefined) {
      pushHighlightToken(tokens, "keyword", match[5]);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    pushHighlightToken(tokens, "plain", text.slice(cursor));
  }

  return tokens;
}

function tokenizeMarkupTag(tagText: string, tokens: CellHighlightToken[]): void {
  const closeMatch = /(\/?>|\?>)$/.exec(tagText);
  const closeText = closeMatch ? closeMatch[1] : "";
  const bodyEnd = tagText.length - closeText.length;
  const openMatch = /^(<\?[A-Za-z_][\w:.-]*|<\/?[A-Za-z_][\w:.-]*|<\?|<\/?)/.exec(tagText.slice(0, bodyEnd));
  const openText = openMatch ? openMatch[1] : "";

  if (openText.length > 0) {
    pushHighlightToken(tokens, "keyword", openText);
  }

  const middle = tagText.slice(openText.length, bodyEnd);
  if (middle.length > 0) {
    const attrPattern = /("[^"]*"|'[^']*')|([A-Za-z_:][\w:.-]*)/g;
    let cursor = 0;
    for (const match of middle.matchAll(attrPattern)) {
      const index = match.index ?? 0;
      if (index > cursor) {
        pushHighlightToken(tokens, "plain", middle.slice(cursor, index));
      }
      if (match[1] !== undefined) {
        pushHighlightToken(tokens, "string", match[1]);
      } else if (match[2] !== undefined) {
        pushHighlightToken(tokens, "variable", match[2]);
      }
      cursor = index + match[0].length;
    }
    if (cursor < middle.length) {
      pushHighlightToken(tokens, "plain", middle.slice(cursor));
    }
  }

  if (closeText.length > 0) {
    pushHighlightToken(tokens, "keyword", closeText);
  }
}

function tokenizeMarkupHighlight(text: string): CellHighlightToken[] {
  const tokens: CellHighlightToken[] = [];
  const pattern =
    /(<!--[\s\S]*?(?:-->|$))|(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))|(<!\s*[A-Za-z][\s\S]*?(?:>|$))|(<\?[\s\S]*?(?:\?>|$)|<\/?[A-Za-z_][\w:.-]*(?:"[^"]*"|'[^']*'|[^>"'])*>)|(&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w.-]*);)/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushHighlightToken(tokens, "plain", text.slice(cursor, index));
    }

    if (match[1] !== undefined) {
      pushHighlightToken(tokens, "comment", match[1]);
    } else if (match[2] !== undefined) {
      pushHighlightToken(tokens, "string", match[2]);
    } else if (match[3] !== undefined) {
      pushHighlightToken(tokens, "keyword", match[3]);
    } else if (match[4] !== undefined) {
      tokenizeMarkupTag(match[4], tokens);
    } else if (match[5] !== undefined) {
      pushHighlightToken(tokens, "number", match[5]);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    pushHighlightToken(tokens, "plain", text.slice(cursor));
  }

  return tokens;
}

/**
 * Tokeniza o texto do leitor de valores para aplicar syntax highlighting com as cores do tema do usuário (`--color-syntax-*`) quando o conteúdo é JSON, XML ou HTML.
 */
export function highlightCellValue(text: string, format: CellValueFormat): CellHighlightToken[] {
  if (text.length === 0) return [];

  const effectiveFormat: "json" | "xml" | "html" | null =
    format === "json" || format === "xml" || format === "html"
      ? format
      : format === "text"
        ? detectStructuredTextFormat(text)
        : null;

  if (effectiveFormat === "json") {
    return tokenizeJsonHighlight(text);
  }
  if (effectiveFormat === "xml" || effectiveFormat === "html") {
    return tokenizeMarkupHighlight(text);
  }

  return [{ kind: "plain", text }];
}
