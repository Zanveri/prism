import { useState, type ComponentProps } from "react";

import { ContextMenu } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { iconControlSize } from "../_lib/result-bar";
import { placeButtonLabel, type PlaceMenuItem } from "../_lib/result-place";
import { resultPlaceCopy } from "../_lib/result-place.copy";
import type { ResultPlace } from "../_lib/workbench-model";
import { placeButtonAttribute } from "./result-host";

const copy = resultPlaceCopy;

/** Os ícones do lugar do resultado, no traço dos outros (16×16, traço de 1,5): ficam aqui porque só a aba do resultado e o botão do lugar os usam. */
function PlaceIcon({ className, ...props }: ComponentProps<"svg">) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("flex-none", className)} {...props} />;
}

/** RN-ABAS-012: o ícone da aba do resultado, uma grade de três por três (diferente do ícone da aba de tabela, que tem o cabeçalho). */
export function ResultTabIcon(props: ComponentProps<"svg">) {
  return (
    <PlaceIcon data-icon="table" {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6h12M2 10h12M6 2v12M10 2v12" />
    </PlaceIcon>
  );
}

/** RN-ABAS-014: o ícone de "Onde mostrar o resultado", uma janela com o painel de baixo marcado. */
export function ResultPlaceIcon(props: ComponentProps<"svg">) {
  return (
    <PlaceIcon data-icon="panel" {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 9h12" />
      <path d="M4 11.25h8" strokeWidth="2" />
    </PlaceIcon>
  );
}

/** O botão de ícone da barra do resultado: o mesmo do zoom, da atualização automática e dos botões de recolher e maximizar (24 px, RN-ABAS-009). */
const iconButton = cn("flex cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink", iconControlSize.bar);

type ResultPlaceButtonProps = {
  place: ResultPlace;
  /** Os itens do menu, com o lugar de agora marcado (`placeMenu`). */
  items: PlaceMenuItem[];
  onChoose: (place: ResultPlace) => void;
};

/**
 * "Onde mostrar o resultado" (RN-ABAS-014), na barra da área de resultado, onde quer que ela esteja: logo antes do recolher e do maximizar (no painel), na
 * ponta direita (na aba) ou logo antes de "Voltar para o painel" (na janela). Abre o menu do app com os lugares, de escolha única (`menuitemradio`), com o de
 * agora marcado; o menu devolve o foco ao botão. O nome e a dica dizem o lugar de agora. É o alvo do foco que a troca pede (`placeButton`) e o do F6 sem grade.
 */
export function ResultPlaceButton({ place, items, onChoose }: ResultPlaceButtonProps) {
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; keyboard: boolean } | null>(null);
  const label = placeButtonLabel(place);

  return (
    <>
      <button
        type="button"
        {...{ [placeButtonAttribute]: "" }}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={label}
        title={label}
        onClick={(event) => {
          // O clique do Enter e do Espaço não tem `detail`: o foco vai ao primeiro item.
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ point: { x: rect.left, y: rect.bottom + 2 }, keyboard: event.detail === 0 });
        }}
        className={iconButton}
      >
        <ResultPlaceIcon />
      </button>
      {menu === null ? null : (
        <ContextMenu
          label={copy.button.menuLabel}
          point={menu.point}
          initialFocus={menu.keyboard ? "first" : "menu"}
          groups={[items.map((item) => ({ id: `place:${item.place}`, label: item.label, checked: item.checked, disabled: item.disabled, hint: item.hint, onSelect: () => onChoose(item.place) }))]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
