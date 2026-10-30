import { z } from "zod";

export const pluginSourceKinds = ["git", "local"] as const;
export type PluginSourceKind = (typeof pluginSourceKinds)[number];

export const pluginItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  sourceKind: z.string().transform((value): PluginSourceKind => (value === "local" ? "local" : "git")),
  source: z.string(),
  enabled: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  available: z.boolean(),
  errorMessage: z.string().nullable(),
});

export type PluginItem = z.infer<typeof pluginItemSchema>;

export const pluginsStateSchema = z.object({
  consented: z.boolean(),
  consentedAt: z.string().nullable(),
  items: z.array(pluginItemSchema),
});

export type PluginsState = z.infer<typeof pluginsStateSchema>;

export const pluginBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  engines: z.array(z.string()),
  code: z.string(),
});

export type PluginBundle = z.infer<typeof pluginBundleSchema>;

export const pluginBundlesSchema = z.array(pluginBundleSchema);
