import { Button, PlugIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { navigatorCopy } from "../_lib/navigator.copy";

const copy = navigatorCopy.connectedFilter;

type NavigatorConnectedFilterProps = {
  /** Quantas conexões estão conectadas (RN-NAV-013), ligado ou não: é o que o colega pediu, saber se há conexões abertas. */
  count: number;
  on: boolean;
  onToggle: () => void;
};

/**
 * "Só as conectadas" (RN-NAV-013), na linha abaixo do campo de busca, à esquerda do seletor de ambiente (`NavigatorFilters`): um botão de alternar
 * (`aria-pressed`) que mostra quantas conexões estão conectadas ("3 conectadas", "Nenhuma conectada"). Tem a largura do texto (`flex-none`, sem quebra), que
 * nunca é cortado: quem encolhe e quem desce é o seletor. O nome acessível é o rótulo com a conta, e a dica diz o que o clique faz agora, como o botão do
 * navegador da barra superior. É um `<button>`: o Tab o alcança, e Enter e Espaço o alternam. Sem estado: a escolha é do navegador.
 */
export function NavigatorConnectedFilter({ count, on, onToggle }: NavigatorConnectedFilterProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? copy.showAll : copy.showOnly}
      onClick={onToggle}
      className={cn(
        "flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap transition-colors hover:text-ink",
        on ? "border-accent bg-selected text-ink" : "border-border-strong text-muted hover:bg-selected",
      )}
    >
      <PlugIcon className={cn("flex-none", count > 0 && "text-success")} />
      <span className="sr-only">{`${copy.label}: `}</span>
      <span>{copy.count(count)}</span>
    </button>
  );
}

/**
 * A árvore vazia pelos filtros (RN-NAV-010 e 013): o ambiente escolhido (`environment`: o nome; `null`, "Sem ambiente"; `undefined`, todos) e, com "Só as
 * conectadas" ligado, "Nenhuma conexão conectada." com "Mostrar todas", que o desliga (o ambiente escolhido fica).
 */
export function NavigatorFilteredEmpty({ environment, onlyConnected, onShowAll }: { environment: string | null | undefined; onlyConnected: boolean; onShowAll: () => void }) {
  if (!onlyConnected) {
    return (
      <p role="status" className="px-3 py-2 text-muted">
        {environment === null || environment === undefined ? navigatorCopy.environmentFilter.nothingWithout : navigatorCopy.environmentFilter.nothingIn(environment)}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 px-3 py-2">
      <p role="status" className="text-muted">
        {environment === undefined ? copy.nothing : environment === null ? copy.nothingWithout : copy.nothingIn(environment)}
      </p>
      <Button type="button" variant="secondary" size="compact" onClick={onShowAll} className="h-7 px-2.5 text-xs">
        {copy.clear}
      </Button>
    </div>
  );
}
