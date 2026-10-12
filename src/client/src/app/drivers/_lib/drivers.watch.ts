import type { QueryClient } from "@tanstack/react-query";

import { failedInstalls, restartBecamePending } from "./drivers.model";
import { driversSchema, type Driver } from "./drivers.schema";
import { driversKey } from "./drivers.service";

type DriverTransitionHandlers = {
  /** Um `restartRequired` passou a verdadeiro: a instalação terminou ou o driver foi removido (itens E e F). */
  onRestartRequired: () => void;
  /** Um driver que baixava falhou (item D): o aviso de erro, além da causa na linha. */
  onInstallFailed: (driver: Driver) => void;
};

/**
 * Olha as listas de drivers que chegam ao cache e avisa das **mudanças**: o que acabou de acontecer, e
 * não o que já era assim. Não é estado do React porque é um acontecimento (um aviso e um diálogo que
 * abre uma vez), e porque a lista pode chegar por vários caminhos: a consulta periódica, o `invalidate`
 * depois de uma ação, a volta à tela. A primeira lista vista não é transição; a que já estava no cache
 * quando a tela abriu é o ponto de partida, e por isso uma instalação que terminou enquanto a pessoa
 * estava em outra tela ainda abre o diálogo quando ela volta.
 *
 * Devolve a função que para de olhar.
 */
export function watchDriverTransitions(queryClient: QueryClient, handlers: DriverTransitionHandlers): () => void {
  let previous = queryClient.getQueryData<Driver[]>(driversKey);

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.query.queryKey[0] !== driversKey[0]) return;

    // O cache só guarda o que passou pelo schema; conferir de novo é o que dispensa afirmar o tipo.
    const parsed = driversSchema.safeParse(event.query.state.data);
    if (!parsed.success) return;

    const next = parsed.data;

    const before = previous;
    previous = next;

    for (const driver of failedInstalls(before, next)) handlers.onInstallFailed(driver);
    if (restartBecamePending(before, next)) handlers.onRestartRequired();
  });
}
