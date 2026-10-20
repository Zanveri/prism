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
 * A tecla que o menu do app não recebe (RN-GRADE-012, RN-GRADE-013 e RN-ABAS-014): F5, F6 e F11, com qualquer modificador, e Ctrl+R (Cmd+R), com ou sem Shift.
 * O app empacotado do Windows e do Linux não tem menu, e o do macOS não tem Recarregar; o menu padrão de desenvolvimento tem Recarregar (Ctrl+R), Forçar
 * recarga (Ctrl+Shift+R) e Tela cheia (F11), e o Chromium do Electron não recarrega nada sem menu. Ignorado pelo menu (`setIgnoreMenuShortcuts`, a cada
 * tecla, no `before-input-event`), o atalho chega à tela como qualquer tecla: F5 atualiza a aba, F6 alterna entre o editor e o resultado, F11 abre o
 * "Filtrar" da grade, e Ctrl+R não faz nada.
 */
export function menuShortcutIgnored(input: { key: string; control: boolean; meta: boolean }): boolean {
  if (input.key === "F5" || input.key === "F6" || input.key === "F11") return true;
  return (input.control || input.meta) && input.key.toLowerCase() === "r";
}
