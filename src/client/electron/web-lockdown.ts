import { resultWindowMinimum } from "./result-window-file";
import type { Rect } from "./window-hub";

/**
 * A política de cada página que o Chromium cria (RN-SHELL-001 e RN-ABAS-017), sem depender do Electron: o que `web-contents-created` instala em TODO
 * `webContents` desde o nascimento (negar a navegação, o redirecionamento e a abertura de janelas), as `webPreferences` da janela do resultado, escritas
 * chave por chave, e a conferência delas depois de criada.
 */

/**
 * A navegação que uma página pode fazer. Uma janela do app só recarrega a própria página em desenvolvimento (é como o Vite mostra uma mudança no código;
 * cancelada, a tela ficaria parada na versão anterior); qualquer outra, nenhuma. As rotas são em hash e não navegam o documento. A página que não é de uma janela
 * do app (a do resultado, o splash) não navega para lugar nenhum, a não ser para a página em branco (`about:blank`): o Chromium pode trocar o documento em branco
 * do começo da janela do resultado depois de o `window.open` voltar (RN-ABAS-017: a tela confere o documento no `load` e monta de novo), e a página em branco não
 * tem conteúdo, poder nem endereço de rede.
 */
export function navigationAllowed({ url, isAppWindow, devServerUrl }: { url: string; isAppWindow: boolean; devServerUrl: string | undefined }): boolean {
  if (!isAppWindow) return url === "about:blank";
  if (devServerUrl === undefined) return false;
  return url.split("#")[0] === new URL(devServerUrl).href;
}

/** As `webPreferences` da janela do resultado: todas as chaves de segurança escritas, sem `preload` (a janela do resultado não tem `window.prism`). */
export const resultWindowPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
} as const;

/**
 * As opções da janela do resultado, do processo principal e só dele: o tamanho e o lugar, o título "Prism" até a tela pôr o dela, o ícone e a cor de fundo do
 * app, o mínimo de 480×320 px, nenhuma janela-mãe (`parent`) e `show: false` (ela aparece quando a tela a avisa de que está pronta). O que o texto das
 * opções do `window.open` dissesse não conta.
 */
export function resultWindowOptions({ bounds, icon, backgroundColor }: { bounds: Rect; icon: string | undefined; backgroundColor: string }) {
  return {
    ...bounds,
    minWidth: resultWindowMinimum.width,
    minHeight: resultWindowMinimum.height,
    title: "Prism",
    ...(icon === undefined ? {} : { icon }),
    backgroundColor,
    show: false,
    webPreferences: { ...resultWindowPreferences },
  };
}

/**
 * As `webPreferences` que a janela nasceu tendo (`getLastWebPreferences()`) são as que o processo principal passou? Cada chave de segurança tem de bater, e
 * `preload` tem de faltar. `null` (o Electron não deu as preferências) é divergência: a janela fecha.
 */
export function preferencesMatch(actual: Record<string, unknown> | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  for (const [key, expected] of Object.entries(resultWindowPreferences)) if (actual[key] !== expected) return false;

  const preload = actual.preload;
  return preload === undefined || preload === null || preload === "";
}
