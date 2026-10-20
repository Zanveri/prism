import type { QueryClient } from "@tanstack/react-query";

import { allowRefusal, apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { invalidateLists } from "./connections.service";
import { exportResultSchema, importPreviewSchema, importResultSchema, type ExportRequest, type ExportResult, type ImportPreview, type ImportRequest, type ImportResult, type PreviewRequest } from "./transfer.schema";

/**
 * As rotas de exportar e importar conexões (seção 34 da especificação). Quem monta e quem lê o arquivo é a API: a tela manda o que foi marcado e as senhas,
 * e recebe o arquivo já cifrado (a exportação) ou a árvore dele (a prévia). Como as demais, devolvem `ApiResult`, e quem as chama numa `mutationFn` passa o
 * resultado por `allowRefusal` com as recusas que mostra no lugar (`exportRefusals`, `importRefusals`).
 */

/**
 * As recusas da exportação que o diálogo mostra no lugar (RN-TRANSF-004 a 008): a senha de exportação no campo dela, os limites acima dos botões, o item
 * marcado que outra janela excluiu (as listas são lidas de novo) e a senha do Prism que a API pediu sem a tela prever. As outras (o pedido malformado, o
 * cofre fechado) vão ao aviso central.
 */
export const exportRefusals = ["EXPORT_PASSPHRASE_INVALID", "EXPORT_LIMITS_EXCEEDED", "FOLDER_NOT_FOUND", "CONNECTION_NOT_FOUND", "USER_PASSWORD_REQUIRED"] as const;

/**
 * As recusas da leitura do arquivo que o diálogo da importação mostra no campo a que se referem, sem aviso de erro (RN-TRANSF-009 e 010): as do arquivo no
 * "Arquivo", as da senha na "Senha de exportação" e a do lugar que outra janela excluiu no "Onde colocar". As da gravação (`IMPORT_EMPTY`, `IMPORT_INVALID`) a
 * tela não deixa acontecer, e vão ao aviso central.
 */
export const importRefusals = ["IMPORT_FILE_INVALID", "IMPORT_FILE_NEWER", "IMPORT_LIMITS_EXCEEDED", "IMPORT_PASSPHRASE_INVALID", "IMPORT_PASSPHRASE_WRONG", "FOLDER_NOT_FOUND"] as const;

/**
 * `POST api/user/connections/export` (RN-TRANSF-008): o arquivo cifrado com a senha de exportação. `userPassword` só vai quando a RN-TRANSF-005 a pede (uma
 * conexão marcada leva a senha gravada); sem ela, a chave nem vai, e a API não confere a que vem sem ser pedida.
 */
export function exportConnections(request: ExportRequest): Promise<ApiResult<ExportResult>> {
  const { userPassword, ...body } = request;
  return apiRequest(prismEndpoints.userConnectionsExport, { method: "POST", body: { ...body, ...(userPassword === undefined ? {} : { userPassword }) }, schema: exportResultSchema });
}

/** `POST api/user/connections/import/preview` (RN-TRANSF-011): a árvore do arquivo e o que a importação faria no lugar escolhido, sem gravar nada. */
export function previewImport(request: PreviewRequest): Promise<ApiResult<ImportPreview>> {
  return apiRequest(prismEndpoints.userConnectionsImportPreview, { method: "POST", body: request, schema: importPreviewSchema });
}

/** `POST api/user/connections/import` (RN-TRANSF-014): uma gravação só do cofre, tudo ou nada, com o que ficou marcado. */
export function importConnections(request: ImportRequest): Promise<ApiResult<ImportResult>> {
  return apiRequest(prismEndpoints.userConnectionsImport, { method: "POST", body: request, schema: importResultSchema });
}

/**
 * As mutações dos dois diálogos (RN-TRANSF-001). Elas levam a senha de exportação, a senha do Prism ou o arquivo, e trazem o arquivo cifrado ou a prévia:
 * nada disso fica no cache de mutações da tela. `gcTime: 0` tira do cache a mutação sem observador (o diálogo que fechou antes da resposta), e quem a usa chama
 * `reset()` assim que a resposta chega, na recusa também (o observador preso a seguraria lá, com `variables` e `data`). As recusas que o diálogo mostra no
 * lugar voltam como valor; as outras lançam e vão ao aviso central.
 */
export const exportMutation = {
  gcTime: 0,
  mutationFn: async (request: ExportRequest) => allowRefusal(await exportConnections(request), ...exportRefusals),
};

export const previewMutation = {
  gcTime: 0,
  mutationFn: async (request: PreviewRequest) => allowRefusal(await previewImport(request), ...importRefusals),
};

/** A importação grava: as listas são lidas de novo aqui, e não no `mutate`, porque o diálogo pode ter saído antes da resposta (o bloqueio) e o navegador tem de ver o que entrou. */
export function importMutation(queryClient: QueryClient) {
  return {
    gcTime: 0,
    mutationFn: async (request: ImportRequest) => allowRefusal(await importConnections(request), ...importRefusals),
    onSuccess: async (result: ApiResult<ImportResult>) => {
      if (result.ok) await invalidateLists(queryClient);
    },
  };
}
