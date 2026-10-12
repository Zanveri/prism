/**
 * Um elemento de um arquivo SVG: o nome, os atributos na ordem em que estão escritos, os filhos e o texto (o do `<title>` e o do
 * `<desc>`). É o que o cliente lê dos desenhos de `assets/` (RN-MARCA-007): a marca é desenhada a partir do arquivo, e não de uma
 * cópia dos traços no código.
 */
export type SvgNode = { name: string; attributes: Record<string, string>; children: SvgNode[]; text: string };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    const value = entities[entity];
    if (value === undefined) throw new Error(`SVG com uma entidade desconhecida: ${whole}`);
    return value;
  });
}

// Comentário, instrução de processamento (`<?xml …?>`), fechamento, abertura (com atributos entre aspas) ou texto. A expressão é
// "colada" (`y`): o que não casa na posição em que a leitura está é um SVG malformado, e não algo a pular.
const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
const attribute = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Lê um SVG bem formado, sem DOM (o processo da tela e o vitest são o mesmo código). Lança se o texto não for um SVG só, com a raiz
 * `<svg>`, cada elemento fechado e cada atributo entre aspas: um arquivo de `assets/` que não se lê é um erro a corrigir no arquivo.
 */
export function parseSvg(source: string): SvgNode {
  const stack: SvgNode[] = [];
  let root: SvgNode | undefined;
  token.lastIndex = 0;

  while (token.lastIndex < source.length) {
    const at = token.lastIndex;
    const match = token.exec(source);
    if (match === null) throw new Error(`SVG malformado na posição ${at}.`);
    const [whole, closing, opening, attributeText, selfClosing, text] = match;

    if (text !== undefined) {
      if (text.trim() === "") continue;
      const parent = stack.at(-1);
      if (parent === undefined) throw new Error(`SVG com texto fora da raiz na posição ${at}.`);
      parent.text += decode(text.trim());
    } else if (closing !== undefined) {
      const open = stack.pop();
      if (open?.name !== closing) throw new Error(`SVG com </${closing}> sem a abertura correspondente na posição ${at}.`);
    } else if (opening !== undefined) {
      const attributes: Record<string, string> = {};
      for (const [, name, double, single] of (attributeText ?? "").matchAll(attribute)) {
        if (Object.hasOwn(attributes, name)) throw new Error(`SVG com o atributo ${name} repetido em <${opening}>.`);
        attributes[name] = decode(double ?? single ?? "");
      }

      const node: SvgNode = { name: opening, attributes, children: [], text: "" };
      const parent = stack.at(-1);
      if (parent !== undefined) parent.children.push(node);
      else if (root === undefined) root = node;
      else throw new Error(`SVG com mais de uma raiz na posição ${at}.`);
      if (selfClosing === "") stack.push(node);
    } else if (!whole.startsWith("<!--") && !whole.startsWith("<?")) {
      throw new Error(`SVG malformado na posição ${at}.`);
    }
  }

  if (stack.length > 0) throw new Error(`SVG com <${stack.at(-1)?.name}> sem fechamento.`);
  if (root?.name !== "svg") throw new Error("O arquivo não é um SVG: a raiz tem de ser <svg>.");
  return root;
}
