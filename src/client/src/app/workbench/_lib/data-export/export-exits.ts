import type { Transfer } from "./transfers.schema";

/**
 * As saídas que perguntam pelas transferências em andamento (RN-EXPORT-023 e RN-IMPORT-021): o "Sair", o reinício do serviço (RN-DRIVER-005) e a instalação
 * de uma atualização que encerra o Prism (RN-ATUALIZA-006), e a conta do diálogo de excluir a conexão (RN-CONN-014). A conta é da lista da API, de todas as
 * janelas: as exportações que rodam e as prontas que ainda não foram entregues, e as importações e as cópias para outro banco que rodam. Com as peças
 * injetadas, para o teste.
 */
export type TransferExitDeps = {
  /** O cofre está aberto nesta janela (a área de trabalho montada) e não bloqueado: fora disso não há transferência, e nada se pede à API. */
  open: () => boolean;
  /** As transferências em andamento, de todas as janelas, ou só as de uma conexão (`transfersInProgress`). Sem resposta da API, nenhuma. */
  list: (connectionId?: string) => Promise<Transfer[]>;
  /** O `DELETE` de cada uma, juntas (`cancelTransfers`). Nunca lança. */
  forget: (transfers: readonly Pick<Transfer, "id">[]) => Promise<void>;
  /** Os acompanhamentos desta janela (o das exportações, que solta os destinos, e o das importações e cópias): cada um cancela as suas. */
  trackers: readonly { has: (id: string) => boolean; cancelAll: () => Promise<void> }[];
};

export function createTransferExits(deps: TransferExitDeps) {
  /** As transferências em andamento agora (de uma conexão, quando dada). Com o cofre fechado, nenhuma, sem pedir. */
  async function ahead(connectionId?: string): Promise<Transfer[]> {
    return deps.open() ? deps.list(connectionId) : [];
  }

  /**
   * A saída confirmada (a última resposta): a lista é lida de novo, para levar também a que começou enquanto a pergunta estava aberta; as de outras janelas
   * são canceladas pelo `DELETE` (a janela delas vê o cofre fechar), e as desta janela pelos acompanhamentos (o das exportações solta os destinos). Só então
   * a saída segue.
   */
  async function cancelForExit(): Promise<void> {
    const listed = await ahead();
    const mine = (id: string) => deps.trackers.some((tracker) => tracker.has(id));
    await Promise.all([deps.forget(listed.filter((transfer) => !mine(transfer.id))), ...deps.trackers.map((tracker) => tracker.cancelAll())]);
  }

  return { ahead, cancelForExit };
}

/**
 * O primeiro passo de fechar a janela (RN-ABAS-004, RN-EXPORT-023 e RN-IMPORT-021): com o cofre bloqueado, fecha (a API já cancelou tudo e fechou as
 * sessões); com transferências começadas nesta janela, a pergunta delas vem antes das outras; senão, as abas fecham com as perguntas de "Fechar todas" (sem
 * aba, fecha).
 */
export function windowCloseStep({ locked, transfers, tabs }: { locked: boolean; transfers: number; tabs: number }): "finish" | "askTransfers" | "closeTabs" {
  if (locked) return "finish";
  if (transfers > 0) return "askTransfers";
  return tabs === 0 ? "finish" : "closeTabs";
}
