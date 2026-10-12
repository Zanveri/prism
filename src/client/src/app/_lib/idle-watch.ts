/** O que conta como "mexer" (RN-SEG-001): teclado, ponteiro e roda. */
const activityEvents = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

type Target = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * A fiação dos eventos da janela ao temporizador do bloqueio por inatividade, sem React e com os alvos injetados (é o que os testes
 * conferem). Devolve a função que solta tudo.
 *
 * - A atividade é ouvida na captura e sem poder cancelar o evento: um diálogo ou um editor que para a propagação (o `Dialog` o faz com o
 *   teclado) não esconde dela que a pessoa está digitando.
 * - Só conta o que a pessoa faz (`isTrusted`): um evento que um programa dispara na página não mantém o Prism desbloqueado.
 * - O `pointermove` sem o ponteiro sair do lugar não conta: o navegador o repete quando o que está debaixo dele muda (um aviso que some,
 *   uma animação), e isso não é a pessoa.
 * - `timer.activity()` devolve falso quando o prazo já tinha acabado (a janela dormiu e os temporizadores pararam): o toque que a
 *   acordou não reinicia nada, e a conferência (`check`) bloqueia na hora.
 * - A janela voltar a aparecer também confere na hora: o navegador atrasa os temporizadores de uma janela escondida.
 */
export function watchActivity({ window, document, timer, check }: { window: Target; document: Target; timer: { activity: () => boolean }; check: () => void }): () => void {
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  function onActivity(event: Event) {
    if (!event.isTrusted) return;

    if (event.type === "pointermove") {
      const { screenX, screenY } = event as MouseEvent;
      if (screenX === lastX && screenY === lastY) return;
      lastX = screenX;
      lastY = screenY;
    }

    if (!timer.activity()) check();
  }

  function onVisibility() {
    check();
  }

  for (const type of activityEvents) window.addEventListener(type, onActivity, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    for (const type of activityEvents) window.removeEventListener(type, onActivity, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
