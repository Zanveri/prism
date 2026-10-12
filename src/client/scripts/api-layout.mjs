// O que o app espera da API publicada, num lugar só: quem a publica (`publish-api.mjs`), quem confere o pacote
// (`check-api.mjs`, `dist.mjs`) e quem a inicia (`electron/main.ts`) concordam com o identificador de runtime e com o
// nome do executável. É JavaScript puro, sem efeito ao ser importado, para o `main.ts` e os testes o usarem também.

/** Os identificadores de runtime que têm pacote (RN-ABERTO-006). */
export const runtimeIds = ["win-x64", "linux-x64", "osx-arm64", "osx-x64"];

/** As plataformas do `pnpm dist -- <plataforma>` e o `process.platform` de cada uma. */
export const distPlatforms = { win: "win32", linux: "linux", mac: "darwin" };

/**
 * O executável da API publicada, dentro de `resources/api`: `.exe` só no Windows.
 *
 * @param {string} platform o `process.platform` do sistema para o qual a API foi publicada
 */
export function apiExecutable(platform) {
  return platform === "win32" ? "Prism.Api.exe" : "Prism.Api";
}

/**
 * O identificador a publicar: o pedido, que tem de ser um dos conhecidos, ou, sem pedido, o da máquina. Falha com a
 * lista dos válidos, em vez de entregar um nome desconhecido ao `dotnet`.
 *
 * @param {string | undefined} requested
 * @param {string} platform o `process.platform` da máquina
 * @param {string} arch o `process.arch` da máquina
 */
export function resolveRuntimeId(requested, platform, arch) {
  const valid = `Identificadores válidos: ${runtimeIds.join(", ")}.`;

  if (requested !== undefined) {
    if (!runtimeIds.includes(requested)) throw new Error(`Identificador de runtime desconhecido: "${requested}". ${valid}`);
    return requested;
  }

  const machine = { win32: "win", linux: "linux", darwin: "osx" }[platform];
  const id = `${machine}-${arch}`;
  if (!runtimeIds.includes(id)) throw new Error(`Não há pacote para esta máquina (${platform}/${arch}); informe o identificador. ${valid}`);
  return id;
}

/**
 * Os argumentos do `dotnet publish` (RN-VERSAO-003): a API recebe a versão do `package.json`, porque nenhum `.csproj`
 * declara versão.
 *
 * @param {{ project: string; runtimeId: string; version: string; outDir: string; artifactsPath: string }} options
 */
export function publishArgs({ project, runtimeId, version, outDir, artifactsPath }) {
  return ["publish", project, "-c", "Release", "-r", runtimeId, "--self-contained", "true", `-p:Version=${version}`, "-o", outDir, "--artifacts-path", artifactsPath];
}

const systems = { windows: { rid: "win", label: "Windows" }, linux: { rid: "linux", label: "Linux" }, macos: { rid: "osx", label: "macOS" } };
/** O sistema que cada plataforma do `dist` empacota. */
const systemOfPlatform = { win: "windows", linux: "linux", mac: "macos" };

/**
 * Lê o cabeçalho de um executável e diz para que sistema e arquitetura ele foi feito: PE (`MZ`, `Machine`), ELF
 * (`7F 45 4C 46`, `e_machine`) ou Mach-O de 64 bits (`CF FA ED FE`, `cputype`). Linux e macOS compartilham o nome `Prism.Api`,
 * e só o cabeçalho diz qual dos dois está em `resources/api`.
 *
 * @param {Uint8Array} bytes o começo do arquivo (4 KiB bastam)
 * @returns {{ system: "windows" | "linux" | "macos"; arch: string } | null} `null` quando não é um executável conhecido
 */
export function executableTarget(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at, little = true) => (at >= 0 && at + 2 <= view.byteLength ? view.getUint16(at, little) : -1);
  const u32 = (at, little = true) => (at >= 0 && at + 4 <= view.byteLength ? view.getUint32(at, little) : -1);
  const arch = (table, code) => table[code] ?? `desconhecida (0x${code.toString(16)})`;

  if (u16(0, false) === 0x4d5a) {
    const pe = u32(0x3c);
    return u32(pe, false) === 0x50450000 ? { system: "windows", arch: arch({ 0x8664: "x64", 0xaa64: "arm64" }, u16(pe + 4)) } : null;
  }
  if (u32(0, false) === 0x7f454c46) return { system: "linux", arch: arch({ 0x3e: "x64", 0xb7: "arm64" }, u16(18, bytes[5] !== 2)) };
  if (u32(0) === 0xfeedfacf) return { system: "macos", arch: arch({ 0x01000007: "x64", 0x0100000c: "arm64" }, u32(4)) };
  return null;
}

/**
 * Confere se o executável da API é o da plataforma e da arquitetura do pacote pedido (há uma só API em `resources/api`, e o
 * pareamento errado empacota uma API que nunca sobe: um ELF dentro do `.app`, `bad CPU type`). Devolve `null` se confere, ou
 * a mensagem que diz o que achou, o que esperava e o que rodar.
 *
 * @param {Uint8Array} bytes o começo do executável
 * @param {string} platform `win`, `linux` ou `mac`
 * @param {string} arch `x64` ou `arm64`
 * @returns {string | null}
 */
export function apiMismatch(bytes, platform, arch) {
  const wanted = systems[systemOfPlatform[platform]];
  const expected = `${wanted.rid}-${arch}`;
  const found = executableTarget(bytes);

  if (found === null) return `O executável de resources/api não é um PE, um ELF nem um Mach-O de 64 bits: rode build:api -- ${expected}.`;
  if (found.system === systemOfPlatform[platform] && found.arch === arch) return null;

  return `A API em resources/api é ${systems[found.system].rid}-${found.arch}, e o pacote pedido é ${wanted.label} ${arch}: rode build:api -- ${expected}.`;
}
