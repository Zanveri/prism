import { queryOptions } from "@tanstack/react-query";

import { apiRequest, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import {
  pluginBundlesSchema,
  pluginItemSchema,
  pluginsStateSchema,
  type PluginBundle,
  type PluginItem,
  type PluginSourceKind,
  type PluginsState,
} from "./plugins.schema";

export function getPlugins(signal?: AbortSignal): Promise<ApiResult<PluginsState>> {
  return apiRequest(prismEndpoints.userPlugins, { schema: pluginsStateSchema, signal });
}

export function getPluginBundles(signal?: AbortSignal): Promise<ApiResult<PluginBundle[]>> {
  return apiRequest(prismEndpoints.userPluginsBundles, { schema: pluginBundlesSchema, signal });
}

export function setPluginConsent(consented: boolean): Promise<ApiResult<PluginsState>> {
  return apiRequest(prismEndpoints.userPluginsConsent, {
    method: "PUT",
    body: { consented },
    schema: pluginsStateSchema,
  });
}

export function installPlugin(input: { sourceKind: PluginSourceKind; source: string }): Promise<ApiResult<PluginItem>> {
  return apiRequest(prismEndpoints.userPluginsInstall, {
    method: "POST",
    body: input,
    schema: pluginItemSchema,
  });
}

export function updatePlugin(id: string): Promise<ApiResult<PluginItem>> {
  return apiRequest(prismEndpoints.userPluginUpdate(id), {
    method: "POST",
    schema: pluginItemSchema,
  });
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<ApiResult<PluginItem>> {
  return apiRequest(prismEndpoints.userPluginEnabled(id), {
    method: "PUT",
    body: { enabled },
    schema: pluginItemSchema,
  });
}

export function removePlugin(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userPlugin(id), { method: "DELETE" });
}

export const pluginsKey = ["plugins"] as const;
export const pluginBundlesKey = ["plugins", "bundles"] as const;

export const pluginsQuery = queryOptions({
  queryKey: pluginsKey,
  queryFn: async ({ signal }) => unwrap(await getPlugins(signal)),
});

export const pluginBundlesQuery = queryOptions({
  queryKey: pluginBundlesKey,
  queryFn: async ({ signal }) => unwrap(await getPluginBundles(signal)),
  staleTime: 30_000,
});
