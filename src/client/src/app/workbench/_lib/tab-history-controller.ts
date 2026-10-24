import { emptyHistory, keyHistoryAction, mouseHistoryAction, pruneHistory, recordTab, stepHistory, type HistoryAction, type HistoryFocus, type TabHistory } from "./tab-history";

/**
 * O histórico de Voltar e Avançar de uma janela de abas (RN-ABAS-018) sem React: guarda a conta de `tab-history.ts`, decide o que cada botão do mouse e cada
 * tecla faz em cada tela e chama quem ativa a aba. O gancho `useTabHistory` só liga isto à área de trabalho, às rotas e à janela.
 */

/** Onde a janela está: a área de trabalho, as Configurações (por cima dela), ou outra tela (login, desbloqueio). */
export type HistoryScreen = "workbench" | "settings" | "other";

export type TabHistoryDeps = {
  screen: () => HistoryScreen;
  /** As abas que a janela tem agora. */
  openTabs: () => ReadonlySet<string>;
  /** Ativa a aba pelo mesmo caminho do clique nela. */
  activate: (tabId: string) => void;
  /** Sai das Configurações para a área de trabalho, como o "Voltar" da página. */
  leaveSettings: () => void;
  /** Um diálogo modal aberto ou o cofre bloqueado: nada de Voltar e Avançar por baixo dele. */
  blocked: () => boolean;
  mac: boolean;
};

type KeyEventLike = { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean; target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void };
type MouseEventLike = { button: number; preventDefault: () => void };

export type TabHistoryController = ReturnType<typeof createTabHistory>;

export function createTabHistory(deps: TabHistoryDeps) {
  let history: TabHistory = emptyHistory;
  /** A aba que o último Voltar ou Avançar ativou e ainda não recebeu o foco. */
  let focusPending: string | null = null;
  /**
   * O botão "voltar" ou "avançar" do mouse estava bloqueado (menu ou lista aberta, diálogo, cofre bloqueado) quando foi apertado? `null`: não se sabe (não houve
   * `pointerdown`). O menu e a lista fecham no `pointerdown` de qualquer botão, antes de o botão ser solto: no `mouseup` já não estão no DOM, e o mesmo clique que os
   * fechou também voltaria uma aba. Vale o que se viu ao apertar.
   */
  let pressBlocked: boolean | null = null;

  /** A aba ativa da janela é `activeTabId` (nulo: nenhuma). As abas que saíram saem do histórico antes de a nova entrar. */
  function observe(open: ReadonlySet<string>, activeTabId: string | null) {
    const pruned = pruneHistory(history, open);
    history = activeTabId === null ? pruned : recordTab(pruned, activeTabId);
  }

  /** Zera (o cofre bloqueou). */
  function reset() {
    history = emptyHistory;
  }

  function run(action: HistoryAction) {
    focusPending = null;
    const screen = deps.screen();
    // Nas Configurações, Voltar volta à área de trabalho, como o "Voltar" da página; Avançar não faz nada.
    if (screen === "settings") {
      if (action === "back") deps.leaveSettings();
      return;
    }
    if (screen !== "workbench") return;

    const step = stepHistory(history, deps.openTabs(), action === "back" ? -1 : 1);
    history = step.history;
    if (step.tabId === null) return;

    focusPending = step.tabId;
    deps.activate(step.tabId);
  }

  /** A tela de agora trata Voltar e Avançar? Não trata com um diálogo modal aberto ou o cofre bloqueado. */
  const listening = () => !deps.blocked();

  return {
    observe,
    reset,
    run,
    listening,
    entries: () => history,

    /** A aba ativa agora é a que o Voltar ou o Avançar pediu? Diz que sim uma vez só: quem pergunta põe o foco nela. */
    takeFocus(activeTabId: string): boolean {
      const pending = focusPending === activeTabId;
      focusPending = null;
      return pending;
    },

    /** O botão do mouse apertado, visto na fase de captura da janela, antes de quem fecha os menus e as listas: guarda se havia algo aberto (ver `pressBlocked`). */
    onPointerDown(event: Pick<MouseEventLike, "button">) {
      pressBlocked = mouseHistoryAction(event.button) === null ? null : !listening();
    },

    /** O botão do mouse solto: Voltar ou Avançar, em qualquer tela (fora da área de trabalho e das Configurações, nada). Quem segura o clique do Chromium é `blockHistoryButtons`. */
    onMouseUp(event: MouseEventLike) {
      const action = mouseHistoryAction(event.button);
      const blockedAtPress = pressBlocked;
      pressBlocked = null;
      if (action === null) return;

      event.preventDefault();
      if (blockedAtPress !== true && listening()) run(action);
    },

    /**
     * A tecla, vista na fase de captura da janela, antes de qualquer tela: as setas são de muitos componentes (a faixa de abas, a grade, as árvores, as listas)
     * e nenhum deles confere o Alt, então na bolha a tecla já teria sido gasta por quem estivesse com o foco. Tratada, não chega a ninguém: nem ao
     * CodeMirror, onde o Alt+← anda pela sintaxe. A que alguém já tratou fica com quem tratou.
     */
    onKeyDown(event: KeyEventLike) {
      if (event.defaultPrevented || !listening()) return;

      const action = keyHistoryAction(event, { mac: deps.mac, focus: focusKindOf(event.target) });
      if (action === null) return;

      event.preventDefault();
      event.stopPropagation();
      run(action);
    },
  };
}

type Closest = { closest?: (selector: string) => unknown };

/**
 * Onde o foco está. O editor de SQL marca o conteúdo dele com `data-sql-editor`; os campos de texto são `input`, `textarea` e o que é editável
 * (o campo de edição da célula, o filtro, que também é um editor do CodeMirror).
 */
export function focusKindOf(target: EventTarget | null): HistoryFocus {
  const element = target as Closest | null;
  if (element === null || typeof element.closest !== "function") return "other";
  if (element.closest("[data-sql-editor]") !== null) return "editor";
  return element.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') === null ? "other" : "text";
}
