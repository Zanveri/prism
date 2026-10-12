import type { FocusEvent, KeyboardEvent, SyntheticEvent } from "react";

/**
 * O que o `<dialog>` modal da tela de bloqueio faz com o que lhe acontece (RN-SEG-001): nada o fecha e nada leva o foco dele. Funções puras,
 * que agem no próprio diálogo do evento (`currentTarget`): é o que os testes exercitam.
 */
export function lockDialogHandlers() {
  return {
    /** O Esc de um diálogo modal o cancela: aqui, não. */
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => event.preventDefault(),

    /** O teclado não passa daqui, para nenhum atalho da janela agir; e o Esc não faz o que faria por padrão. */
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
      event.stopPropagation();
      if (event.key === "Escape") event.preventDefault();
    },

    /**
     * Se mesmo assim o navegador o fechou (o Chromium não deixa cancelar o Esc de um diálogo duas vezes seguidas sem uma ação da pessoa
     * no meio), abre de novo: a tela de bloqueio não sai por isso.
     */
    onClose: (event: SyntheticEvent<HTMLDialogElement>) => {
      const dialog = event.currentTarget;
      if (!dialog.open) dialog.showModal();
    },

    /** Um clique numa área em branco leva o foco ao próprio diálogo, onde o que a pessoa digitar se perderia: ele volta ao campo de senha. */
    onFocus: (event: FocusEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) event.currentTarget.querySelector<HTMLInputElement>('[name="password"]')?.focus();
    },
  };
}

/**
 * O teclado que vem de FORA do diálogo (o foco foi parar no `body`) não chega aos atalhos da janela (`SettingsShortcut` abre as Configurações
 * por um ouvinte de `keydown` em `window`), e o Esc que vem de fora também não fecha o diálogo. O que vem de dentro passa: é a senha sendo
 * digitada, e o próprio diálogo cuida do resto (`onKeyDown`). Devolve a função que solta o ouvinte.
 */
export function blockOutsideKeys(window: Pick<EventTarget, "addEventListener" | "removeEventListener">, isInside: (target: EventTarget | null) => boolean): () => void {
  function block(event: Event) {
    if (isInside(event.target)) return;

    event.stopImmediatePropagation();
    if ((event as globalThis.KeyboardEvent).key === "Escape") event.preventDefault();
  }

  window.addEventListener("keydown", block, true);
  return () => window.removeEventListener("keydown", block, true);
}
