import type { GridZoom } from "@/app/settings/_lib/preferences";
import { PlusIcon } from "@/components/ui";

import { canZoomIn, canZoomOut, zoomIn, zoomLabel, zoomOut } from "../_lib/grid-zoom";
import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.grid;

/** O menos do zoom, no traço dos outros ícones (16×16, 1,5); o mais é o `PlusIcon` do conjunto. */
function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M3 8h10" />
    </svg>
  );
}

/** O botão de ícone da barra do resultado: o mesmo dos botões de recolher e maximizar (`result-actions.tsx`). */
const iconButton = "flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

type GridZoomControlsProps = {
  zoom: GridZoom;
  onZoom: (zoom: GridZoom) => void;
};

/**
 * O zoom da grade na barra do resultado (RN-GRADE-010): diminuir, o valor de agora (clicar volta a 100%) e aumentar, cada um com nome para o leitor de tela;
 * nos limites (50% e 200%) o botão que não anda mais fica desabilitado. Ctrl+roda sobre a grade faz o mesmo (`ResultGrid`).
 */
export function GridZoomControls({ zoom, onZoom }: GridZoomControlsProps) {
  return (
    <div role="group" aria-label={copy.zoom} className="flex items-center gap-0.5 pl-1">
      <button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} disabled={!canZoomOut(zoom)} onClick={() => onZoom(zoomOut(zoom))} className={iconButton}>
        <MinusIcon />
      </button>
      <button type="button" aria-label={copy.zoomReset(zoomLabel(zoom))} title={copy.zoomResetHint} onClick={() => onZoom(100)} className="h-7 min-w-11 cursor-pointer rounded-sm px-1 text-center text-xs text-muted tabular-nums transition-colors hover:bg-selected hover:text-ink">
        {zoomLabel(zoom)}
      </button>
      <button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} disabled={!canZoomIn(zoom)} onClick={() => onZoom(zoomIn(zoom))} className={iconButton}>
        <PlusIcon />
      </button>
    </div>
  );
}
