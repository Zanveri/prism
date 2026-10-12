/**
 * O que os formatos de marcação (HTML, XML e a planilha) fazem com o texto do dado: o que escapar e o que o formato não guarda. Nenhum caractere de
 * controle aparece num literal de expressão regular daqui (`no-control-regex`): as faixas são comparadas por ponto de código.
 */

/** Um ponto de código que o XML 1.0 aceita (a produção `Char`): tabulação, quebra de linha, retorno de carro, e de U+0020 a U+D7FF, de U+E000 a U+FFFD e de U+10000 em diante. */
export const isXmlChar = (codePoint: number) =>
  codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd || (codePoint >= 0x20 && codePoint <= 0xd7ff) || (codePoint >= 0xe000 && codePoint <= 0xfffd) || (codePoint >= 0x10000 && codePoint <= 0x10ffff);

/**
 * Um ponto de código que um documento HTML válido aceita: o branco (tabulação, quebra de linha, avanço de página e retorno de carro), o texto de
 * U+0020 a U+007E e de U+00A0 em diante, sem o par substituto solto e sem os não-caracteres (U+FDD0 a U+FDEF e os dois últimos de cada plano).
 * Ficam de fora os controles, o DEL e os de C1 (U+007F a U+009F).
 */
export const isHtmlChar = (codePoint: number) =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xc ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0x7e) ||
  (codePoint >= 0xa0 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0x10ffff && !(codePoint >= 0xfdd0 && codePoint <= 0xfdef) && (codePoint & 0xfffe) !== 0xfffe);

/** Tira de `text` os pontos de código que `accepts` recusa e diz quantos tirou. O par substituto solto é um ponto de código (U+D800 a U+DFFF) que nenhum formato guarda. */
export function stripUnaccepted(text: string, accepts: (codePoint: number) => boolean): { text: string; removed: number } {
  let kept = "";
  let removed = 0;

  for (const char of text) {
    if (accepts(char.codePointAt(0) ?? 0)) kept += char;
    else removed++;
  }
  return { text: kept, removed };
}

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** O texto de uma célula ou de um atributo do HTML: `&`, `<`, `>` e as duas aspas. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => htmlEntities[char]);

const xmlTextEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\r": "&#13;" };

/** O conteúdo de um elemento do XML: `&`, `<`, `>` e o retorno de carro, que o leitor trocaria por uma quebra de linha (a regra de normalização do XML 1.0, 2.11). */
export const escapeXmlText = (text: string) => text.replace(/[&<>\r]/g, (char) => xmlTextEntities[char]);

const xmlAttributeEntities: Record<string, string> = { ...xmlTextEntities, '"': "&quot;", "\t": "&#9;", "\n": "&#10;" };

/** O valor de um atributo do XML entre aspas duplas: o do conteúdo, a aspa dupla e os brancos, que o leitor trocaria por espaço (normalização de atributo, XML 1.0, 3.3.3). */
export const escapeXmlAttribute = (text: string) => text.replace(/[&<>"\t\n\r]/g, (char) => xmlAttributeEntities[char]);
