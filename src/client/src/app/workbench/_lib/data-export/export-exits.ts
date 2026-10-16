import type { Transfer } from "./transfers.schema";

/**
 * As saídas que perguntam pelas exportações em andamento (RN-EXPORT-023): o "Sair", o reinício do serviço (RN-DRIVER-005) e a instalação de uma atualização
 * que encerra o Prism (RN-ATUALIZA-006), e a conta do diálogo de excluir a conexão (RN-CONN-014). A conta é da lista da API, de todas as janelas: as que rodam
 * e as prontas que ainda não foram entregues. Com as peças injetadas, para o teste.
 */
export type ExportExitDeps = {
  /** O cofre está aberto nesta janela (a área de trabalho montada) e não bloqueado: fora disso não há exportação, e nada se pede à API. */
  open: () => boolean;
  /** As exportações em andamento, de todas as janelas, ou só as de uma conexão (`exportsInProgress`). Sem resposta da API, nenhuma. */
  list: (connectionId?: string) => Promise<Transfer[]>;
  /** O `DELETE` de cada uma, juntas (`cancelExports`). Nunca lança. */
  forget: (transfers: readonly Pick<Transfer, "id">[]) => Promise<void>;
  /** As desta janela: o acompanhamento as cancela e solta os destinos delas. */
  tracker: { has: (id: string) => boolean; cancelAll: () => Promise<void> };
};

export function createExportExits(deps: ExportExitDeps) {
  /** As exportações em andamento agora (de uma conexão, quando dada). Com o cofre fechado, nenhuma, sem pedir. */
  async function ahead(connectionId?: string): Promise<Transfer[]> {
    return deps.open() ? deps.list(connectionId) : [];
  }

  /**
   * A saída confirmada (a última resposta): a lista é lida de novo, para levar também a que começou enquanto a pergunta estava aberta; as de outras janelas
   * são canceladas pelo `DELETE` (a janela delas vê o cofre fechar e solta os destinos), e as desta janela pelo acompanhamento, que solta os destinos. Só
   * então a saída segue.
   */
  async function cancelForExit(): Promise<void> {
    const listed = await ahead();
    await Promise.all([deps.forget(listed.filter((transfer) => !deps.tracker.has(transfer.id))), deps.tracker.cancelAll()]);
  }

  return { ahead, cancelForExit };
}

/**
 * O primeiro passo de fechar a janela (RN-ABAS-004 e RN-EXPORT-023): com o cofre bloqueado, fecha (a API já cancelou tudo e fechou as sessões); com
 * exportações começadas nesta janela, a pergunta delas vem antes das outras; senão, as abas fecham com as perguntas de "Fechar todas" (sem aba, fecha).
 */
export function windowCloseStep({ locked, exports, tabs }: { locked: boolean; exports: number; tabs: number }): "finish" | "askExports" | "closeTabs" {
  if (locked) return "finish";
  if (exports > 0) return "askExports";
  return tabs === 0 ? "finish" : "closeTabs";
}
