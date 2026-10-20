import { queryOptions } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { scriptFolderSchema, scriptFoldersSchema, type ScriptFolder } from "./scripts.schema";

/**
 * As rotas das pastas de scripts (seção 33: RN-SCRIPT-007 a 009). As recusas do nome, que o diálogo mostra no campo (RN-SCRIPT-009), voltam como valor
 * (`allowRefusal`); as de regra (a pasta pai ou a de destino que outra janela excluiu, o ciclo, o nome repetido no destino, a pasta que não está vazia)
 * lançam e vão ao aviso central, com o detalhe da API (RN-AVISO-004). Criar, renomear, mover e excluir deixam um botão em "…ando…", e por isso têm o prazo
 * das ações da pessoa (`userActionDeadlineMs`).
 */

/** O nome inválido e o repetido entre as irmãs: o campo do nome os mostra. */
const nameRefusals = ["SCRIPT_FOLDER_NAME_INVALID", "SCRIPT_FOLDER_ALREADY_EXISTS"];

const deadline = () => AbortSignal.timeout(userActionDeadlineMs);

export function listScriptFolders(signal?: AbortSignal): Promise<ApiResult<ScriptFolder[]>> {
  return apiRequest(prismEndpoints.userScriptFolders, { schema: scriptFoldersSchema, signal });
}

/** As pastas da seção Scripts do navegador (RN-SCRIPT-008), de todos os níveis. Só existe dentro do cofre aberto, como os scripts. */
export const scriptFoldersQuery = queryOptions({ queryKey: ["script-folders"], queryFn: async ({ signal }) => unwrap(await listScriptFolders(signal)) });

/** RN-SCRIPT-009: "Nova pasta" (na raiz, `parentID` nulo) e "Nova subpasta". */
export async function createScriptFolderOrRefuse(input: { name: string; parentID: string | null }, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptFolder>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScriptFolders, { method: "POST", body: input, schema: scriptFolderSchema, signal }), ...nameRefusals);
}

/** RN-SCRIPT-009: o "Renomear" (F2) da pasta. O `PATCH` grava a pasta por inteiro: vai a pasta pai que ela tem, e só o nome muda. */
export async function renameScriptFolderOrRefuse(folder: Pick<ScriptFolder, "id" | "parentID">, name: string, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptFolder>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScriptFolders, { method: "PATCH", body: { id: folder.id, name, parentID: folder.parentID }, schema: scriptFolderSchema, signal }), ...nameRefusals);
}

/** RN-SCRIPT-009: o "Mover para…" da pasta. Vai o nome que ela tem, e a pasta pai nova (nula é a raiz). Toda recusa vai ao aviso central. */
export function moveScriptFolder(folder: Pick<ScriptFolder, "id" | "name">, parentID: string | null, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptFolder>> {
  return apiRequest(prismEndpoints.userScriptFolders, { method: "PATCH", body: { id: folder.id, name: folder.name, parentID }, schema: scriptFolderSchema, signal });
}

/** RN-SCRIPT-009: excluir a pasta vazia. A que não está vazia (409 `SCRIPT_FOLDER_NOT_EMPTY`, com as contagens) vai ao aviso central, com o detalhe da API. */
export function deleteScriptFolder(id: string, signal: AbortSignal = deadline()): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userScriptFolder(id), { method: "DELETE", signal });
}
