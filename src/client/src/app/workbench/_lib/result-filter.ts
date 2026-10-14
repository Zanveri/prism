import { conditionOf } from "./table-sql";
import { isBusyState, type FilterRefusal, type RunnerState, type RunTarget } from "./use-query-runner";

/**
 * O filtro do resultado da aba de consulta (RN-GRADE-011), em funções sem React, com as peças injetadas (no molde de `table-view.ts`): o que a aba DECIDE e o
 * que ela FAZ com cada decisão, com teste. O componente só entrega o estado do executor e os `setState`.
 */

/** O comando sem o filtro: o que o editor mandou. */
function withoutFilter({ sql, offset, engine }: RunTarget): RunTarget {
  return engine === undefined ? { sql, offset } : { sql, offset, engine };
}

/**
 * O comando que o campo de filtro filtra: o do resultado que está na tela (inclusive esmaecido, enquanto outro roda), sem o filtro; sem linhas na tela (o
 * comando filtrado deu erro, ou foi cancelado), o do último filtro aplicado (`pinned`), para a pessoa corrigir o filtro. Nulo quando não há o que filtrar:
 * o campo não aparece.
 */
export function filterBaseOf(state: RunnerState, pinned: RunTarget | null): RunTarget | null {
  const shown = state.status === "running" ? state.previous : state;
  return shown?.status === "rows" ? withoutFilter(shown.target) : pinned;
}

/** As peças de `applyResultFilter`: o texto do campo, o filtro em vigor, a recusa no campo, o comando fixado e o executor. */
export type ResultFilterDeps = {
  setDraft: (text: string) => void;
  setApplied: (filter: string) => void;
  setProblem: (problem: { message: string } | null) => void;
  setPinned: (target: RunTarget) => void;
  run: (target: RunTarget) => Promise<FilterRefusal | void>;
};

/**
 * "Aplicar filtro", o "Filtrar" do menu da célula, "Limpar" e "Remover todos os filtros e ordenações" no resultado da aba de consulta: executa de novo o
 * comando do resultado com o texto do campo (a condição, a ordem ou as duas; só sem o espaço das pontas e sem o `;` do fim, como nos Registros), e a API o
 * junta ao comando. O texto do editor não muda. Vazio, o comando vai sem filtro. `draft` é o que o campo passa a mostrar (o do menu é o texto já junto; o de
 * "Limpar", vazio).
 *
 * Com a aba ocupada nada muda (o executor recusaria). Enviado, o filtro passa a ser o em vigor e o comando fica fixado (um erro do banco no comando filtrado
 * deixa o campo à vista para a correção). A recusa da API (`FILTER_INVALID`) volta ao campo com a frase dela, e o filtro em vigor volta a ser o de antes.
 */
export async function applyResultFilter(base: RunTarget | null, draft: string, applied: string, state: RunnerState, deps: ResultFilterDeps): Promise<void> {
  if (base === null || isBusyState(state)) return;

  const filter = conditionOf(draft);
  deps.setDraft(draft);
  deps.setProblem(null);
  deps.setPinned(base);
  deps.setApplied(filter);

  const refusal = await deps.run(filter === "" ? base : { ...base, filter });
  if (refusal === undefined) return;
  deps.setProblem({ message: refusal.message });
  deps.setApplied(applied);
}

/**
 * Executar pelo editor (o botão e o Ctrl+Enter) limpa o filtro do resultado (RN-GRADE-011): o campo, o filtro em vigor, a recusa e o comando fixado. Só quando
 * o comando vai de fato ser enviado; quem decide é a aba (`commandWillRun`).
 */
export function clearResultFilter(deps: Pick<ResultFilterDeps, "setDraft" | "setApplied" | "setProblem"> & { setPinned: (target: null) => void }): void {
  deps.setDraft("");
  deps.setApplied("");
  deps.setProblem(null);
  deps.setPinned(null);
}
