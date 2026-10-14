import { useEffect } from "react";

import { refreshKey } from "./grid-editing";

/** Onde a vista à vista de uma aba de tabela deixa o "Atualizar" dela, para o F5 da aba o chamar (RN-GRADE-012). */
export type RefreshSlot = { set: (refresh: (() => void) | null) => void; get: () => (() => void) | null };

/** Um lugar vazio, um por aba (o painel o cria uma vez). */
export function createRefreshSlot(): RefreshSlot {
  let held: (() => void) | null = null;
  return {
    set: (refresh) => {
      held = refresh;
    },
    get: () => held,
  };
}

/**
 * F5 na aba (RN-GRADE-012): com o foco em qualquer ponto dela, a tecla sozinha chama o "Atualizar" da vista à vista e não segue (devolve `true`). A tecla que
 * alguém já tratou (`defaultPrevented`) e as outras seguem. O campo de edição da célula não deixa a tecla subir, e por isso F5 não vale dentro dele.
 */
export function refreshFromKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault: () => void }, slot: RefreshSlot): boolean {
  if (event.defaultPrevented || !refreshKey(event)) return false;
  event.preventDefault();
  slot.get()?.();
  return true;
}

/** A vista deixa o "Atualizar" dela na aba enquanto está montada (a que sai da tela o tira, se ainda é o dela). */
export function useRefreshSlot(slot: RefreshSlot | undefined, refresh: () => void): void {
  useEffect(() => {
    if (slot === undefined) return;
    slot.set(refresh);
    return () => {
      if (slot.get() === refresh) slot.set(null);
    };
  }, [slot, refresh]);
}
