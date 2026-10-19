import { allowRefusal, apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import {
  editPreviewSchema,
  editsAppliedSchema,
  editTargetSchema,
  sqlTargetSchema,
  wholeColumnCountSchema,
  type ApiChange,
  type EditPreview,
  type EditsApplied,
  type EditTarget,
  type SqlTarget,
  type WholeColumnCount,
} from "./record-edits.schema";

/**
 * As rotas da edição dos Registros (seção 22). Cada função devolve como valor as recusas que a faixa da grade mostra no próprio lugar
 * (`allowRefusal`), e lança as outras (a API fora do ar, uma resposta fora do formato), que quem chama passa pelo cache de mutações e
 * viram o aviso central (RN-AVISO-004).
 */

/**
 * O que a tela mostra de um `edit-target` recusado: o resultado mudou, é só leitura (também por a conexão ser somente leitura agora, RN-PROT-002), a sessão
 * caiu ou a consulta ao catálogo falhou.
 */
const targetRefusals = ["RESULT_NOT_EDITABLE", "CONNECTION_READ_ONLY", "RESULT_CHANGED", "DATABASE_SESSION_NOT_FOUND", "SQL_EXECUTION_FAILED", "DATABASE_CONNECTION_FAILED", "SESSION_BUSY"];

/**
 * O que a faixa mostra de um Salvar recusado, com a alteração que falhou quando a API a aponta; a conexão que passou a ser somente leitura (RN-PROT-002); e a
 * coluna inteira que não se altera naquele resultado (RN-EDIT-023).
 */
const saveRefusals = ["EDIT_ROW_MISMATCH", "EDIT_INVALID", "EDIT_ALL_ROWS_NOT_SUPPORTED", "SQL_EXECUTION_FAILED", "RESULT_CHANGED", "RESULT_NOT_EDITABLE", "CONNECTION_READ_ONLY", "SESSION_BUSY", "DATABASE_SESSION_NOT_FOUND"];

/** O que a faixa mostra de uma contagem da coluna inteira recusada (RN-EDIT-019 e 023): as do Salvar, e a transação da aba que falhou. */
const countRefusals = [...saveRefusals, "TRANSACTION_FAILED"];

/**
 * RN-EDIT-002, 003 e 010: o que se edita no resultado da página, perguntado na primeira tentativa de editar. `catalogSessionId` é a
 * sessão da árvore da mesma conexão, que a API usa para o catálogo quando ela existe; sem ela, a API abre uma conexão à parte.
 */
export async function editTargetOrRefuse(sessionId: string, resultId: string, catalogSessionId: string | null): Promise<ApiResult<EditTarget>> {
  const body = catalogSessionId === null ? { resultID: resultId } : { resultID: resultId, catalogSessionID: catalogSessionId };
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditTarget(sessionId), { method: "POST", body, schema: editTargetSchema }), ...targetRefusals);
}

/**
 * O que a tela mostra de um `edit-target` do "Gerar SQL" recusado (RN-GRADE-018 e 020): o resultado só leitura por outro motivo (a junção, a união, o
 * `DISTINCT`: só o INSERT vale, e o motivo diz por quê), o resultado que mudou, e as falhas que o diálogo mostra com "Tentar de novo". A conexão somente
 * leitura não recusa este pedido.
 */
const sqlTargetRefusals = ["RESULT_NOT_EDITABLE", "RESULT_CHANGED", "DATABASE_SESSION_NOT_FOUND", "SQL_EXECUTION_FAILED", "DATABASE_CONNECTION_FAILED", "SESSION_BUSY"];

/**
 * RN-GRADE-020: o alvo do resultado para o "Gerar SQL" e o "Copiar como" do SQL e do DbUnit (`purpose: "sql"`), que vale também na conexão somente leitura,
 * com tudo só leitura. Na conexão somente leitura, ele não serve à edição (RN-EDIT-010): quem o guarda o guarda à parte.
 */
export async function sqlTargetOrRefuse(sessionId: string, resultId: string, catalogSessionId: string | null): Promise<ApiResult<SqlTarget>> {
  const body = catalogSessionId === null ? { resultID: resultId, purpose: "sql" } : { resultID: resultId, catalogSessionID: catalogSessionId, purpose: "sql" };
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditTarget(sessionId), { method: "POST", body, schema: sqlTargetSchema }), ...sqlTargetRefusals);
}

/** RN-EDIT-005 e 012: o Salvar. A resposta diz quantas alterações foram gravadas. */
export async function saveEditsOrRefuse(sessionId: string, resultId: string, changes: ApiChange[]): Promise<ApiResult<EditsApplied>> {
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEdits(sessionId), { method: "POST", body: { resultID: resultId, changes }, schema: editsAppliedSchema }), ...saveRefusals);
}

/**
 * RN-EDIT-019 e 023: a contagem da coluna inteira, antes da pergunta do "Salvar", na sessão da aba: `changes` leva só a `updateAll` (sem `rows`). É um
 * comando na sessão: fecha o cursor aberto, e se cancela pelo `queries/cancel`.
 */
export async function countWholeColumnOrRefuse(sessionId: string, resultId: string, changes: ApiChange[]): Promise<ApiResult<WholeColumnCount>> {
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditsCount(sessionId), { method: "POST", body: { resultID: resultId, changes }, schema: wholeColumnCountSchema }), ...countRefusals);
}

/** RN-EDIT-008: os comandos que o Salvar executaria, sem executar nada. */
export async function previewEditsOrRefuse(sessionId: string, resultId: string, changes: ApiChange[]): Promise<ApiResult<EditPreview>> {
  return allowRefusal(await apiRequest(prismEndpoints.userDatabaseSessionQueriesEditsPreview(sessionId), { method: "POST", body: { resultID: resultId, changes }, schema: editPreviewSchema }), ...saveRefusals);
}
