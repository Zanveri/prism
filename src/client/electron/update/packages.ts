/**
 * Os pacotes que a pipeline publica em cada release, com `@VERSION@` no lugar da versão: é a lista de
 * `scripts/ci/packages.txt`, repetida aqui porque o app não lê arquivo do repositório. Um teste compara as duas, para não
 * divergirem em silêncio: mudou um alvo lá, mude aqui. O nome de arquivo que o app baixa sai SEMPRE desta lista, nunca do que
 * a rede diz (RN-ATUALIZA-005).
 */
export type InstallFormat = "nsis" | "zip" | "AppImage" | "deb" | "rpm" | "tar.gz" | "dmg";

export const packageFiles = [
  { group: "win", format: "nsis", file: "Prism-@VERSION@-win-x64.exe" },
  { group: "win", format: "zip", file: "Prism-@VERSION@-win-x64.zip" },
  { group: "linux", format: "AppImage", file: "Prism-@VERSION@-linux-x86_64.AppImage" },
  { group: "linux", format: "deb", file: "Prism-@VERSION@-linux-amd64.deb" },
  { group: "linux", format: "rpm", file: "Prism-@VERSION@-linux-x86_64.rpm" },
  { group: "linux", format: "tar.gz", file: "Prism-@VERSION@-linux-x64.tar.gz" },
  { group: "mac-arm64", format: "dmg", file: "Prism-@VERSION@-mac-arm64.dmg" },
  { group: "mac-arm64", format: "zip", file: "Prism-@VERSION@-mac-arm64.zip" },
  { group: "mac-x64", format: "dmg", file: "Prism-@VERSION@-mac-x64.dmg" },
  { group: "mac-x64", format: "zip", file: "Prism-@VERSION@-mac-x64.zip" },
] as const satisfies ReadonlyArray<{ group: string; format: InstallFormat; file: string }>;

/** O arquivo de somas que a pipeline anexa à release, junto dos pacotes (`scripts/ci`). */
export const sumsFile = "SHA256SUMS";

const fileOf = (template: string, version: string) => template.replace("@VERSION@", version);

/** O nome é o de um pacote daquela versão (ou o do arquivo de somas)? Só esses viram endereço. */
export function isPackageFile(version: string, fileName: string): boolean {
  return fileName === sumsFile || packageFiles.some(({ file }) => fileOf(file, version) === fileName);
}

/**
 * O que o processo principal sabe da instalação em uso. `appImage`: o app roda de um AppImage (a variável `APPIMAGE` existe).
 * `debInstalled`: o dpkg tem o pacote `prism` registrado. `hasRpm`: o sistema tem o `rpm`. `nsisInstalled`: no Windows, o
 * desinstalador que o instalador deixa está ao lado do executável (`Uninstall Prism.exe`); sem ele, o app roda do zip portátil.
 */
export type InstallFacts = { platform: string; arch: string; appImage: boolean; execPath: string; debInstalled: boolean; hasRpm: boolean; nsisInstalled: boolean };

/**
 * O formato da instalação em uso (RN-ATUALIZA-006). Windows: o instalador, se o app foi instalado por ele; rodando do zip
 * portátil, o zip (o instalador criaria OUTRA instalação, com atalhos, e a pasta do zip continuaria antiga). macOS: o `dmg`.
 * Linux: AppImage quando o app roda de um; instalado por pacote (o `deb` e o `rpm` do electron-builder instalam em `/opt`),
 * `deb` se o dpkg tem o pacote, senão `rpm` se o sistema tem rpm; em qualquer outro caso, `tar.gz`. Só o instalador do
 * Windows é executado pelo app; todo o resto é entregue na pasta de downloads.
 */
function formatOf({ platform, appImage, execPath, debInstalled, hasRpm, nsisInstalled }: InstallFacts): InstallFormat | null {
  if (platform === "win32") return nsisInstalled ? "nsis" : "zip";
  if (platform === "darwin") return "dmg";
  if (platform !== "linux") return null;
  if (appImage) return "AppImage";
  if (!execPath.startsWith("/opt/")) return "tar.gz";
  if (debInstalled) return "deb";
  return hasRpm ? "rpm" : "tar.gz";
}

/** O grupo de `packages.txt` da plataforma e da arquitetura em uso. Windows e Linux só têm pacote x64. */
function groupOf({ platform, arch }: InstallFacts): string | null {
  if (platform === "darwin") return arch === "arm64" || arch === "x64" ? `mac-${arch}` : null;
  if (arch !== "x64") return null;
  return platform === "win32" ? "win" : platform === "linux" ? "linux" : null;
}

/**
 * O pacote que "Atualizar agora" baixa: o da plataforma, da arquitetura e do formato da instalação em uso (RN-ATUALIZA-005).
 * Sem pacote para ela, nada, em vez do pacote de outra.
 */
export function choosePackage(version: string, facts: InstallFacts): { format: InstallFormat; fileName: string } | null {
  const group = groupOf(facts);
  const format = formatOf(facts);
  const found = packageFiles.find((each) => each.group === group && each.format === format);

  return found === undefined ? null : { format: found.format, fileName: fileOf(found.file, version) };
}
