import { autoRefreshChoices, intervalLabel, type AutoRefreshBlocker, type AutoRefreshState } from "./auto-refresh";
import { autoRefreshCopy } from "./auto-refresh.copy";
import type { CellMenuGroup, CellMenuItem } from "./cell-menu";

const copy = autoRefreshCopy.menu;

/** As ações do submenu "Atualizar automaticamente": um intervalo (em milissegundos), o "Personalizado…" e "Desligar". */
export type AutoRefreshAction = `autoRefresh:every:${number}` | "autoRefresh:custom" | "autoRefresh:off";

/** A ação é da atualização automática? */
export function isAutoRefreshAction(action: string): action is AutoRefreshAction {
  return action.startsWith("autoRefresh:");
}

/** O intervalo de uma ação "a cada…", ou nulo para as outras. */
export function intervalOf(action: AutoRefreshAction): number | null {
  const [, kind, value] = action.split(":");
  const every = Number(value);
  return kind === "every" && Number.isInteger(every) && every > 0 ? every : null;
}

/** O que fica embaixo do rótulo do que não se aplica (o molde do "Filtrar"). */
export const unavailable = (blocker: AutoRefreshBlocker) => `Não se aplica: ${autoRefreshCopy.reasons[blocker]}.`;

/**
 * Os itens do submenu (RN-GRADE-014): os intervalos (1 s, 5 s, 10 s, 30 s, 1 min e 5 min) e o "Personalizado…", com o que está em uso marcado (`checked`: um
 * grupo de escolha única, como os menus do sistema); e "Desligar", que só se aplica com ela ligada. Os mesmos itens servem ao menu da barra do resultado.
 */
export function autoRefreshGroups(state: AutoRefreshState): CellMenuGroup[] {
  const every = state.status === "on" ? state.everyMs : null;
  const custom = every !== null && !autoRefreshChoices.includes(every);

  const choices: CellMenuItem[] = autoRefreshChoices.map((choice) => ({ id: `autoRefresh:every:${choice}`, label: copy.every(intervalLabel(choice)), disabled: false, checked: every === choice }));
  return [
    [...choices, { id: "autoRefresh:custom", label: custom && every !== null ? copy.customChosen(intervalLabel(every)) : copy.custom, disabled: false, checked: custom }],
    [{ id: "autoRefresh:off", label: copy.off, disabled: state.status !== "on" }],
  ];
}

/**
 * O item "Atualizar automaticamente" do menu da célula, logo depois de "Atualizar" (F5), com o submenu. Desligada e sem como ligar (a aba ocupada, o
 * comando que grava, nenhuma linha de leitura, a aba sem sessão), ele vem desabilitado com o motivo, como manda a RN-MENU-001; ligada, vale sempre, para
 * trocar o intervalo ou desligar.
 */
export function autoRefreshMenuItem(state: AutoRefreshState, blocker: AutoRefreshBlocker | null): CellMenuItem {
  const blocked = state.status === "on" ? null : blocker;
  return { id: "autoRefresh", label: copy.label, ...(blocked === null ? { disabled: false } : { disabled: true, hint: unavailable(blocked) }), submenu: { label: copy.label, groups: autoRefreshGroups(state) } };
}

/**
 * O que a grade (o menu da célula, `useRecordEdits`) sabe da atualização automática: o item, montado na hora de abrir o menu, e o que fazer com a escolha.
 * Quem monta é `useAutoRefresh`, na vista.
 */
export type AutoRefreshSource = {
  item: () => CellMenuItem;
  choose: (action: AutoRefreshAction) => void;
};
