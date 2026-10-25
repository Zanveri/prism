/**
 * As permissões do Chromium que a tela pode ter (RN-SHELL-001): só as que ela usa, e só para a origem do próprio app. Sem um tratador, o Electron
 * concede tudo a qualquer página. Não importa nada do Electron, para o vitest exercitá-lo.
 *
 * - `clipboard-sanitized-write` e `clipboard-read`: copiar (o valor, a linha, o SQL) e colar na grade.
 * - `local-fonts`: ler a lista das fontes instaladas, para Configurações › Aparência (RN-CONFIG-008, `window.queryLocalFonts`).
 *
 * Permissão nova que a tela passe a usar entra nesta lista; o que não está nela é negado, mesmo para o app. A janela do resultado (`isResultWindow`) tem só a
 * área de transferência.
 */
export const appPermissions: ReadonlySet<string> = new Set(["clipboard-read", "clipboard-sanitized-write", "local-fonts"]);

/**
 * As permissões da janela do resultado (RN-ABAS-017): só a área de transferência. Ela é uma página em branco da mesma origem, sem fontes locais nem nada que o
 * app não use ali.
 */
export const resultWindowPermissions: ReadonlySet<string> = new Set(["clipboard-read", "clipboard-sanitized-write"]);

/** O endereço é da origem do app? `app://prism`, com ou sem caminho, e não `app://prism.outro` nem um endereço que só a contém. */
function fromOrigin(url: string | undefined, origin: string): boolean {
  return url !== undefined && (url === origin || url.startsWith(`${origin}/`));
}

/**
 * A regra dos dois tratadores do processo principal: o pedido (`setPermissionRequestHandler`, com o endereço de quem pede) e a consulta
 * (`setPermissionCheckHandler`, com a origem). `origin` é a da tela: `app://prism`, ou o servidor do Vite em desenvolvimento.
 */
export function permissionAllowed(permission: string, requestingUrl: string | undefined, origin: string, isResultWindow = false): boolean {
  // A janela do resultado é reconhecida pelo `webContents` (o `id`), e não pelo endereço: ali o endereço de quem pede é `about:blank`, e a origem pode vir
  // herdada ou nula. Quando o `webContents` vem nulo na consulta, vale a regra da origem, como sempre.
  if (isResultWindow) return resultWindowPermissions.has(permission);
  return appPermissions.has(permission) && fromOrigin(requestingUrl, origin);
}
