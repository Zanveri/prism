import type { DbeaverStart } from "@/app/connections/_lib/dbeaver-model";
import type { ExportOrigin } from "@/app/connections/_lib/export-model";
import { createRequestSlot } from "@/lib/utils/request-slot";

import type { ImportedItems } from "./navigator-reveal";

/**
 * Os diálogos de passar conexões de e para o cofre que a área de trabalho abre (RN-TRANSF-001, RN-DBEAVER-003): o "Exportar conexões", o "Importar conexões" e o
 * "Importar do DBeaver". Um por janela, e quem os mostra é a página da área de trabalho (RN-DBEAVER-014), não o navegador: o "Comece por aqui", o convite e
 * Configurações também os abrem.
 */
export type TransferRequest =
  | { type: "export"; origin: ExportOrigin }
  | { type: "import"; targetFolderID: string | null }
  | { type: "dbeaver"; targetFolderID: string | null; start: DbeaverStart; /** Aberto como convite (RN-DBEAVER-002): "Agora não" no lugar de "Cancelar". */ invite?: boolean };

/** O diálogo aberto, com a época do bloqueio em que abriu: o bloqueio, o "Sair" e o quinto erro de senha o fecham, e o que estava nele não sobrevive. */
export type TransferDialogOpen = TransferRequest & { epoch: number };

/**
 * O diálogo continua aberto? Some — e o que estava nele é descartado — quando o bloqueio por inatividade acontece (a época mudou desde que abriu) e quando a
 * área de trabalho sai da tela (Configurações; voltar não o reabre), como o diálogo de conexão (`keepsDialog`).
 */
export function keepsTransfer(open: TransferDialogOpen, { onScreen, lockEpoch }: { onScreen: boolean; lockEpoch: number }): boolean {
  return onScreen && open.epoch === lockEpoch;
}

/**
 * O pedido de abrir um destes diálogos que vem de fora da área de trabalho: Configurações › Importar (RN-CONFIG-011) leva à área de trabalho e abre o
 * diálogo ali. A página o atende quando está na tela. Um pedido só, o último.
 */
export const transferRequests = createRequestSlot<TransferRequest>();

/**
 * O que a importação acabou de criar (RN-TRANSF-014, RN-DBEAVER-014): o diálogo pede, o navegador mostra, quando as listas já trazem o que entrou. O diálogo
 * fecha antes de as listas chegarem, e o pedido espera por eles.
 */
export const importedReveal = createRequestSlot<ImportedItems>();
