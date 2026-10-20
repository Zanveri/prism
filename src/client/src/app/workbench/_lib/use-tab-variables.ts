import { useMemo, useSyncExternalStore } from "react";

import type { Engine } from "@/components/ui/engine-tag";

import type { QueryRunner } from "./use-query-runner";
import { readScript, type ScriptModel } from "./variables/script";
import type { RevealRequest, TabValuesSnapshot } from "./variables/tab-values";

/**
 * O que a aba de consulta mostra das variáveis (RN-VAR-023 e 024): os valores do executor (o painel e o editor os leem), a leitura do texto de agora (as variáveis
 * declaradas, na ordem) e o pedido de trazer o painel à frente. O painel "Variáveis" aparece quando o texto declara variáveis e a aba já avaliou alguma
 * (`shown`); a variável cuja declaração saiu do texto sai dele na leitura seguinte.
 */
export type TabVariables = { values: TabValuesSnapshot; model: ScriptModel; shown: boolean; reveal: RevealRequest };

export function useTabVariables(runner: QueryRunner, text: string, engine: Engine | undefined, blankLines: boolean): TabVariables {
  const values = useSyncExternalStore(runner.values.subscribe, runner.values.snapshot);
  const reveal = useSyncExternalStore(runner.reveal.subscribe, runner.reveal.getState);
  const model = useMemo(() => readScript(text, engine, { blankLines }), [text, engine, blankLines]);
  const shown = useMemo(() => [...values.values.keys()].some((name) => model.declaredNames.has(name)), [values, model]);
  return { values, model, shown, reveal };
}

/** Onde, no texto do editor, está a declaração da variável (o começo do nome dela), ou nulo se o texto não a declara mais: "Ir para a declaração" (RN-VAR-024). */
export function declarationOffset(model: ScriptModel, name: string): number | null {
  const declaration = model.declarations.get(name);
  return declaration === undefined ? null : (model.items[declaration.itemIndex]?.parsed?.nameStart ?? model.items[declaration.itemIndex]?.start ?? null);
}
