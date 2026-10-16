/**
 * As regras do nome de um arquivo que o Prism propõe (RN-TABELA-006 e RN-EXPORT-014), num lugar só: a tela as usa no "Exportar CSV" (`csvFileName`) e
 * no nome que o assistente "Exportar dados" mostra (`exportFileName`), e o processo principal as aplica de novo ao nome que a tela manda para o
 * diálogo de salvar (RN-EXPORT-019, `prism:transfer-destination`). Puro e sem Node, como o `zoom.ts`: os dois lados o importam.
 */

/** O que o Windows não aceita num nome de arquivo; a barra também, então o nome nunca cria pasta. */
const forbiddenInFileName = /[\\/:*?"<>|]/g;

/** Os nomes de dispositivo do Windows: `con`, `prn`, `aux`, `nul`, `com0` a `com9`, `lpt0` a `lpt9`, `conin$` e `conout$`, em qualquer caixa. */
const reservedDeviceName = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)$/i;

/** O tamanho máximo do nome, sem a extensão, em pontos de código (um emoji conta um, e o corte nunca parte um par substituto). */
export const maxFileNameLength = 120;

/** O nome que sobra quando o pedido não tem nada que sirva. */
export const fallbackFileName = "registros";

/**
 * O texto sem os caracteres de controle (o NUL, a quebra de linha, o sino, os de C1) e sem os de direção de texto (U+202A a U+202E, U+2066 a U+2069, as marcas
 * U+200E, U+200F e U+061C): o nome de uma tabela vem do banco, e um U+202E faz `fatura‮vsc.exe` ser lido ao contrário no diálogo de salvar. Eles SAEM, e não
 * viram `_`: o que sobra é o que a pessoa leria.
 */
function withoutControls(text: string): string {
  let kept = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const direction = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f || code === 0x061c;
    // O que não se vê ou quebra a linha: o espaço de largura zero (U+200B), os separadores de linha e de parágrafo (U+2028 e U+2029), a marca de ordem de
    // bytes (U+FEFF), o juntador de palavras (U+2060) e o hífen opcional (U+00AD).
    const unseen = code === 0x200b || code === 0x2028 || code === 0x2029 || code === 0xfeff || code === 0x2060 || code === 0x00ad;
    if (!control && !direction && !unseen) kept += char;
  }
  return kept;
}

/**
 * O nome sem a extensão: sem o que o sistema de arquivos recusa (controle, direção e invisíveis saem; o que o Windows não aceita vira `_`), sem ponto nem
 * espaço no fim, com até 120 pontos de código e, se o que vem antes do primeiro ponto é um nome de dispositivo do Windows (`con.pedido.csv` não abre), com um
 * `_` na frente. O Windows ignora os espaços depois do nome do dispositivo: `con .pedido.csv` é o mesmo `con`. Sobrando nada, `registros`.
 */
export function safeFileBase(text: string): string {
  const cleaned = withoutControls(text).replace(forbiddenInFileName, "_").replace(/[. ]+$/, "");
  const base = Array.from(cleaned).slice(0, maxFileNameLength).join("").replace(/[. ]+$/, "");
  // Só pontos e espaços sobraram (ou nada): nome padrão.
  if (/^[._ ]*$/.test(base)) return fallbackFileName;

  return `${reservedDeviceName.test(base.split(".")[0].trimEnd()) ? "_" : ""}${base}`;
}

/** O nome do arquivo de uma exportação: o nome seguro (`safeFileBase`) mais a extensão, que fica fora dos 120. */
export function exportFileName(base: string, extension: string): string {
  return `${safeFileBase(base)}.${extension.replace(/^\./, "")}`;
}

/** As extensões que o diálogo de salvar aceita (RN-EXPORT-019): as dos formatos, e o `.zip`. Nenhuma outra chega ao processo principal. */
export const exportExtensions = ["csv", "tsv", "php", "xml", "html", "json", "md", "sql", "txt", "xlsx", "zip"] as const;

export type ExportExtension = (typeof exportExtensions)[number];

/** O nome do filtro do diálogo de salvar, que o processo principal escreve (nenhum texto da tela vai ao diálogo além do nome conferido). */
export const extensionLabels: Record<ExportExtension, string> = {
  csv: "CSV",
  tsv: "TSV",
  php: "PHP",
  xml: "XML",
  html: "HTML",
  json: "JSON",
  md: "Markdown",
  sql: "SQL",
  txt: "Texto",
  xlsx: "Excel",
  zip: "ZIP",
};
