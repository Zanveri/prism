import { allowRefusal, apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { editPreviewSchema, editsAppliedSchema, editTargetSchema, type ApiChange, type EditPreview, type EditsApplied, type EditTarget } from "./record-edits.schema";

/**
 * As rotas da edição dos Registros (seção 22). Cada função devolve como valor as recusas que a faixa da grade mostra no próprio lugar
 * (`allowRefusal`), e lança as outras (a API fora do ar, uma resposta fora do formato), que quem chama passa pelo cache de mutações e
 * viram o aviso central (RN-AVISO-004).
 */

/** O que a tela mostra de um `edit-target` recusado: o resultado mudou, é só leitura, a sessão caiu ou a consulta ao catálogo falhou. */
const targetRefusals = ["RESULT_NOT_EDITABLE", "RESULT_CHANGED", "DATABASE_SESSION_NOT_FOUND", "SQL_EXECUTION_FAILED", "DATABASE_CONNECTION_FAILED", "SESSION_BUSY"];

/** O que a faixa mostra de um Salvar recusado, com a alteração que falhou quando a API a aponta. */
const saveRefusals = ["EDIT_ROW_MISMATCH", "EDIT_INVALID", "SQL_EXECUTION_FAILED", "RESULT_CHANGED", "RESULT_NOT_EDITABLE", "SESSION_BUSY", "DATABASE_SESSION_NOT_FOUND"];

/**
 * RN-EDIT-002, 003 e 010: o que se edita no resultado da página, perguntado na primeira tentativa de editar. `catalogSessionId` é a
 * sessão da árvore da mesma conexão, que a API usa para o catálogo quando ela existe; sem ela, a API abre uma conexão à parte.
 */
export async function editTargetOrRefuse(sessionId: string, resultId: string, catalogSessionId: string | null): Promise<ApiResult<EditTarget>> {
  const body = catalogSessionId === null ? { resultID: resultId } : { resultID: resultId, catalogSessionID: catalogSessionId };
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditTarget(sessionId), { method: "POST", body, schema: editTargetSchema }), ...targetRefusals);
}

/** RN-EDIT-005 e 012: o Salvar. A resposta diz quantas alterações foram gravadas. */
export async function saveEditsOrRefuse(sessionId: string, resultId: string, changes: ApiChange[]): Promise<ApiResult<EditsApplied>> {
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEdits(sessionId), { method: "POST", body: { resultID: resultId, changes }, schema: editsAppliedSchema }), ...saveRefusals);
}

/** RN-EDIT-008: os comandos que o Salvar executaria, sem executar nada. */
export async function previewEditsOrRefuse(sessionId: string, resultId: string, changes: ApiChange[]): Promise<ApiResult<EditPreview>> {
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditsPreview(sessionId), { method: "POST", body: { resultID: resultId, changes }, schema: editPreviewSchema }), ...saveRefusals);
}
