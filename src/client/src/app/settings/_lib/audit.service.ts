import { z } from "zod";

import { allowRefusal, apiRequest, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { toAuditQuery, type AuditFilters } from "./audit-filters";

export const auditLevelSchema = z.enum(["info", "warning", "high", "critical"]);
export type AuditLevelCode = z.infer<typeof auditLevelSchema>;

export const auditKindSchema = z.enum(["sql", "edits", "transaction", "transfer", "security", "connection"]);
export type AuditKindCode = z.infer<typeof auditKindSchema>;

export const auditOutcomeSchema = z.enum([
  "inProgress",
  "ok",
  "error",
  "refused",
  "cancelled",
  "interrupted",
]);
export type AuditOutcomeCode = z.infer<typeof auditOutcomeSchema>;

export const auditItemSchema = z.object({
  id: z.number(),
  startedAt: z.string(),
  level: auditLevelSchema,
  kind: auditKindSchema,
  action: z.string(),
  summary: z.string(),
  connectionId: z.string().nullable().optional(),
  connectionName: z.string().nullable(),
  database: z.string().nullable(),
  environmentName: z.string().nullable(),
  environmentColor: z.string().nullable(),
  outcome: auditOutcomeSchema,
  durationMs: z.number().nullable(),
  rows: z.number().nullable().optional(),
  scriptRunId: z.string().nullable().optional(),
});

export type AuditItem = z.infer<typeof auditItemSchema>;

export const auditPageSchema = z.object({
  items: z.array(auditItemSchema),
  total: z.number(),
  next: z.number().nullable().optional(),
});

export type AuditPage = z.infer<typeof auditPageSchema>;

export const auditEntrySchema = z.object({
  id: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable(),
  kind: auditKindSchema,
  action: z.string(),
  level: auditLevelSchema,
  reason: z.string(),
  summary: z.string(),
  outcome: auditOutcomeSchema,
  origin: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional(),
  connectionName: z.string().nullable(),
  engine: z.string().nullable().optional(),
  folderPath: z.string().nullable().optional(),
  environmentName: z.string().nullable(),
  environmentColor: z.string().nullable(),
  database: z.string().nullable(),
  sessionId: z.string().nullable().optional(),
  scriptRunId: z.string().nullable().optional(),
  sql: z.string().nullable().optional(),
  historyText: z.string().nullable().optional(),
  rows: z.number().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  sqlState: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  confirmed: z.boolean(),
  protections: z.string().nullable().optional(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditConnectionFacetSchema = z.object({
  id: z.string(),
  name: z.string(),
  deleted: z.boolean(),
  engine: z.string().nullable().optional(),
  environmentName: z.string().nullable().optional(),
  environmentColor: z.string().nullable().optional(),
});

export type AuditConnectionFacet = z.infer<typeof auditConnectionFacetSchema>;

export const auditEnvironmentFacetSchema = z.object({
  name: z.string(),
  color: z.string().nullable().optional(),
});

export type AuditEnvironmentFacet = z.infer<typeof auditEnvironmentFacetSchema>;

export const auditFacetsSchema = z.object({
  connections: z.array(auditConnectionFacetSchema),
  environments: z.array(auditEnvironmentFacetSchema),
  count: z.number(),
  oldest: z.string().nullable().optional(),
  sizeBytes: z.number(),
  retentionDays: z.number().optional(),
});

export type AuditFacets = z.infer<typeof auditFacetsSchema>;

export const journalSettingsSchema = z.object({
  retentionDays: z.number().nullable().transform((value) => value ?? 0),
});

export type JournalSettings = z.infer<typeof journalSettingsSchema>;

export const purgeAuditResultSchema = z.object({
  deleted: z.number(),
});

export type PurgeAuditResult = z.infer<typeof purgeAuditResultSchema>;

export const auditFacetsQueryKey = ["user-journal", "audit-facets"] as const;
export const auditSettingsQueryKey = ["user-journal", "settings"] as const;
export const auditEntriesQueryKey = (filters: AuditFilters) => ["user-journal", "audit-entries", filters] as const;
export const auditEntryQueryKey = (id: number) => ["user-journal", "audit-entry", id] as const;

export async function getAuditEntries(
  filters: AuditFilters,
  options?: { before?: number; limit?: number; now?: Date },
): Promise<AuditPage> {
  const qs = toAuditQuery(filters, options).toString();
  const path = qs.length > 0 ? `${prismEndpoints.userJournalAudit}?${qs}` : prismEndpoints.userJournalAudit;

  return unwrap(
    await apiRequest(path, {
      method: "GET",
      schema: auditPageSchema,
    }),
  );
}

export async function getAuditEntry(id: number): Promise<AuditEntry> {
  return unwrap(
    await apiRequest(prismEndpoints.userJournalAuditEntry(id), {
      method: "GET",
      schema: auditEntrySchema,
    }),
  );
}

export async function getAuditFacets(): Promise<AuditFacets> {
  return unwrap(
    await apiRequest(prismEndpoints.userJournalAuditFacets, {
      method: "GET",
      schema: auditFacetsSchema,
    }),
  );
}

export async function getJournalSettings(): Promise<JournalSettings> {
  return unwrap(
    await apiRequest(prismEndpoints.userJournalSettings, {
      method: "GET",
      schema: journalSettingsSchema,
    }),
  );
}

export async function updateJournalSettings(retentionDays: number): Promise<JournalSettings> {
  return unwrap(
    await apiRequest(prismEndpoints.userJournalSettings, {
      method: "PUT",
      body: { retentionDays: retentionDays === 0 ? null : retentionDays },
      schema: journalSettingsSchema,
    }),
  );
}

export async function purgeAuditOrRefuse(input: {
  before: string;
  password: string;
}): Promise<ApiResult<PurgeAuditResult>> {
  return allowRefusal(
    await apiRequest(prismEndpoints.userJournalAuditPurge, {
      method: "POST",
      body: input,
      schema: purgeAuditResultSchema,
    }),
    "INVALID_PASSWORD",
    "VAULT_LOCKED",
  );
}
