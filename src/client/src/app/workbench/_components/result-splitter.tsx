import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { maxResultPercent, minResultPercent, percentFromPointer, splitterKeyAction, type PaneAction } from "../_lib/result-layout";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.result;

type ResultSplitterProps = {
  /** O elemento que tem o editor e a área de resultado: a altura que a divisória reparte. */
  area: RefObject<HTMLElement | null>;
  /** O `id` da área de resultado, que a divisória controla. */
  controls: string;
  resultPercent: number;
  dispatch: (action: PaneAction) => void;
};

/**
 * A divisória entre o editor e a área de resultado (RN-PAINEL-001): arrastar com o botão principal do mouse, ou as
 * setas com o foco nela (para cima o resultado cresce; Home e End vão aos limites). É um
 * `separator` focável, como a do navegador, e só existe com a divisão à mostra. O arrasto termina ao soltar o botão,
 * ao cancelar o ponteiro e ao perder a captura (a janela perdeu o foco, o elemento saiu da página), e não seleciona o texto que passa por baixo.
 */
export function ResultSplitter({ area, controls, resultPercent, dispatch }: ResultSplitterProps) {
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    // Só o botão principal arrasta: o do meio e o direito têm outro uso e não podem deixar a divisória presa ao ponteiro.
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  const stopDragging = () => setDragging(false);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const element = area.current;
    if (!dragging || element === null) return;

    dispatch({ type: "resize", percent: percentFromPointer(event.clientY, element.getBoundingClientRect()) });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = splitterKeyAction(event.key);
    if (action === null) return;

    event.preventDefault();
    dispatch(action);
  }

  const now = Math.round(resultPercent);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={copy.resize}
      aria-controls={controls}
      aria-valuemin={minResultPercent}
      aria-valuemax={maxResultPercent}
      aria-valuenow={now}
      aria-valuetext={copy.resizeValue(now)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={handleKeyDown}
      className="-my-0.5 z-10 h-1 w-full flex-none cursor-row-resize touch-none bg-transparent select-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 data-[dragging]:bg-accent"
      data-dragging={dragging ? "" : undefined}
    />
  );
}
