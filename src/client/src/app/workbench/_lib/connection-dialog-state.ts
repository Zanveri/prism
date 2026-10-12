/** O diálogo de conexão aberto (RN-NAV-004): uma nova (na pasta dada, ou na raiz) ou a edição de uma gravada, e a época do bloqueio em que abriu. */
export type ConnectionDialogOpen = { request: { mode: "new"; folderID: string | null } | { mode: "edit"; connectionId: string }; epoch: number };

/**
 * O diálogo de conexão continua aberto? Some — e o que estava nele é descartado — quando o bloqueio por inatividade acontece (RN-SEG-001: a
 * época do bloqueio mudou desde que ele abriu), quando a área de trabalho sai da tela (o "Instalar driver" que leva a Configurações ›
 * Drivers; voltar não o reabre) e quando a conexão em edição some da lista. Com a lista ainda por chegar (`null`), a edição espera.
 */
export function keepsDialog(open: ConnectionDialogOpen, { onScreen, lockEpoch, connectionIds }: { onScreen: boolean; lockEpoch: number; connectionIds: ReadonlySet<string> | null }): boolean {
  if (!onScreen || open.epoch !== lockEpoch) return false;
  return open.request.mode === "new" || connectionIds === null || connectionIds.has(open.request.connectionId);
}
