import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { invalidateLists } from "./connections.service";
import {
  dbeaverImportResultSchema,
  dbeaverPreviewSchema,
  dbeaverScanSchema,
  dbeaverStateSchema,
  type DbeaverImportRequest,
  type DbeaverImportResult,
  type DbeaverPreview,
  type DbeaverPreviewRequest,
  type DbeaverScan,
  type DbeaverState,
} from "./dbeaver.schema";

/**
 * As rotas do DBeaver (seção 40 da especificação). Quem lê a cópia e decifra as senhas é a API: a tela manda o `sourceId` que o processo principal deu à cópia
 * (RN-DBEAVER-006) e o que foi marcado, e recebe a árvore (a prévia). Como as demais, devolvem `ApiResult`, e quem as chama numa `mutationFn` passa o
 * resultado por `allowRefusal` com as recusas que o diálogo mostra no lugar (`dbeaverRefusals`).
 */

/**
 * As recusas da leitura da cópia que o diálogo mostra no lugar, sem aviso de erro (RN-DBEAVER-014 e 016): a cópia que sumiu e a que não tem o que ler, no
 * campo "Origem"; o projeto e os limites, no "Projeto"; e o lugar que outra janela excluiu, no "Onde colocar". As da gravação (`IMPORT_EMPTY`,
 * `IMPORT_INVALID`) a tela não deixa acontecer, e vão ao aviso central.
 */
export const dbeaverRefusals = ["DBEAVER_SOURCE_MISSING", "DBEAVER_SOURCE_INVALID", "DBEAVER_PROJECT_NOT_FOUND", "DBEAVER_LIMITS_EXCEEDED", "FOLDER_NOT_FOUND"] as const;

/** `GET api/user/connections/dbeaver` (RN-DBEAVER-018). */
export function getDbeaverState(signal?: AbortSignal): Promise<ApiResult<DbeaverState>> {
  return apiRequest(prismEndpoints.userConnectionsDbeaver, { schema: dbeaverStateSchema, signal });
}

/** O convite e a data da última importação deste usuário: o cofre os guarda, e a tela os lê ao abrir a área de trabalho e em Configurações. */
export const dbeaverStateQuery = queryOptions({ queryKey: ["dbeaver-state"], queryFn: async ({ signal }) => unwrap(await getDbeaverState(signal)) });

/** `PUT api/user/connections/dbeaver/invite`: grava o convite como feito (204; o que já tem data fica com ela). */
export function inviteDbeaver(): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userConnectionsDbeaverInvite, { method: "PUT" });
}

/**
 * Grava o convite como feito e atualiza o que a tela sabe dele. A falha não aparece para a pessoa (RN-DBEAVER-002): o convite volta na próxima entrada, e é só
 * isso. Não lança.
 */
export async function markInvited(queryClient: QueryClient): Promise<void> {
  try {
    const result = await inviteDbeaver();
    if (result.ok) await queryClient.invalidateQueries({ queryKey: dbeaverStateQuery.queryKey });
  } catch {
    // O convite volta na próxima entrada.
  }
}

/** `POST api/user/connections/dbeaver/scan` (RN-DBEAVER-007): as contagens de cada projeto da cópia, sem conferir os limites. */
export function scanDbeaver(sourceId: string): Promise<ApiResult<DbeaverScan>> {
  return apiRequest(prismEndpoints.userConnectionsDbeaverScan, { method: "POST", body: { sourceId }, schema: dbeaverScanSchema });
}

const previewBody = ({ sourceId, project, targetFolderID, withPasswords, drdaPorts }: DbeaverPreviewRequest) => ({
  sourceId,
  ...(project === null ? {} : { project }),
  targetFolderID,
  withPasswords,
  ...(drdaPorts.length === 0 ? {} : { drdaPorts }),
});

/** `POST api/user/connections/dbeaver/import/preview` (RN-DBEAVER-015): a árvore do DBeaver e o que a importação faria no lugar escolhido, sem gravar nada. */
export function previewDbeaver(request: DbeaverPreviewRequest): Promise<ApiResult<DbeaverPreview>> {
  return apiRequest(prismEndpoints.userConnectionsDbeaverPreview, { method: "POST", body: previewBody(request), schema: dbeaverPreviewSchema });
}

/** `POST api/user/connections/dbeaver/import` (RN-DBEAVER-016): uma gravação só do cofre, tudo ou nada, com o que ficou marcado e o que se sobrescreve. */
export function importDbeaver(request: DbeaverImportRequest): Promise<ApiResult<DbeaverImportResult>> {
  const { items, onConflict, overwrite } = request;
  return apiRequest(prismEndpoints.userConnectionsDbeaverImport, { method: "POST", body: { ...previewBody(request), items, onConflict, overwrite }, schema: dbeaverImportResultSchema });
}

/**
 * As mutações do diálogo (RN-DBEAVER-003). Elas levam o `sourceId` e trazem a prévia com os usuários e os servidores do DBeaver: nada disso fica no cache de
 * mutações da tela. `gcTime: 0` tira do cache a mutação sem observador (o diálogo que fechou antes da resposta), e quem a usa chama `reset()` assim que a
 * resposta chega, na recusa também. As recusas que o diálogo mostra no lugar voltam como valor; as outras lançam e vão ao aviso central.
 */
export const dbeaverPreviewMutation = {
  gcTime: 0,
  mutationFn: async (request: DbeaverPreviewRequest) => allowRefusal(await previewDbeaver(request), ...dbeaverRefusals),
};

/** A importação grava: as listas e a data da última importação são lidas de novo aqui, e não no `mutate`, porque o diálogo pode ter saído antes da resposta. */
export function dbeaverImportMutation(queryClient: QueryClient) {
  return {
    gcTime: 0,
    mutationFn: async (request: DbeaverImportRequest) => allowRefusal(await importDbeaver(request), ...dbeaverRefusals),
    onSuccess: async (result: ApiResult<DbeaverImportResult>) => {
      if (!result.ok) return;
      await Promise.all([invalidateLists(queryClient), queryClient.invalidateQueries({ queryKey: dbeaverStateQuery.queryKey })]);
    },
  };
}
