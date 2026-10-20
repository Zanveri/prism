import type { Engine } from "@/components/ui/engine-tag";

import { statementCount } from "./sql-statements";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.result;

/**
 * Como a aba de consulta reparte a altura entre o editor e a área de resultado (RN-PAINEL-001):
 * `split` os dois à vista; `collapsed` só a barra do resultado; `maximized` o editor recolhido e o
 * resultado com tudo. `resultPercent` é a parte do resultado quando a divisão está à mostra, e
 * fica guardada enquanto a área está recolhida ou maximizada: restaurar volta a ela.
 */
export type PaneMode = "split" | "collapsed" | "maximized";

export type PaneLayout = { mode: PaneMode; resultPercent: number };

/** O 2:3 que a aba sempre teve: o editor com 40% e o resultado com 60%. */
export const defaultResultPercent = 60;
/** Nenhum dos dois lados some ao arrastar: recolher é o botão. */
export const minResultPercent = 15;
export const maxResultPercent = 85;
/** O passo das setas na divisória. */
const nudgePercent = 5;

export const initialLayout: PaneLayout = { mode: "split", resultPercent: defaultResultPercent };

export type PaneAction =
  | { type: "collapse" }
  | { type: "maximize" }
  | { type: "restore" }
  /** Um comando foi enviado: com a área recolhida, ela volta, para o resultado aparecer. */
  | { type: "run" }
  | { type: "resize"; percent: number }
  /** `1` aumenta o resultado (a divisória sobe), `-1` diminui. */
  | { type: "nudge"; direction: 1 | -1 }
  | { type: "extreme"; end: "min" | "max" };

/**
 * Se o executor vai enviar o comando (RN-SQL-001 e RN-SESSAO-002): um comando só, e a aba livre. Sem nada para enviar, com
 * mais de um comando ou com a aba ocupada ele recusa com um aviso, e a área recolhida NÃO volta: não há resultado a caminho.
 * É o critério do executor (`use-query-runner.ts`), repetido aqui porque o executor não diz de antemão se vai aceitar.
 */
export function commandWillRun(target: { sql: string; engine?: Engine }, busy: boolean): boolean {
  return !busy && statementCount(target.sql, target.engine) === 1;
}

/** RN-SQL-019: se o executor vai rodar o script: algum comando, e a aba livre. Como `commandWillRun`, decide se a área recolhida volta e se a pergunta das alterações não salvas vem antes. */
export function scriptWillRun(targets: readonly unknown[], busy: boolean): boolean {
  return !busy && targets.length > 0;
}

/**
 * As teclas da divisória (RN-PAINEL-001), como num separador de janela: para cima o resultado cresce, para baixo encolhe;
 * Home vai ao menor e End ao maior. `null` para qualquer outra tecla, que segue o caminho dela (o Tab, por exemplo).
 */
export function splitterKeyAction(key: string): PaneAction | null {
  switch (key) {
    case "ArrowUp":
      return { type: "nudge", direction: 1 };
    case "ArrowDown":
      return { type: "nudge", direction: -1 };
    case "Home":
      return { type: "extreme", end: "min" };
    case "End":
      return { type: "extreme", end: "max" };
    default:
      return null;
  }
}

const clamp = (percent: number) => Math.min(maxResultPercent, Math.max(minResultPercent, percent));

/** Devolve o mesmo objeto quando nada muda, para o React não redesenhar a aba à toa. */
function withMode(layout: PaneLayout, mode: PaneMode): PaneLayout {
  return layout.mode === mode ? layout : { ...layout, mode };
}

function withPercent(layout: PaneLayout, percent: number): PaneLayout {
  // A divisória só existe com a divisão à mostra.
  return layout.mode !== "split" || layout.resultPercent === percent ? layout : { ...layout, resultPercent: percent };
}

export function layoutReducer(layout: PaneLayout, action: PaneAction): PaneLayout {
  switch (action.type) {
    case "collapse":
      return withMode(layout, "collapsed");
    case "maximize":
      return withMode(layout, "maximized");
    case "restore":
      return withMode(layout, "split");
    case "run":
      return layout.mode === "collapsed" ? withMode(layout, "split") : layout;
    case "resize":
      return withPercent(layout, clamp(action.percent));
    case "nudge":
      return withPercent(layout, clamp(Math.round(layout.resultPercent) + action.direction * nudgePercent));
    case "extreme":
      return withPercent(layout, action.end === "min" ? minResultPercent : maxResultPercent);
  }
}

/** A parte da altura que fica abaixo do ponteiro, de 0 a 100, entre os limites. `area` é onde o editor e o resultado estão. */
export function percentFromPointer(clientY: number, area: { top: number; height: number }): number {
  if (area.height <= 0) return defaultResultPercent;
  return clamp(((area.top + area.height - clientY) / area.height) * 100);
}

/**
 * O `flex` do editor e do resultado em cada estado. Dividida, os dois crescem na proporção, sem
 * tamanho de base: o resultado muda de altura junto com a janela. Recolhida, o resultado é só o
 * que a barra pede; maximizada, o editor fica sem altura (continua montado: o histórico de
 * desfazer e o cursor dele não se perdem).
 */
export function paneFlex(layout: PaneLayout): { editor: string; result: string } {
  switch (layout.mode) {
    case "split":
      return { editor: `${100 - layout.resultPercent} 1 0px`, result: `${layout.resultPercent} 1 0px` };
    case "collapsed":
      return { editor: "1 1 0px", result: "none" };
    case "maximized":
      return { editor: "none", result: "1 1 0px" };
  }
}

type Control = { action: "collapse" | "maximize" | "restore"; label: string };

/**
 * Os dois botões da barra do resultado, em cada estado. Cada um é sempre o mesmo botão, só troca o
 * que faz: o foco fica nele depois do clique. O primeiro recolhe ou restaura a área; o segundo a
 * maximiza ou a restaura.
 */
export function controlsOf(mode: PaneMode): { collapse: Control; maximize: Control } {
  return {
    collapse: mode === "collapsed" ? { action: "restore", label: copy.restore } : { action: "collapse", label: copy.collapse },
    maximize: mode === "maximized" ? { action: "restore", label: copy.restore } : { action: "maximize", label: copy.maximize },
  };
}
