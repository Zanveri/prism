/**
 * O modo da instalação do Windows (seção 25 da especificação): só do usuário ou para todos os usuários da máquina. O instalador
 * (`build/installer.nsh`, sobre o `multiUser.nsh` do electron-builder) grava a pasta da instalação em
 * `HKCU\Software\<guid>` (só do usuário) ou em `HKLM\Software\<guid>` (para todos), valor `InstallLocation`, e decide o modo da
 * atualização por essas chaves: havendo a de HKLM, é a instalação para todos, e o Windows pede a permissão de administrador a
 * cada atualização (RN-INSTALA-003). O app lê a mesma chave, com a mesma regra, para dizer isso antes e depois.
 *
 * O registro é lido pelo `reg.exe` do sistema, sem shell: o Node não lê o registro, e o app não tem módulo nativo.
 */

/** O `nsis.guid` do `electron-builder.yml`, que é o que o electron-builder calcula do `appId` (os testes conferem os dois). */
export const installerGuid = "d551cb2c-c57f-514a-ba30-6878b60cf922";

/** A visão de 64 bits do registro, a que o instalador usa num Windows de 64 bits (`common.nsh`, `check64BitAndSetRegView`). */
const queryArguments = ["query", `HKLM\\Software\\${installerGuid}`, "/v", "InstallLocation", "/reg:64"];

/** Roda um programa sem shell e devolve o código de saída e o que ele escreveu. */
export type RunReg = (command: string, args: string[]) => Promise<{ status: number | null; stdout: string }>;

/** O `reg.exe` da pasta do Windows (`%SystemRoot%`), e não um do PATH ou da pasta de trabalho. */
export function regExecutable(systemRoot: string | undefined): string {
  const root = systemRoot !== undefined && /^[A-Za-z]:\\/.test(systemRoot) ? systemRoot.replace(/\\+$/, "") : "C:\\Windows";
  return `${root}\\System32\\reg.exe`;
}

/** A pasta que a saída do `reg query` traz no valor `InstallLocation`, ou `null` quando ele está vazio ou não veio. */
export function installLocationOf(output: string): string | null {
  const match = /^\s+InstallLocation\s+REG_(?:EXPAND_)?SZ[ \t]+(.*\S)[ \t]*$/m.exec(output);
  return match === null ? null : match[1];
}

/** A instalação é para todos os usuários? Qualquer falha ao perguntar vale como "só do usuário", o modo de antes. */
export async function installedForAllUsers(run: RunReg, systemRoot: string | undefined): Promise<boolean> {
  try {
    const { status, stdout } = await run(regExecutable(systemRoot), [...queryArguments]);
    return status === 0 && installLocationOf(stdout) !== null;
  } catch {
    return false;
  }
}
