import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { startedTransferSchema } from "../data-export/transfers.schema";
import {
  copyPreviewSchema,
  importPreviewSchema,
  importReadSchema,
  type CopyPreview,
  type CopyPreviewRequest,
  type CopyStartRequest,
  type ImportPreview,
  type ImportPreviewRequest,
  type ImportRead,
  type ImportReadRequest,
  type ImportStartRequest,
} from "./imports.schema";

/**
 * Uma função por rota da importação de dados e da cópia para outro banco (seção 36). Devolvem `ApiResult` e nunca lançam: o assistente mostra no lugar as
 * recusas que a especificação põe nele (as listas abaixo, por `allowRefusal`), e o resto vai ao aviso central pelo cache de mutações.
 */

/** As recusas da leitura do arquivo que aparecem no lugar da prévia (RN-IMPORT-003 e 007). */
export const readRefusals = ["IMPORT_FILE_MISSING", "IMPORT_OPTIONS_INVALID", "IMPORT_FILE_UNREADABLE", "IMPORT_FILE_TOO_LARGE"] as const;

/** As recusas da prévia convertida que aparecem na etapa Mapeamento (RN-IMPORT-009), com "Tentar de novo" na falha do banco. */
export const previewRefusals = [
  ...readRefusals,
  "CONNECTION_NOT_FOUND",
  "IMPORT_TABLE_NOT_FOUND",
  "IMPORT_TARGET_NOT_TABLE",
  "IMPORT_MAPPING_INVALID",
  "CONNECTION_READ_ONLY",
  "DATABASE_NAME_INVALID",
  "CONNECTION_CREDENTIALS_MISSING",
  "DRIVER_NOT_INSTALLED",
  "DATABASE_CONNECTION_FAILED",
  "SQL_EXECUTION_FAILED",
] as const;

/** As recusas do começo da importação que o assistente mostra (RN-IMPORT-013): no campo, ou no alto da Confirmação; o arquivo que sumiu leva ao Arquivo. */
export const importStartRefusals = [
  "IMPORT_FILE_MISSING",
  "CONNECTION_NOT_FOUND",
  "TRANSFER_LIMIT_REACHED",
  "IMPORT_TARGET_BUSY",
  "IMPORT_OPTIONS_INVALID",
  "IMPORT_FILE_TOO_LARGE",
  "CONNECTION_READ_ONLY",
  "DATABASE_NAME_INVALID",
  "CONNECTION_CREDENTIALS_MISSING",
  "DRIVER_NOT_INSTALLED",
] as const;

/** As recusas da prévia da cópia, na etapa Mapeamento (RN-IMPORT-024). */
export const copyPreviewRefusals = [
  "CONNECTION_NOT_FOUND",
  "IMPORT_TABLE_NOT_FOUND",
  "IMPORT_OPTIONS_INVALID",
  "IMPORT_TARGET_NOT_TABLE",
  "IMPORT_TARGET_IS_SOURCE",
  "IMPORT_MAPPING_INVALID",
  "CONNECTION_READ_ONLY",
  "DATABASE_NAME_INVALID",
  "CONNECTION_CREDENTIALS_MISSING",
  "DRIVER_NOT_INSTALLED",
  "DATABASE_CONNECTION_FAILED",
  "SQL_EXECUTION_FAILED",
] as const;

/** As recusas do começo da cópia (RN-IMPORT-025), como as da exportação e as do destino. */
export const copyStartRefusals = [
  "CONNECTION_NOT_FOUND",
  "TRANSFER_LIMIT_REACHED",
  "IMPORT_TARGET_BUSY",
  "IMPORT_OPTIONS_INVALID",
  "IMPORT_MAPPING_INVALID",
  "EXPORT_SOURCE_NOT_READ",
  "MULTIPLE_STATEMENTS_NOT_SUPPORTED",
  "FILTER_INVALID",
  "IMPORT_TARGET_IS_SOURCE",
  "CONNECTION_READ_ONLY",
  "DATABASE_NAME_INVALID",
  "CONNECTION_CREDENTIALS_MISSING",
  "DRIVER_NOT_INSTALLED",
] as const;

/** 200: o que a leitura achou (a codificação, o separador, a lista do JSON, as planilhas) e as primeiras 20 linhas, como foram lidas. */
export function readImportFile(request: ImportReadRequest, signal?: AbortSignal): Promise<ApiResult<ImportRead>> {
  return apiRequest(prismEndpoints.userTransferImportsRead, { method: "POST", body: request, schema: importReadSchema, signal });
}

/** 200: a tabela de destino (lida numa conexão à parte), o mapeamento (o mandado, ou o automático quando não vai nenhum) e a prévia convertida. */
export function previewImport(request: ImportPreviewRequest, signal?: AbortSignal): Promise<ApiResult<ImportPreview>> {
  return apiRequest(prismEndpoints.userTransferImportsPreview, { method: "POST", body: request, schema: importPreviewSchema, signal });
}

/** 202 `{ id }`: a importação começou; a API tomou o arquivo, e o resto (conectar, conferir, gravar) acontece no trabalho. */
export function startImport(request: ImportStartRequest, signal?: AbortSignal): Promise<ApiResult<{ id: string }>> {
  return apiRequest(prismEndpoints.userTransferImports, { method: "POST", body: request, schema: startedTransferSchema, signal });
}

/** 200: a tabela de destino e o mapeamento sugerido; a origem não é lida (RN-IMPORT-024). */
export function previewCopy(request: CopyPreviewRequest, signal?: AbortSignal): Promise<ApiResult<CopyPreview>> {
  return apiRequest(prismEndpoints.userTransferCopiesPreview, { method: "POST", body: request, schema: copyPreviewSchema, signal });
}

/** 202 `{ id }`: a cópia começou. */
export function startCopy(request: CopyStartRequest, signal?: AbortSignal): Promise<ApiResult<{ id: string }>> {
  return apiRequest(prismEndpoints.userTransferCopies, { method: "POST", body: request, schema: startedTransferSchema, signal });
}
