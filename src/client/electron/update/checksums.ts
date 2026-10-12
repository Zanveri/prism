/**
 * As somas SHA-256 de uma versão (RN-ATUALIZA-005): as das notas da release e as do arquivo `SHA256SUMS` anexado à release. As duas
 * são texto que vem da rede, no formato do `sha256sum`, e são lidas do jeito mais estrito: o que não tem exatamente o formato
 * não é soma. O nome lido nunca vira caminho: só serve para achar a soma do pacote cujo nome o app mesmo montou.
 */

/** Nome de arquivo → soma em minúsculas. */
export type Sums = ReadonlyMap<string, string>;

/** `<64 hex><espaços><nome>`, com o `*` opcional do modo binário. O nome não tem barra, espaço nem começa por ponto. */
const sumLine = /^([0-9a-fA-F]{64}) +\*?([A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** O título e a cerca que o `scripts/ci/release-notes.sh` escreve em volta das somas, no fim das notas. */
const sumsHeading = "### Somas SHA-256";
const fence = "```";

/**
 * As linhas de um `sha256sum`. Linha fora do formato e nome com caminho são ignorados. O mesmo nome com duas somas
 * diferentes vale como ausente: não há como saber qual é a certa, e a falta de soma recusa a atualização.
 */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  const conflicting = new Set<string>();

  for (const line of text.split("\n")) {
    const match = sumLine.exec(line.replace(/\r$/, ""));
    if (match === null) continue;

    const [, sum, name] = match;
    const known = sums.get(name);
    if (known !== undefined && known !== sum.toLowerCase()) conflicting.add(name);
    sums.set(name, sum.toLowerCase());
  }

  for (const name of conflicting) sums.delete(name);
  return sums;
}

/**
 * Separa as notas de uma release (a seção do changelog) do bloco das somas que a pipeline põe no fim delas. Só vale o ÚLTIMO
 * título `### Somas SHA-256`, seguido de uma cerca que abre, das linhas e da cerca que fecha, sem mais nada depois: um bloco
 * parecido no meio do texto, ou um bloco fora desse formato, não é o da pipeline, fica como texto e não dá soma nenhuma.
 */
export function splitNotes(description: unknown): { notes: string; sums: Map<string, string> } {
  if (typeof description !== "string") return { notes: "", sums: new Map() };

  const lines = description.split("\n").map((line) => line.replace(/\r$/, ""));
  const whole = { notes: lines.join("\n").trim(), sums: new Map<string, string>() };

  const heading = lines.lastIndexOf(sumsHeading);
  if (heading === -1) return whole;

  const rest = lines.slice(heading + 1);
  const open = rest.findIndex((line) => line !== "");
  if (open === -1 || rest[open] !== fence) return whole;

  const close = rest.indexOf(fence, open + 1);
  if (close === -1 || rest.slice(close + 1).some((line) => line !== "")) return whole;

  return { notes: lines.slice(0, heading).join("\n").trim(), sums: parseSums(rest.slice(open + 1, close).join("\n")) };
}

/**
 * Por que a atualização é recusada, ou nada se pode seguir (RN-ATUALIZA-005). As duas fontes têm de trazer a soma do
 * arquivo. Com a soma do que foi baixado (`actual`), ela tem de bater com as duas. Quem apaga o arquivo recusado, e diz se
 * conseguiu, é quem chamou.
 */
export function sumRefusal(fileName: string, notes: Sums, published: Sums, actual?: string): string | null {
  const fromNotes = notes.get(fileName);
  const fromFile = published.get(fileName);

  if (fromNotes === undefined) return `As notas da versão não trazem a soma SHA-256 de ${fileName}. Sem as duas somas o Prism não instala a atualização.`;
  if (fromFile === undefined) return `O SHA256SUMS da versão não traz a soma de ${fileName}. Sem as duas somas o Prism não instala a atualização.`;
  if (actual === undefined) return null;

  const sum = actual.toLowerCase();
  if (sum !== fromNotes && sum !== fromFile) return `O arquivo baixado (${fileName}) não confere com a soma SHA-256 das notas da versão nem com a do SHA256SUMS.`;
  if (sum !== fromNotes) return `O arquivo baixado (${fileName}) não confere com a soma SHA-256 das notas da versão.`;
  if (sum !== fromFile) return `O arquivo baixado (${fileName}) não confere com a soma SHA-256 do SHA256SUMS da versão.`;
  return null;
}
