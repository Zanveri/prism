type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented">;

/**
 * Ctrl+vírgula (Cmd+vírgula no macOS) abre as Configurações de qualquer tela de dentro do cofre (RN-CONFIG-001). Quem já
 * tratou a tecla fica com ela: um diálogo aberto, por exemplo, para a propagação do teclado antes de chegar à janela.
 */
export function isOpenSettingsShortcut(event: KeyEventLike): boolean {
  return event.key === "," && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.defaultPrevented;
}

/** Esc fecha as Configurações e volta à área de trabalho. A lista aberta de um campo trata o Esc primeiro (e o marca como tratado). */
export function isCloseSettingsKey(event: KeyEventLike): boolean {
  return event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.defaultPrevented;
}
