/**
 * Diálogos, menus e a lista de um `Select` abertos vivem em portais no `body` (`Dialog`, `ContextMenu`, `Select`), fora da árvore de
 * qualquer tela. O que tem `role` de diálogo ou de menu, e o `Select` com a lista aberta (o `combobox` expandido).
 */
export const openPortalsSelector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="combobox"][aria-expanded="true"]';

/**
 * O bloqueio por inatividade fecha o que estiver aberto por portal (RN-SEG-001): um diálogo de confirmação, um menu de contexto, um
 * "Renomear pasta" com o nome pela metade. Cada um fecha pelo próprio `Esc`, que respeita o que ele já respeita (o diálogo que só se
 * resolve por um botão, ou que tem uma ação em andamento, não fecha): nenhum componente precisa saber do bloqueio.
 *
 * Fica de fora a tela de bloqueio, que é o que está aberto agora, e o diálogo de versão nova (RN-ATUALIZA-003): não é do cofre, e
 * sair dele é "Depois", uma escolha da pessoa.
 */
export function closeOpenPortals(root: Pick<ParentNode, "querySelectorAll">): void {
  for (const element of root.querySelectorAll(openPortalsSelector)) {
    if (element.hasAttribute("data-lock-screen") || element.querySelector("[data-update-dialog]") !== null) continue;

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }
}
