import { queryOptions } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { scriptSchema, scriptSummariesSchema, scriptSummarySchema, type Script, type ScriptInput, type ScriptSummary } from "./scripts.schema";

/**
 * As rotas dos scripts salvos (seção 23: RN-SCRIPT-001 a 004). As recusas que o diálogo de salvar e o de renomear mostram no próprio lugar voltam como valor
 * (`allowRefusal`); as outras lançam e viram o aviso central (RN-AVISO-004). Salvar, renomear e excluir deixam um botão em "…ando…", e por isso têm o prazo
 * das ações da pessoa (`userActionDeadlineMs`).
 */

/** O nome repetido, o nome inválido e o SQL grande demais: o diálogo os mostra no campo. */
const nameRefusals = ["SCRIPT_ALREADY_EXISTS", "SCRIPT_NAME_INVALID", "SCRIPT_TOO_LARGE"];

const deadline = () => AbortSignal.timeout(userActionDeadlineMs);

export function listScripts(signal?: AbortSignal): Promise<ApiResult<ScriptSummary[]>> {
  return apiRequest(prismEndpoints.userScripts, { schema: scriptSummariesSchema, signal });
}

/** A seção "Scripts" do navegador (RN-SCRIPT-003). Só existe dentro do cofre aberto, como as conexões. */
export const scriptsQuery = queryOptions({ queryKey: ["scripts"], queryFn: async ({ signal }) => unwrap(await listScripts(signal)) });

export function getScript(id: string, signal?: AbortSignal): Promise<ApiResult<Script>> {
  return apiRequest(prismEndpoints.userScript(id), { schema: scriptSchema, signal });
}

/** RN-SCRIPT-001: o Ctrl+S da primeira vez e o "Salvar como". */
export async function createScriptOrRefuse(input: ScriptInput, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "POST", body: input, schema: scriptSummarySchema, signal }), ...nameRefusals);
}

/**
 * RN-SCRIPT-001: o Ctrl+S de um script que já existe grava o SQL e o lugar da aba por cima. O 404 volta como valor: outra janela excluiu o script, e a tela
 * pede um nome, como na primeira vez.
 */
export async function overwriteScriptOrRefuse(input: Omit<ScriptInput, "name"> & { id: string }, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: input, schema: scriptSummarySchema, signal }), "SCRIPT_NOT_FOUND", "SCRIPT_TOO_LARGE");
}

/** RN-SCRIPT-003: renomear manda só o nome; o SQL e o lugar ficam. */
export async function renameScriptOrRefuse(id: string, name: string, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: { id, name }, schema: scriptSummarySchema, signal }), ...nameRefusals);
}

export function deleteScript(id: string, signal: AbortSignal = deadline()): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userScript(id), { method: "DELETE", signal });
}
