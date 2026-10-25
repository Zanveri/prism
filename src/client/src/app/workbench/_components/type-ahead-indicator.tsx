import { cn } from "@/lib/utils/cn";

import { navigatorCopy } from "../_lib/navigator.copy";
import type { TypeAheadShown } from "../_lib/use-type-ahead";

const copy = navigatorCopy.typeAhead;

/**
 * O indicador de ir ao item pelas primeiras letras (RN-ARVORE-009): o texto digitado ("Ir para: bat") num cantinho do pé da árvore, sobre a lista, enquanto o
 * texto dura; sem item que comece por ele, a frase vira "Nenhum item começa com “xyz”", em tom de aviso. É só do olho (`aria-hidden`, sem pegar o mouse):
 * o item achado o leitor de tela já ouve pelo foco, e o "nenhum item" ele ouve pela região `aria-live` (sempre montada, para o anúncio valer), com o texto
 * só quando não há item. Quem o usa lhe dá o canto: um ancestral posicionado (`relative`, ou o `sticky` da lista que rola com a página).
 */
export function TypeAheadIndicator({ shown }: { shown: TypeAheadShown | null }) {
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {shown !== null && !shown.found ? copy.none(shown.text) : ""}
      </p>
      {shown === null ? null : (
        <div aria-hidden className={cn("pointer-events-none absolute right-2 bottom-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-md border border-border-strong bg-raised px-2 py-1 text-xs shadow-lg", shown.found ? "text-ink" : "text-danger")}>
          {shown.found ? copy.typed(shown.text) : copy.none(shown.text)}
        </div>
      )}
    </>
  );
}
