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
