/**
 * As versões que o atualizador entende (RN-ATUALIZA-002, RN-VERSAO-001): a estável `X.Y.Z`, com a tag `vX.Y.Z`, e o
 * pré-lançamento `X.Y.Z-beta.N` (ou `X.Y.Z-rc.N`, que o formato aceita), com a tag `vX.Y.Z-beta.N`. Tudo o que não tem
 * exatamente um desses formatos é ignorado antes de virar comparação, caminho de pasta ou endereço: a tag vem da rede. Cada
 * número tem no máximo nove dígitos e não começa por zero (SemVer), então cabe num inteiro exato.
 */
const part = "(0|[1-9]\\d{0,8})";
const stable = new RegExp(`^${part}\\.${part}\\.${part}$`);
const release = new RegExp(`^${part}\\.${part}\\.${part}(?:-(beta|rc)\\.${part})?$`);

/**
 * Qualquer versão do SemVer 2.0.0, que é o que a versão INSTALADA pode ser (um pacote gerado à mão pode trazer `0.2.0-dev.5` ou
 * `+build.7`). Os identificadores do pré-lançamento ficam no grupo 4; os metadados de build (`+…`) não entram na ordem.
 */
const identifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp(`^${part}\\.${part}\\.${part}(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

/** `X.Y.Z`, sem o `v` e sem sufixo. */
export function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && stable.test(value);
}

/**
 * A versão de uma release: `X.Y.Z` ou `X.Y.Z-beta.N` (ou `-rc.N`), sem o `v`. É o que vai em `updates/<versão>/`, na tag do
 * endereço do pacote e no nome dos arquivos.
 */
export function isReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && release.test(value);
}

/** A versão de uma tag (`vX.Y.Z` ou `vX.Y.Z-beta.N`) e se ela é de pré-lançamento, ou nada: a tag fora do formato fica de fora. */
export function releaseOfTag(tag: unknown): { version: string; prerelease: boolean } | null {
  if (typeof tag !== "string" || !tag.startsWith("v")) return null;

  const version = tag.slice(1);
  return isReleaseVersion(version) ? { version, prerelease: version.includes("-") } : null;
}

type Parsed = { numbers: number[]; pre: string[] };

function parse(version: string): Parsed | null {
  const match = semver.exec(version);
  return match === null ? null : { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] === undefined ? [] : match[4].split(".") };
}

const isNumeric = (id: string) => /^\d+$/.test(id);

/**
 * Os identificadores do pré-lançamento, pelo SemVer: um a um, o numérico como número e o resto como texto ASCII, o numérico
 * antes do texto, e com tudo igual, o que tem mais identificadores vem depois (`beta` < `beta.1` < `beta.2` < `beta.10` < `rc.1`).
 */
function comparePre(a: string[], b: string[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const [left, right] = [a[index], b[index]];
    if (left === right) continue;
    if (isNumeric(left) && isNumeric(right)) return Number(left) - Number(right);
    if (isNumeric(left)) return -1;
    if (isNumeric(right)) return 1;
    return left < right ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * A ordem do SemVer entre duas versões que já passaram por `isReleaseVersion` (ou que são SemVer): negativo se `a` vem antes, zero
 * se são a mesma. Número a número, e não como texto; a estável vem depois dos pré-lançamentos dela (`0.2.0-beta.3` < `0.2.0`), e
 * o número do beta é número (`0.2.0-beta.9` < `0.2.0-beta.10`). Uma versão ilegível fica antes de todas (não acontece aqui:
 * quem chama já conferiu as duas).
 */
export function compareVersions(a: string, b: string): number {
  const [left, right] = [parse(a), parse(b)];
  if (left === null || right === null) return left === null ? (right === null ? 0 : -1) : 1;

  const byNumbers = left.numbers[0] - right.numbers[0] || left.numbers[1] - right.numbers[1] || left.numbers[2] - right.numbers[2];
  if (byNumbers !== 0) return byNumbers;
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  return comparePre(left.pre, right.pre);
}

/**
 * A versão de uma release (`candidate`) é mais nova que a instalada? A instalada pode ser um pré-lançamento qualquer do SemVer:
 * `0.2.0-beta.1` vem antes da `0.2.0`. Com a instalada ilegível, nada é mais novo: o app não oferece o que não sabe comparar.
 */
export function isNewerThan(candidate: string, installed: string): boolean {
  return isReleaseVersion(candidate) && parse(installed) !== null && compareVersions(candidate, installed) > 0;
}
