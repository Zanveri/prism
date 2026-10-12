// Os avisos de licença que vão em todo pacote (RN-ABERTO-001), sem efeito ao importar. Ficam em `resources/` do pacote:
//   LICENSE, NOTICE                      o do projeto, copiados da raiz do repositório
//   licenses/ibm-plex-sans/LICENSE       as fontes vão dentro do app, e a SIL OFL 1.1 pede o texto junto de cada cópia
//   licenses/ibm-plex-mono/LICENSE
//   licenses/dotnet/LICENSE.txt          o runtime do .NET vai junto da API autocontida, e a licença dele (MIT) pede o aviso
//   licenses/dotnet/ThirdPartyNotices.txt
// Os arquivos são copiados como estão. Quem os leva ao pacote é o `extraResources` do `electron-builder.yml`; aqui ficam os
// caminhos que o `dist` confere antes de empacotar e a busca dos avisos do .NET, que moram na raiz da instalação do `dotnet`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, posix, win32 } from "node:path";

/** `LICENSE` e `NOTICE` do projeto, relativos a `src/client`, como o `electron-builder.yml` os procura (`from`). */
export const projectNotices = ["../../LICENSE", "../../NOTICE"];

/** A licença de cada pacote de fontes (os dois textos diferem: cada um traz o nome do desenho). */
export const fontLicenses = ["node_modules/@fontsource/ibm-plex-sans/LICENSE", "node_modules/@fontsource/ibm-plex-mono/LICENSE"];

/** Onde `build:api` deixa os avisos do .NET, e o `extraResources` os pega (`from`). Fora do git. */
export const dotnetStaging = "resources/licenses/dotnet";

/** Os arquivos de licença que a raiz da instalação do .NET tem. */
export const dotnetNotices = ["LICENSE.txt", "ThirdPartyNotices.txt"];

/**
 * A raiz da instalação do .NET, a partir da saída de `dotnet --list-sdks` (`10.0.401 [<raiz>/sdk]`, uma linha por SDK; a saída não
 * é traduzida, ao contrário da de `dotnet --info`). Devolve a pasta que contém `sdk`, ou `undefined` se a saída não tem esse formato.
 *
 * @param {string} output
 * @returns {string | undefined}
 */
export function dotnetRootFromSdkList(output) {
  const lastLine = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "").at(-1);
  const sdkDirectory = lastLine === undefined ? undefined : /\[(.+)\]$/.exec(lastLine)?.[1];
  if (sdkDirectory === undefined) return undefined;

  return (sdkDirectory.includes("\\") ? win32 : posix).dirname(sdkDirectory);
}

/**
 * Os caminhos de `relativePaths` (relativos a `baseDir`) que não existem.
 *
 * @param {string} baseDir
 * @param {string[]} relativePaths
 * @param {(path: string) => boolean} [exists]
 */
export function missingFiles(baseDir, relativePaths, exists = existsSync) {
  return relativePaths.filter((relativePath) => !exists(join(baseDir, relativePath)));
}

/**
 * Copia `LICENSE.txt` e `ThirdPartyNotices.txt` da instalação do .NET para `destination`, como estão. O `dotnet` é achado pelo
 * PATH, e a raiz, por ele mesmo. Não falha: quem chama avisa e segue quando `problem` vem preenchido.
 *
 * @param {string} destination a pasta de destino (esvaziada antes)
 * @returns {{ copied: string[]; problem?: string }}
 */
export function stageDotnetNotices(destination) {
  rmSync(destination, { recursive: true, force: true });

  let root;
  try {
    root = dotnetRootFromSdkList(execFileSync("dotnet", ["--list-sdks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return { copied: [], problem: "o `dotnet` não foi encontrado" };
  }
  if (root === undefined) return { copied: [], problem: "a saída de `dotnet --list-sdks` não tem o formato esperado" };

  const missing = missingFiles(root, dotnetNotices);
  if (missing.length > 0) return { copied: [], problem: `a instalação do .NET não tem ${missing.join(" nem ")}` };

  mkdirSync(destination, { recursive: true });
  for (const notice of dotnetNotices) copyFileSync(join(root, notice), join(destination, notice));
  return { copied: dotnetNotices };
}
