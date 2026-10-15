/**
 * A versão do app chega à tela (RN-VERSAO-004) como argumento da janela: o processo principal a põe em
 * `additionalArguments` e o preload a lê em `process.argv`, sem pedido de IPC e sem constante: a fonte é o
 * `version` do `package.json`, que o Electron devolve em `app.getVersion()` (RN-VERSAO-003).
 */
const prefix = "--prism-version=";

export function versionArgument(version: string): string {
  return `${prefix}${version}`;
}

/** Vazia quando o argumento não veio: a tela então não escreve versão nenhuma. */
export function versionFromArgv(argv: readonly string[]): string {
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? "";
}

/**
 * Qual janela é esta (RN-ABAS-003), do mesmo jeito: o processo principal põe o número dela em `additionalArguments`, e o preload o lê. A tela o usa
 * para saber se a aba solta na faixa veio dela mesma (mudar de lugar) ou de outra janela (pedir que a mande).
 */
const windowPrefix = "--prism-window=";

export function windowArgument(id: number): string {
  return `${windowPrefix}${id}`;
}

/** `null` quando o argumento não veio ou não é um número de janela. */
export function windowIdFromArgv(argv: readonly string[]): number | null {
  const value = argv.find((argument) => argument.startsWith(windowPrefix))?.slice(windowPrefix.length);
  return value !== undefined && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}
