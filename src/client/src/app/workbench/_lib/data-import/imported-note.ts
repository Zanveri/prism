import type { RunnerState } from "../use-query-runner";

/**
 * RN-IMPORT-020: o que uma aba de Registros sabe das leituras dela diante das importações na tabela. As importações sobem um número por tabela
 * (`markImported`, em `data-imports.ts`); a aba guarda o número de quando começou a leitura que está na tela (`read`), e a nota "Linhas foram importadas
 * nesta tabela depois da leitura." aparece enquanto o número da tabela for maior que ele. Conta o número do COMEÇO da leitura: a importação que terminou
 * com a leitura em andamento pode ter chegado depois dela, e a nota aparece.
 *
 * `started`: a leitura em andamento, com o número do começo e o resultado que estava na tela (`previous`), que volta a ser o estado se a API não aceitar
 * o comando: aí nada foi lido. `read`: nulo antes da primeira leitura que a aba viu.
 */
export type ReadWatch = { started: { mark: number; previous: unknown } | null; read: number | null };

/** A aba que nunca viu uma leitura começar: com linhas na tela (a vista que volta a montar), elas contam como lidas agora. */
export function initialReadWatch(state: RunnerState, mark: number): ReadWatch {
  return watchRead({ started: null, read: null }, state, mark);
}

/**
 * O estado do executor mudou. Executando (o comando da pessoa ou a atualização automática, RN-GRADE-014): guarda o número do começo, uma vez por leitura.
 * Com linhas e uma leitura começada: se não são as de antes, a leitura terminou, e o número dela passa a valer. O resto (o erro, o cancelamento, as linhas
 * afetadas) encerra a leitura sem linhas. "Carregar mais", contar e editar trocam as linhas sem começar leitura e não mudam nada. Devolve o mesmo objeto
 * quando nada muda.
 */
export function watchRead(watch: ReadWatch, state: RunnerState, mark: number): ReadWatch {
  if (state.status === "running") return watch.started === null ? { ...watch, started: { mark, previous: state.previous } } : watch;
  if (state.status === "rows") {
    if (watch.started !== null) return state === watch.started.previous ? { started: null, read: watch.read ?? mark } : { started: null, read: watch.started.mark };
    return watch.read === null ? { started: null, read: mark } : watch;
  }
  return watch.started === null ? watch : { ...watch, started: null };
}

/** A nota vale: a tabela recebeu linhas depois do começo da leitura que está na tela. */
export function importedAfterRead(watch: ReadWatch, mark: number): boolean {
  return watch.read !== null && mark > watch.read;
}
