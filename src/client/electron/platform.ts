import type { MenuItemConstructorOptions } from "electron";

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
