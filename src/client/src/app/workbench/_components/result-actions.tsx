import type { ComponentProps } from "react";

import { ChevronIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { controlsOf, type PaneMode } from "../_lib/result-layout";
import { resultPlaceCopy } from "../_lib/result-place.copy";
import { closeShortcutLabel } from "../_lib/tab-strip";

/** Os ícones das duas ações, no traço dos outros (16×16, traço de 1,5): ficam aqui porque só a barra do resultado os usa. */
function PaneIcon({ className, ...props }: ComponentProps<"svg">) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("flex-none", className)} {...props} />;
}

/** Maximizar: os quatro cantos para fora. */
function MaximizeIcon() {
  return (
    <PaneIcon>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </PaneIcon>
  );
}

/** Restaurar o tamanho: os quatro cantos para dentro. */
function RestoreIcon() {
  return (
    <PaneIcon>
      <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
    </PaneIcon>
  );
}

const buttonClass = "flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink";

type ResultActionsProps = {
  mode: PaneMode;
  onAction: (action: "collapse" | "maximize" | "restore") => void;
};

/**
 * Os botões do fim da barra do resultado (RN-PAINEL-001): recolher ou restaurar a área, e maximizá-la
 * ou restaurá-la. Cada um é sempre o mesmo botão, só troca o que faz (`controlsOf`): o foco fica nele
 * depois do clique, e o rótulo acessível e a dica dizem a ação que vem.
 */
export function ResultActions({ mode, onAction }: ResultActionsProps) {
  const controls = controlsOf(mode);

  return (
    <div className="flex items-center gap-0.5 pl-1">
      <button type="button" aria-label={controls.collapse.label} title={controls.collapse.label} onClick={() => onAction(controls.collapse.action)} className={buttonClass}>
        {/* Recolhida, a seta aponta para onde a área vai abrir. */}
        <ChevronIcon className={cn("transition-transform", mode === "collapsed" && "rotate-180")} />
      </button>
      <button type="button" aria-label={controls.maximize.label} title={controls.maximize.label} onClick={() => onAction(controls.maximize.action)} className={buttonClass}>
        {mode === "maximized" ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
    </div>
  );
}

/**
 * "Voltar para o painel" (RN-ABAS-013), na ponta direita da barra da área de resultado na janela do resultado, com texto: volta o resultado ao painel da aba,
 * fecha a janela e traz à frente a janela da aba. O Ctrl+W (Cmd+W no macOS) com o foco na janela faz o mesmo, e a dica o diz.
 */
export function BackToPanelButton({ onClick }: { onClick: () => void }) {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;

  return (
    <div className="flex items-center pl-1">
      <button type="button" title={resultPlaceCopy.window.backHint(closeShortcutLabel(platform))} onClick={onClick} className="h-6 cursor-pointer rounded-sm px-2 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:bg-selected hover:text-ink">
        {resultPlaceCopy.window.back}
      </button>
    </div>
  );
}
