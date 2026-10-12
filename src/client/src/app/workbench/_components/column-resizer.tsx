import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { clampWidth, dragWidth, maxWidth, minWidth, resizeKeyAction } from "../_lib/grid-columns";
import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.grid;

type ColumnResizerProps = {
  /** O nome da coluna, para o leitor de tela. */
  name: string;
  /** A largura de agora, a 100% de zoom (`grid-columns.ts`). */
  width: number;
  /** O zoom da grade (RN-GRADE-010): o ponteiro anda na escala dele. */
  zoom: number;
  /** A última coluna: a divisa fica dentro dela, e não encavalada na borda, para não alargar a área rolável. */
  last: boolean;
  /** A largura nova, a 100% de zoom e já entre os limites. */
  onResize: (width: number) => void;
  /** Ajustar a coluna ao conteúdo (o duplo clique; o Enter com o foco aqui). */
  onFit: () => void;
};

/**
 * A divisa à direita do cabeçalho de uma coluna (RN-GRADE-009): arrastar com o botão principal alarga ou estreita a coluna, o duplo clique a ajusta ao
 * conteúdo, e com o foco nela as setas mudam a largura (`resizeKeyAction`). É um `separator` vertical focável, no padrão da divisória entre o editor e o
 * resultado (RN-PAINEL-001): o ponteiro fica capturado (soltar fora da grade, ou fora da janela, termina o arrasto), e o arrasto termina também ao cancelar o
 * ponteiro e ao perder a captura. A divisa é IRMÃ do botão do cabeçalho, e não filha: o clique que termina um arrasto não chega a ele e não ordena a coluna.
 * A área de pegar tem 8 px em qualquer zoom, sobre a borda da coluna; a linha de destaque acende com o ponteiro em cima, com o foco e durante o arrasto.
 */
export function ColumnResizer({ name, width, zoom, last, onResize, onFit }: ColumnResizerProps) {
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    // Só o botão principal arrasta: o do meio e o direito têm outro uso e não podem deixar a divisa presa ao ponteiro.
    if (event.button !== 0) return;

    // Sem isto o arrasto seleciona o texto das células por onde o ponteiro passa.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, width });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag !== null) onResize(dragWidth(drag, event.clientX, zoom));
  }

  const stopDragging = () => setDrag(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = resizeKeyAction(event.key, event.shiftKey);
    if (action === null) return;

    // A tecla é da divisa: nem a página rola, nem quem envolve a grade a trata de novo.
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "fit") onFit();
    else onResize(action.type === "min" ? minWidth : clampWidth(width + action.delta));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={copy.resizeColumn(name)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={copy.columnWidth(width)}
      title={copy.resizeHint}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onDoubleClick={onFit}
      onKeyDown={handleKeyDown}
      // Acima das células do cabeçalho (a da coluna seguinte começa embaixo da metade direita) e abaixo do "#" preso à esquerda (`z-10`). A área de pegar e a
      // linha têm medidas em pixels, e não da escala do Tailwind: o zoom da grade (RN-GRADE-010) escala os espaços dela, e em 50% a área teria 4 px.
      className={`absolute top-0 ${last ? "right-0" : "-right-[4px]"} z-[5] h-full w-[8px] cursor-col-resize touch-none select-none -outline-offset-2 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:transition-colors hover:after:bg-accent/60 focus-visible:after:bg-accent data-[dragging]:after:bg-accent`}
      data-dragging={drag === null ? undefined : ""}
    />
  );
}
