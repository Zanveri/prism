import { apiRequest, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import type { ExportRequest } from "./export-request";
import { inProgress, startedTransferSchema, transferListSchema, transferSchema, type Transfer } from "./transfers.schema";

/**
 * Uma função por rota de `api/user/transfers` (RN-EXPORT-016, seção 6). Devolvem `ApiResult` e nunca lançam: quem chama decide o que fazer com cada
 * recusa. O assistente mostra as do pedido no lugar (`startRefusals`), e a barra de status trata as da consulta e do cancelamento sem o aviso central
 * (o que ela não sabe é dito na própria entrada).
 */

/** As recusas do começo que o assistente mostra no lugar (RN-EXPORT-015): no campo, ou no alto da Confirmação. As outras vão ao aviso central. */
export const startRefusals = [
  "EXPORT_OPTIONS_INVALID",
  "EXPORT_SOURCE_NOT_READ",
  "MULTIPLE_STATEMENTS_NOT_SUPPORTED",
  "FILTER_INVALID",
  "DATABASE_NAME_INVALID",
  "TRANSFER_LIMIT_REACHED",
  "CONNECTION_NOT_FOUND",
  "DRIVER_NOT_INSTALLED",
  "CONNECTION_CREDENTIALS_MISSING",
] as const;

/** 202 `{ id }`: o trabalho começou, e o resto (conectar, contar, ler) acontece nele. */
export function startExport(request: ExportRequest, signal?: AbortSignal): Promise<ApiResult<{ id: string }>> {
  return apiRequest(prismEndpoints.userTransferExports, { method: "POST", body: request, schema: startedTransferSchema, signal });
}

/** Como o trabalho está. Consultá-lo é o que o mantém vivo: o que ninguém consulta por 5 minutos a API dá como abandonado. */
export function getTransfer(id: string, signal?: AbortSignal): Promise<ApiResult<Transfer>> {
  return apiRequest(prismEndpoints.userTransfer(id), { schema: transferSchema, signal });
}

/** Os trabalhos do cofre aberto, de todas as janelas. */
export function listTransfers(signal?: AbortSignal): Promise<ApiResult<Transfer[]>> {
  return apiRequest(prismEndpoints.userTransfers, { schema: transferListSchema, signal });
}

/**
 * O prazo do `DELETE`: a API responde em até 10 segundos mesmo com a conexão à parte presa (RN-EXPORT-016); passado isso com folga, a tela deixa de esperar
 * (a API está fora do ar, e o trabalho, se existir, será abandonado).
 */
export const forgetDeadlineMs = 15_000;

/** 204: cancela o trabalho que roda (em até 10 segundos) e esquece o que terminou, apagando o arquivo. 404 `TRANSFER_NOT_FOUND`: já não existe. */
export function forgetTransfer(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userTransfer(id), { method: "DELETE", signal: AbortSignal.timeout(forgetDeadlineMs) });
}

/** O trabalho já não existe na API: para quem o esquecia, é o mesmo que esquecer. */
export const isGone = (result: ApiResult<unknown>): boolean => !result.ok && result.error.code === "TRANSFER_NOT_FOUND";

/**
 * As exportações em andamento no cofre aberto, de todas as janelas (RN-EXPORT-023): as que rodam e as prontas que ainda não foram entregues. É a conta das
 * saídas que perguntam ("Sair", o reinício do serviço, a instalação de uma atualização) e do diálogo de excluir a conexão (RN-CONN-014, pela conexão).
 * Sem resposta da API (com o prazo das ações da pessoa: quem espera é o "Sair"), nenhuma: a saída segue como antes.
 */
export async function exportsInProgress(connectionId?: string): Promise<Transfer[]> {
  const result = await listTransfers(AbortSignal.timeout(userActionDeadlineMs));
  if (!result.ok) return [];
  return result.data.filter((transfer) => (transfer.kind ?? "export") === "export" && inProgress(transfer) && (connectionId === undefined || transfer.connectionID === connectionId));
}

/** Cancela as exportações dadas (o `DELETE` de cada uma, juntas) e espera as respostas. Nunca lança. */
export async function cancelExports(transfers: readonly Pick<Transfer, "id">[]): Promise<void> {
  await Promise.all(transfers.map((transfer) => forgetTransfer(transfer.id).catch(() => undefined)));
}
