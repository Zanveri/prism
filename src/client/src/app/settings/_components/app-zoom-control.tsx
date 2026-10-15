import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, MinusIcon, PlusIcon } from "@/components/ui";
import { onAppZoomChanged, requestAppZoom } from "@/lib/api/bridge";

import { appZoomSteps, defaultAppZoom, nextAppZoom, type AppZoom, type ZoomStep } from "../../../../electron/zoom";
import { appZoomQuery, zoomShortcutModifier } from "../_lib/app-zoom";
import { settingsCopy } from "../_lib/settings.copy";

const copy = settingsCopy.appearance.zoom;

const smallest = appZoomSteps[0];
const largest = appZoomSteps[appZoomSteps.length - 1];

/** O botão de ícone do controle, do tamanho dos campos pequenos das Configurações. */
const iconButton =
  "flex size-9 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-selected hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted";

/** O "Restaurar 100%" em 100%: o mesmo apagado do `disabled` do `Button`, por `aria-disabled`. */
const resetDisabled = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent";

type AppZoomViewProps = {
  zoom: AppZoom;
  /** Ctrl ou Cmd, para a dica. */
  modifier: string;
  onStep: (step: ZoomStep) => void;
};

/**
 * O controle do zoom do programa (RN-ZOOM-001), só o desenho: diminuir, o valor de agora (lido pelo leitor de tela quando muda) e aumentar, e
 * "Restaurar 100%". Nos limites (50% e 200%) o botão que não anda mais fica desabilitado, e em 100% o "Restaurar" também, e o clique nele não pede nada.
 *
 * Desabilitado por `aria-disabled`, e não `disabled`: o botão que se desabilita ao ser usado (o "Restaurar", sempre; o − e o + ao chegar ao limite) fica
 * com o foco, em vez de o Chromium o mandar para o corpo da página e quem usa teclado ou leitor de tela perder o lugar em Configurações.
 */
export function AppZoomView({ zoom, modifier, onStep }: AppZoomViewProps) {
  const atSmallest = zoom <= smallest;
  const atLargest = zoom >= largest;
  const atDefault = zoom === defaultAppZoom;

  return (
    <div className="flex flex-col gap-1.5">
      <span id="cfg-zoom-rotulo" className="text-sm text-muted">
        {copy.label}
      </span>
      <div role="group" aria-labelledby="cfg-zoom-rotulo" aria-describedby="cfg-zoom-dica" className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-md border border-border-strong bg-raised">
          <button
            type="button"
            aria-label={copy.zoomOut}
            title={copy.zoomOut}
            aria-disabled={atSmallest ? true : undefined}
            onClick={() => {
              if (!atSmallest) onStep("out");
            }}
            className={iconButton}
          >
            <MinusIcon />
          </button>
          <output aria-live="polite" className="min-w-14 text-center font-semibold text-ink tabular-nums">
            {copy.value(zoom)}
          </output>
          <button
            type="button"
            aria-label={copy.zoomIn}
            title={copy.zoomIn}
            aria-disabled={atLargest ? true : undefined}
            onClick={() => {
              if (!atLargest) onStep("in");
            }}
            className={iconButton}
          >
            <PlusIcon />
          </button>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-disabled={atDefault ? true : undefined}
          onClick={() => {
            if (!atDefault) onStep("reset");
          }}
          className={resetDisabled}
        >
          {copy.reset}
        </Button>
      </div>
      <p id="cfg-zoom-dica" className="text-xs text-muted">
        {copy.hint(modifier)}
      </p>
    </div>
  );
}

/**
 * O zoom do programa em Configurações › Aparência (RN-ZOOM-001). O valor é o do processo principal, e cada pedido vai a ele, que aplica em todas as janelas,
 * grava e devolve o que ficou; os atalhos (nesta janela ou noutra) chegam pelo aviso da ponte. Fora do Electron não há zoom do programa, e o controle não
 * aparece.
 */
export function AppZoomControl() {
  const queryClient = useQueryClient();
  const zoom = useQuery(appZoomQuery).data ?? null;

  useEffect(() => onAppZoomChanged((changed) => queryClient.setQueryData(appZoomQuery.queryKey, changed)), [queryClient]);

  if (zoom === null) return null;

  function step(direction: ZoomStep) {
    if (zoom === null) return;
    // O passo que não anda mais (nos limites, ou "Restaurar" em 100%) não pede nada.
    const next = nextAppZoom(zoom, direction);
    if (next === zoom) return;
    void requestAppZoom(next).then((applied) => {
      if (applied !== null) queryClient.setQueryData(appZoomQuery.queryKey, applied);
    });
  }

  return <AppZoomView zoom={zoom} modifier={zoomShortcutModifier(typeof navigator === "undefined" ? "" : navigator.platform)} onStep={step} />;
}
