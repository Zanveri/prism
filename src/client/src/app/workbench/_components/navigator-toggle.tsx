import { WorkbenchIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { navigatorCopy } from "../_lib/navigator.copy";

const copy = navigatorCopy.layout;

type NavigatorToggleProps = {
  hidden: boolean;
  /** O `id` do navegador, que o botão mostra e esconde. */
  controls?: string;
  /** O atalho, para a dica (Ctrl+B, ou Cmd+B no macOS). */
  shortcut?: string;
  label?: string;
  showHint?: string;
  hideHint?: string;
  onToggle: () => void;
};

/**
 * O botão que mostra e esconde o navegador (RN-NAV-008), na barra superior, logo depois da marca, como no canvas (`Workbench.dc.html`):
 * continua à vista com o navegador escondido, e é por ele (ou por Ctrl+B) que o navegador volta. É um botão de alternar: o nome é fixo
 * ("Mostrar o navegador") e o estado é o `aria-pressed`; a dica diz o que o clique faz agora, com o atalho.
 */
export function NavigatorToggle({
  hidden,
  controls,
  shortcut = "Ctrl+B",
  label = copy.toggle,
  showHint = copy.show,
  hideHint = copy.hide,
  onToggle,
}: NavigatorToggleProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!hidden}
      aria-controls={controls}
      title={`${hidden ? showHint : hideHint} (${shortcut})`}
      onClick={onToggle}
      className={cn("flex size-9 flex-none cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-selected hover:text-ink", hidden ? "text-muted" : "bg-selected text-ink")}
    >
      <WorkbenchIcon />
    </button>
  );
}
