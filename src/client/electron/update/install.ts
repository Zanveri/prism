import { constants } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * Os argumentos do instalador NSIS que este projeto gera (RN-ATUALIZA-006): `electron-builder.yml` não define `oneClick`
 * nem `perMachine`, então ele é de um clique e por usuário (`RequestExecutionLevel user`: nunca pede elevação). Cada
 * argumento foi conferido nos modelos do electron-builder 26.15.3 (`app-builder-lib/templates/nsis`); só entram os três:
 *
 * - `--updated`: declarado em `NsisTarget.js` (`scriptGenerator.flags([...])`). Em `include/allowOnlyOneInstallerInstance.nsh`
 *   (`_CHECK_APP_RUNNING`) o instalador espera o app sair sozinho (300 ms + 1 s) em vez de perguntar se pode fechá-lo; em
 *   `include/installUtil.nsh` ele repassa `--updated` ao desinstalador da versão antiga, que então preserva os dados do
 *   usuário e remove a pasta de instalação de uma vez só (`uninstaller.nsh`, `un.atomicRMDir`). O Prism reaberto recebe
 *   `--updated` na linha de comando (`common.nsh`, `StartApp`), que ele não lê. (O atalho da área de trabalho não depende
 *   deste argumento: a ressalva `${ifNot} ${isUpdated}` de `include/installer.nsh` só existe com `RECREATE_DESKTOP_SHORTCUT`,
 *   que este projeto não define.)
 * - `/S`: o modo silencioso do próprio NSIS; sem janela nem pergunta.
 * - `--force-run`: em `installSection.nsh`, com `ONE_CLICK` e `RUN_AFTER_FINISH`, o app só é reaberto num instalador
 *   silencioso se este argumento veio (`${ifNot} ${Silent} ${orIf} ${isForceRun}`).
 *
 * A remoção da versão antiga falha se algum arquivo da pasta de instalação estiver em uso, e num instalador silencioso essa
 * falha encerra o instalador sem reabrir o app (`installUtil.nsh`, `handleUninstallResult`). Por isso quem chama só roda o
 * instalador depois de o processo da API ter terminado (`updater.ts`, `install`).
 *
 * O comportamento do instalador de verdade ao atualizar por cima de uma instalação existente NÃO foi exercitado.
 */
export const installerArguments = ["--updated", "/S", "--force-run"] as const;

/** O que o atualizador usa do processo iniciado: saber se iniciou, e soltá-lo. */
export type InstallerProcess = { once(event: "spawn" | "error", listener: (error: Error) => void): unknown; unref(): void };
export type SpawnInstaller = (command: string, args: string[], options: { detached: boolean; stdio: "ignore"; shell: boolean }) => InstallerProcess;

/**
 * Roda o instalador conferido, desanexado do app (ele tem de continuar depois de o app sair), sem shell e com os direitos do
 * usuário. Só dá por feito quando o processo de fato iniciou; se não iniciar, falha com a causa, e quem chamou não encerra o app.
 */
export function runInstaller(spawn: SpawnInstaller, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(path, [...installerArguments], { detached: true, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Linux e macOS (RN-ATUALIZA-006): instalar pede senha de administrador ou assinatura, então o pacote conferido vai para a
 * pasta de downloads do usuário, e é ele quem instala. Copia sem gravar por cima do que já estiver lá (`COPYFILE_EXCL`; se o
 * nome existe, tenta `nome (1).ext`, `nome (2).ext`…) e apaga o original. Devolve onde o arquivo ficou.
 */
export async function deliverToDownloads(source: string, downloadsDir: string): Promise<string> {
  await mkdir(downloadsDir, { recursive: true });

  const name = basename(source);
  const dot = name.endsWith(".tar.gz") ? name.length - ".tar.gz".length : name.lastIndexOf(".");
  const [stem, extension] = dot <= 0 ? [name, ""] : [name.slice(0, dot), name.slice(dot)];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = join(downloadsDir, attempt === 0 ? name : `${stem} (${attempt})${extension}`);
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }

    await rm(source, { force: true });
    return target;
  }

  throw new Error("A pasta de downloads já tem cem arquivos com o nome do pacote.");
}
