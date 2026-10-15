import { queryOptions } from "@tanstack/react-query";

import { currentAppZoom } from "@/lib/api/bridge";

/**
 * O zoom do programa inteiro (RN-ZOOM-001), que o processo principal guarda e aplica, para Configurações › Aparência mostrar e mudar. Lido de novo a cada
 * visita às Configurações: os atalhos o mudam com elas fechadas, e com elas abertas o aviso da ponte (`onAppZoomChanged`) põe o valor novo aqui. Sem zoom
 * (fora do Electron, ou a ponte que não respondeu) a resposta é `null`, e a tela passa sem o controle: por isso a consulta é calada, sem aviso.
 */
export const appZoomQuery = queryOptions({
  queryKey: ["app-zoom"],
  queryFn: currentAppZoom,
  refetchOnWindowFocus: false,
  meta: { silent: true },
});

/** A tecla do atalho como a plataforma a escreve, para a dica: Cmd no macOS, Ctrl nas outras (`navigator.platform`). */
export function zoomShortcutModifier(platform: string): "Cmd" | "Ctrl" {
  return /mac|iphone|ipad/i.test(platform) ? "Cmd" : "Ctrl";
}
