import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from "electron";

/**
 * O arquivo do ícone da janela e do splash (RN-MARCA-001), dentro de `resources` no app empacotado e de `build/` em
 * desenvolvimento: `.ico` no Windows, PNG no Linux. No macOS o ícone é o do pacote (`.icns`) e a janela não leva um.
 */
export function windowIconFile(platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") return "icon.ico";
  return platform === "linux" ? "icon.png" : undefined;
}

/**
 * O menu do app empacotado. Windows e Linux não têm: o Ctrl+R do menu padrão recarregaria a janela e perderia o texto das
 * abas de SQL. No macOS a barra de menu é do sistema e um app sem menu não ouve Cmd+Q nem Cmd+C e Cmd+V nos campos, então
 * fica o mínimo que ele exige: o menu do app e Editar, sem recarregar e sem ferramentas de desenvolvedor.
 */
export function applicationMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  if (platform !== "darwin") return null;

  return [
    { role: "appMenu" },
    { label: "Editar", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  ];
}

/**
 * A tecla que o menu do app não recebe (RN-GRADE-012, RN-GRADE-013, RN-ABAS-014 e RN-ABAS-019): F5, F6 e F11, com qualquer modificador, Ctrl+R (Cmd+R), com ou
 * sem Shift, e Ctrl+W (Cmd+W). O app empacotado do Windows e do Linux não tem menu, e o do macOS não tem Recarregar nem Fechar; o menu padrão de
 * desenvolvimento tem Recarregar (Ctrl+R), Forçar recarga (Ctrl+Shift+R), Tela cheia (F11) e Janela › Fechar (CmdOrCtrl+W), e o Chromium do Electron não
 * recarrega nem fecha nada sem menu. Ignorado pelo menu (`setIgnoreMenuShortcuts`, a cada tecla, no `before-input-event`), o atalho chega à tela como qualquer
 * tecla: F5 atualiza a aba, F6 alterna entre o editor e o resultado, F11 abre o "Filtrar" da grade, Ctrl+R não faz nada, e o Ctrl+W fecha a aba ativa quando a
 * área de trabalho o trata e, quando não o trata (um diálogo, um menu ou uma lista aberta, o cofre bloqueado, a tela de entrada), também não faz nada: no
 * desenvolvimento ele nunca fecha a janela, como no app empacotado.
 */
export function menuShortcutIgnored(input: { key: string; control: boolean; meta: boolean }): boolean {
  if (input.key === "F5" || input.key === "F6" || input.key === "F11") return true;
  return (input.control || input.meta) && (input.key.toLowerCase() === "r" || input.key.toLowerCase() === "w");
}

/**
 * RN-ABAS-010: o app roda no Wayland nativo (a plataforma `wayland` do Ozone)? Ali o ponteiro lido pelo processo principal não vale fora das janelas do app
 * (vem parado ou em (0, 0), sem erro) e o app não escolhe onde as janelas abrem. Quem decide é o Chromium, pelo `--ozone-platform` (que vence), pelo
 * `--ozone-platform-hint` ou pela `ELECTRON_OZONE_PLATFORM_HINT` (`auto` é o padrão do Electron desde a 38: o Wayland quando a sessão é Wayland), e só no
 * Linux. Sem como perguntar ao Chromium o que ele escolheu, isto refaz a mesma conta.
 */
export function isWaylandSession({ platform, ozonePlatform, ozoneHint, env }: { platform: NodeJS.Platform; ozonePlatform: string; ozoneHint: string; env: Record<string, string | undefined> }): boolean {
  if (platform !== "linux") return false;
  if (ozonePlatform !== "") return ozonePlatform === "wayland";

  const hint = (ozoneHint !== "" ? ozoneHint : (env.ELECTRON_OZONE_PLATFORM_HINT ?? "auto")).toLowerCase();
  const waylandSession = env.XDG_SESSION_TYPE === "wayland" && (env.WAYLAND_DISPLAY ?? "") !== "";
  if (hint === "wayland") return (env.WAYLAND_DISPLAY ?? "") !== "";
  return hint === "auto" && waylandSession;
}

/**
 * RN-JANELA-001: a barra superior do app é a barra da janela, e os botões de minimizar, maximizar e fechar são os do sistema, sobrepostos a ela
 * (`titleBarOverlay`) com o fundo transparente: quem pinta atrás deles é a tela (a barra superior, o painel do login, o fundo da abertura e do bloqueio), e o
 * sistema desenha só os símbolos e o realce do mouse, o vermelho do fechar inclusive. Só no Windows: no Linux os botões sobrepostos são desenhados pelo
 * Electron, e não pelo sistema, e no macOS a barra nunca foi aberta; nos dois a janela mantém a barra nativa, como a regra permite.
 *
 * A altura é a da barra superior (53 px: a marca de 40 px, RN-MARCA-007, com 6 px em cima e embaixo, e a borda) vezes o zoom do programa (RN-ZOOM-001): o
 * sistema a mede em pixels da tela, e a página, em pixels do zoom. A tela lê a altura de volta em `env(titlebar-area-height)`, já no zoom, e fica alinhada em
 * qualquer valor. A cor dos símbolos nasce a do tema escuro, o padrão, e a tela manda a do tema em uso antes de a janela aparecer (`prism:window-bar`).
 */
export const windowBarHeight = 53;

export function hasWindowBar(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function windowBarOptions(platform: NodeJS.Platform, zoomFactor: number): Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (!hasWindowBar(platform)) return {};
  return { titleBarStyle: "hidden", titleBarOverlay: { color: "rgba(0, 0, 0, 0)", symbolColor: "#b4bcc8", height: windowBarOverlayHeight(zoomFactor) } };
}

export function windowBarOverlayHeight(zoomFactor: number): number {
  return Math.round(windowBarHeight * zoomFactor);
}

/** A cor dos símbolos que a tela manda: só `#rrggbb`, que é como ela converte a cor calculada do tema. */
export function isSymbolColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
