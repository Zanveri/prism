import { queryOptions } from "@tanstack/react-query";

import { apiRequest, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { driversSchema, type Driver } from "./drivers.schema";
import { driversErrorMeta, pollFailed, pollInterval, pollSucceeded } from "./drivers.polling";

/**
 * Uma função por rota de `api/user/drivers` (seção 16 da especificação). Devolvem `ApiResult`; quem as
 * chama numa `queryFn` ou `mutationFn` passa o resultado por `unwrap` (ou por `allowRefusal`, quando a
 * tela mostra certas recusas no lugar), para o erro chegar ao aviso central (RN-AVISO-004).
 */

export function listDrivers(signal?: AbortSignal): Promise<ApiResult<Driver[]>> {
  return apiRequest(prismEndpoints.userDrivers, { schema: driversSchema, signal });
}

/**
 * 202: o download começa e segue na API. O corpo leva o aceite **que a pessoa deu**, e não um `true` fixo (RN-DRIVER-003: sem
 * o aceite a API recusa com 422 `DRIVER_LICENSE_NOT_ACCEPTED`). Quem chama só passa `true` depois de a caixa estar marcada.
 */
export function installDriver(id: string, acceptedLicense: boolean): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDriverInstall(id), { method: "POST", body: { acceptedLicense } });
}

/** 204: cancela a instalação em andamento. */
export function cancelDriverInstall(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDriverInstall(id), { method: "DELETE" });
}

/** 204: a remoção vale no próximo reinício da API (RN-DRIVER-007). */
export function removeDriver(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDriver(id), { method: "DELETE" });
}

export const driversKey = ["drivers"] as const;

/**
 * A lista de drivers. Enquanto algum baixa ela é consultada de novo a cada segundo, e só enquanto
 * isso (`pollInterval`, item D: com uma folga de 10 s depois de um 202, e parando depois de 3 erros seguidos). Só a tela de Drivers a busca; a barra superior apenas lê o
 * que ela deixou no cache (`gcTime` infinito: o aviso de reinício pendente não some por a pessoa
 * ter ficado cinco minutos em outra tela). O cache nasce de novo quando a API reinicia (`ApiGate`).
 */
export const driversQuery = queryOptions({
  queryKey: driversKey,
  queryFn: async ({ signal }) => {
    const result = await listDrivers(signal);
    if (result.ok) pollSucceeded();
    // Pedido cancelado (a tela saiu) não é erro da API.
    else if (!signal.aborted) pollFailed();
    return unwrap(result);
  },
  refetchInterval: (query) => pollInterval(query.state.data),
  meta: driversErrorMeta,
  gcTime: Infinity,
});
