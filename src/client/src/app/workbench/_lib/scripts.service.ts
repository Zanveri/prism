import { queryOptions } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { editedScriptInput, type ScriptAppearance } from "./saved-scripts";
import { scriptSchema, scriptSummariesSchema, scriptSummarySchema, type Script, type ScriptInput, type ScriptPlaceInput, type ScriptSummary } from "./scripts.schema";

/**
 * As rotas dos scripts salvos (seção 23: RN-SCRIPT-001 a 004; e o genérico, RN-SCRIPT-005). As recusas que o diálogo de salvar e o de renomear mostram no próprio lugar voltam como valor
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

/**
 * RN-SCRIPT-001: o Ctrl+S da primeira vez e o "Salvar como". A pasta escolhida que outra janela excluiu (`SCRIPT_FOLDER_NOT_FOUND`, RN-SCRIPT-010) também volta
 * como valor: o diálogo a mostra no campo "Pasta".
 */
export async function createScriptOrRefuse(input: ScriptInput, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "POST", body: input, schema: scriptSummarySchema, signal }), ...nameRefusals, "SCRIPT_FOLDER_NOT_FOUND");
}

/**
 * RN-SCRIPT-001: o Ctrl+S de um script que já existe grava o SQL e o lugar da aba por cima; o do script genérico grava o SQL e o mantém genérico
 * (RN-SCRIPT-005). O 404 volta como valor: outra janela excluiu o script, e a tela pede um nome, como na primeira vez.
 */
export async function overwriteScriptOrRefuse(input: { id: string; sql: string } & ScriptPlaceInput, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: input, schema: scriptSummarySchema, signal }), "SCRIPT_NOT_FOUND", "SCRIPT_TOO_LARGE");
}

/**
 * RN-SCRIPT-005: "Tornar genérico" (`generic`) e "Vincular à conexão da aba" (a conexão e o banco da aba) no menu do script: só o lugar muda, e o nome e o SQL
 * ficam. Toda recusa (o script que outra janela excluiu, o cofre fechado) vai ao aviso central.
 */
export function changeScriptPlace(id: string, place: ScriptPlaceInput, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: { id, ...place }, schema: scriptSummarySchema, signal });
}

/**
 * RN-SCRIPT-009: o "Mover para…" do script manda só a pasta: `folderID`, ou `root: true` para a raiz da seção, porque o nulo do `PATCH` é "fica". O nome, o SQL,
 * o lugar, o ícone e a cor ficam. Toda recusa (a pasta de destino que outra janela excluiu, o script que sumiu) vai ao aviso central, com o detalhe da API.
 */
export function moveScript(id: string, folderID: string | null, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: folderID === null ? { id, root: true } : { id, folderID }, schema: scriptSummarySchema, signal });
}

/** RN-SCRIPT-003: renomear manda só o nome; o SQL e o lugar ficam. */
export async function renameScriptOrRefuse(id: string, name: string, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: { id, name }, schema: scriptSummarySchema, signal }), ...nameRefusals);
}

/**
 * RN-SCRIPT-006: o "Editar script…" grava o nome, o ícone e a cor (`editedScriptInput`); o SQL e o lugar ficam. As recusas do nome e a do ícone ou da cor
 * (`SCRIPT_ICON_INVALID`) voltam como valor, para o diálogo as mostrar no lugar; o resto vai ao aviso central.
 */
export async function editScriptOrRefuse(id: string, edited: ScriptAppearance, signal: AbortSignal = deadline()): Promise<ApiResult<ScriptSummary>> {
  return allowRefusal(await apiRequest(prismEndpoints.userScripts, { method: "PATCH", body: editedScriptInput(id, edited), schema: scriptSummarySchema, signal }), ...nameRefusals, "SCRIPT_ICON_INVALID");
}

export function deleteScript(id: string, signal: AbortSignal = deadline()): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userScript(id), { method: "DELETE", signal });
}
