import { join, resolve } from "node:path";

/**
 * A pasta de dados do app (os cofres e o log da API), nos dois modos: `Zanveri/Prism` dentro de `appData`
 * (`%APPDATA%` no Windows) no app empacotado e `Zanveri/Prism-dev` em desenvolvimento, para o `pnpm dev` e
 * as conferências nunca abrirem os cofres de verdade (RN-ABERTO-008). `--user-data-dir` na linha de comando
 * vence nos dois modos, e é como se confere o app empacotado sem tocar em dados de ninguém.
 */
export function userDataDir({ isPackaged, userDataSwitch, appData }: { isPackaged: boolean; userDataSwitch: string; appData: string }): string {
  // `app.setPath` só aceita caminho absoluto.
  if (userDataSwitch !== "") return resolve(userDataSwitch);
  return join(appData, "Zanveri", isPackaged ? "Prism" : "Prism-dev");
}
