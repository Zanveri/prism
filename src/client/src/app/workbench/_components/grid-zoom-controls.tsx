import type { GridZoom } from "@/app/settings/_lib/preferences";
import { PlusIcon } from "@/components/ui";

import { cn } from "@/lib/utils/cn";

import { canZoomIn, canZoomOut, zoomIn, zoomLabel, zoomOut } from "../_lib/grid-zoom";
import { recordsCopy } from "../_lib/records.copy";
import { controlHeight, iconControlSize, type ControlSize } from "../_lib/result-bar";

const copy = recordsCopy.grid;

/** O menos do zoom, no traço dos outros ícones (16×16, 1,5); o mais é o `PlusIcon` do conjunto. */
function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="minus" className="flex-none">
      <path d="M3 8h10" />
    </svg>
  );
}

/** O botão de ícone da barra do resultado: o mesmo dos botões de recolher e maximizar (`result-actions.tsx`). */
const iconButton = "flex cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

type GridZoomControlsProps = {
  zoom: GridZoom;
  onZoom: (zoom: GridZoom) => void;
  /** RN-ABAS-009: 24 px na barra da área de resultado da aba de consulta; 28 px nos Registros. */
  size?: ControlSize;
};

/**
 * O zoom da grade na barra do resultado (RN-GRADE-010): diminuir, o valor de agora (clicar volta a 100%) e aumentar, cada um com nome para o leitor de tela;
 * nos limites (50% e 200%) o botão que não anda mais fica desabilitado. Ctrl+roda sobre a grade faz o mesmo (`ResultGrid`).
 */
export function GridZoomControls({ zoom, onZoom, size = "regular" }: GridZoomControlsProps) {
  return (
    <div role="group" aria-label={copy.zoom} className="flex items-center gap-0.5 pl-1">
      <button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} disabled={!canZoomOut(zoom)} onClick={() => onZoom(zoomOut(zoom))} className={cn(iconButton, iconControlSize[size])}>
        <MinusIcon />
      </button>
      <button type="button" aria-label={copy.zoomReset(zoomLabel(zoom))} title={copy.zoomResetHint} onClick={() => onZoom(100)} className={cn("min-w-11 cursor-pointer rounded-sm px-1 text-center text-xs text-muted tabular-nums transition-colors hover:bg-selected hover:text-ink", controlHeight[size])}>
        {zoomLabel(zoom)}
      </button>
      <button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} disabled={!canZoomIn(zoom)} onClick={() => onZoom(zoomIn(zoom))} className={cn(iconButton, iconControlSize[size])}>
        <PlusIcon />
      </button>
    </div>
  );
}
