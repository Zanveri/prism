/**
 * Só para os testes: um leitor de XML mínimo e ESTRITO, para provar que o que o módulo escreve é bem formado e para consultar o resultado. Lê a declaração,
 * elementos com atributos entre aspas duplas, texto e as referências a caracteres (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#N;`, `&#xH;`);
 * lança em qualquer coisa que o XML 1.0 não aceite: marca que não fecha, atributo repetido, `&` solto, `<` no texto, caractere fora da produção
 * `Char`, ou texto fora do elemento raiz. Não lê DTD, CDATA nem espaço de nomes (o prefixo faz parte do nome).
 */
export type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };

const references: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeReferences(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name?: string, decimal?: string, hex?: string) =>
    name !== undefined ? references[name] : String.fromCodePoint(decimal !== undefined ? Number(decimal) : parseInt(hex ?? "0", 16)),
  );
}

function assertChars(text: string): void {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const valid = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
    if (!valid) throw new Error(`caractere fora do XML 1.0: U+${code.toString(16).toUpperCase()}`);
  }
}

function assertText(raw: string): void {
  if (raw.includes("<")) throw new Error("`<` no texto");
  if (raw.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "").includes("&")) throw new Error(`"&" sem escape em "${raw.slice(0, 40)}"`);
}

export function parseXml(xml: string): XmlNode {
  assertChars(xml);
  // O leitor trocaria o retorno de carro cru por uma quebra de linha (XML 1.0, 2.11): o escritor tem de usar `&#13;`.
  if (xml.includes(String.fromCharCode(13))) throw new Error("retorno de carro cru");

  let position = xml.startsWith("<?xml") ? xml.indexOf("?>") + 2 : 0;
  if (position < 2 && xml.startsWith("<?xml")) throw new Error("declaração sem fim");

  const root: XmlNode = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag = /<(\/)?([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/)?>/y;

  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    const raw = xml.slice(position, open < 0 ? xml.length : open);
    const current = stack[stack.length - 1];

    assertText(raw);
    if (stack.length === 1 && raw.trim() !== "") throw new Error("texto fora do elemento raiz");
    current.text += decodeReferences(raw);
    if (open < 0) break;

    tag.lastIndex = open;
    const match = tag.exec(xml);
    if (match === null) throw new Error(`marca mal formada em ${open}: ${xml.slice(open, open + 40)}`);

    const [whole, closing, name, rawAttributes, selfClosing] = match;
    position = open + whole.length;

    if (closing !== undefined) {
      if (current.name !== name) throw new Error(`</${name}> fecha <${current.name}>`);
      stack.pop();
      continue;
    }

    const attributes: Record<string, string> = {};
    for (const [, attribute, value] of rawAttributes.matchAll(/([A-Za-z_][\w.:-]*)="([^"<]*)"/g)) {
      if (attribute in attributes) throw new Error(`atributo repetido: ${attribute}`);
      assertText(value);
      // O leitor trocaria o branco cru de um atributo por espaço (3.3.3): o escritor tem de usar `&#9;`, `&#10;` e `&#13;`.
      if (/[\t\n\r]/.test(value)) throw new Error(`branco cru no atributo ${attribute}`);
      attributes[attribute] = decodeReferences(value);
    }

    const node: XmlNode = { name, attributes, children: [], text: "" };
    current.children.push(node);
    if (selfClosing === undefined) stack.push(node);
  }

  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].name}> não fecha`);
  if (root.children.length !== 1) throw new Error("um documento XML tem um elemento raiz só");
  return root.children[0];
}

/** Os descendentes (em profundidade, na ordem do documento) com o nome dado. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => [...(child.name === name ? [child] : []), ...findAll(child, name)]);
}
