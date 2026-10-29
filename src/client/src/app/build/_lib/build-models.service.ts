import { queryOptions } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { buildModelDtoSchema, buildModelDtosSchema, type BuildModelDto } from "./build-model.schema";

export type { BuildModelDto } from "./build-model.schema";

/**
 * As rotas dos modelos do Construir (`api/user/build-models`, seção 7 da especificação).
 * As recusas de nome, tamanho e concorrência voltam como valor (`allowRefusal`) para o diálogo ou a barra mostrarem.
 */
const modelRefusals = [
  "BUILD_MODEL_ALREADY_EXISTS",
  "BUILD_MODEL_NAME_INVALID",
  "BUILD_MODEL_TOO_LARGE",
  "BUILD_MODEL_CHANGED",
] as const;

const deadline = () => AbortSignal.timeout(userActionDeadlineMs);

export function listBuildModels(signal?: AbortSignal): Promise<ApiResult<BuildModelDto[]>> {
  return apiRequest(prismEndpoints.userBuildModels, { schema: buildModelDtosSchema, signal });
}

export const buildModelsQuery = queryOptions({
  queryKey: ["build-models"],
  queryFn: async ({ signal }) => unwrap(await listBuildModels(signal)),
});

export function getBuildModel(id: string, signal?: AbortSignal): Promise<ApiResult<BuildModelDto>> {
  return apiRequest(prismEndpoints.userBuildModel(id), { schema: buildModelDtoSchema, signal });
}

export async function createBuildModel(
  input: { name: string; body: string },
  signal: AbortSignal = deadline(),
): Promise<ApiResult<BuildModelDto>> {
  return allowRefusal(
    await apiRequest(prismEndpoints.userBuildModels, {
      method: "POST",
      body: input,
      schema: buildModelDtoSchema,
      signal,
    }),
    ...modelRefusals,
  );
}

export async function updateBuildModel(
  id: string,
  input: { name?: string; body?: string; expectedUpdatedAt: string },
  signal: AbortSignal = deadline(),
): Promise<ApiResult<BuildModelDto>> {
  return allowRefusal(
    await apiRequest(prismEndpoints.userBuildModel(id), {
      method: "PATCH",
      body: input,
      schema: buildModelDtoSchema,
      signal,
    }),
    ...modelRefusals,
  );
}

export function deleteBuildModel(id: string, signal: AbortSignal = deadline()): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userBuildModel(id), { method: "DELETE", signal });
}
