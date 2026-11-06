export const auditPeriods = ["1h", "today", "7d", "30d", "all", "custom"] as const;
export type AuditPeriod = (typeof auditPeriods)[number];

export const auditLevels = ["info", "warning", "high", "critical"] as const;
export type AuditLevel = (typeof auditLevels)[number];

export const auditKinds = ["sql", "edits", "transaction", "transfer", "security", "connection"] as const;
export type AuditKind = (typeof auditKinds)[number];

export const auditOutcomes = ["ok", "error", "refused", "cancelled", "interrupted"] as const;
export type AuditFilterOutcome = (typeof auditOutcomes)[number];

export const AUDIT_NO_ENVIRONMENT = "__none__";
export const AUDIT_PAGE_SIZE = 200;

export type AuditCustomRange = {
  from: string;
  to: string;
};

export type AuditFilters = {
  period: AuditPeriod;
  customRange: AuditCustomRange;
  connectionIds: string[];
  environments: string[];
  levels: AuditLevel[];
  kinds: AuditKind[];
  outcomes: AuditFilterOutcome[];
  q: string;
  scriptRunId: string | null;
};

export function defaultAuditFilters(): AuditFilters {
  return {
    period: "7d",
    customRange: { from: "", to: "" },
    connectionIds: [],
    environments: [],
    levels: [],
    kinds: [],
    outcomes: [],
    q: "",
    scriptRunId: null,
  };
}

function parseLocalBound(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function toUtcRange(
  period: AuditPeriod,
  custom: { from?: string; to?: string },
  now: Date = new Date(),
): { from?: string; to?: string } {
  switch (period) {
    case "all":
      return {};
    case "1h":
      return { from: new Date(now.getTime() - 60 * 60 * 1000).toISOString() };
    case "today": {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      return { from: startOfDay.toISOString() };
    }
    case "7d":
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() };
    case "custom": {
      const from = parseLocalBound(custom.from);
      const to = parseLocalBound(custom.to);
      return {
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      };
    }
  }
}

export function toAuditQuery(
  filters: AuditFilters,
  options?: { now?: Date; before?: number; limit?: number },
): URLSearchParams {
  const params = new URLSearchParams();
  const range = toUtcRange(filters.period, filters.customRange, options?.now);
  if (range.from !== undefined) params.set("from", range.from);
  if (range.to !== undefined) params.set("to", range.to);

  for (const id of filters.connectionIds) params.append("connectionId", id);
  for (const env of filters.environments) params.append("environment", env);
  for (const level of filters.levels) params.append("level", level);
  for (const kind of filters.kinds) params.append("kind", kind);
  for (const outcome of filters.outcomes) params.append("outcome", outcome);

  const trimmedQuery = filters.q.trim();
  if (trimmedQuery.length > 0) params.set("q", trimmedQuery);
  if (filters.scriptRunId) params.set("scriptRunId", filters.scriptRunId);
  if (options?.before !== undefined) params.set("before", String(options.before));
  params.set("limit", String(options?.limit ?? AUDIT_PAGE_SIZE));

  return params;
}

export function isHighAndCriticalSelected(levels: readonly AuditLevel[]): boolean {
  return levels.length === 2 && levels.includes("high") && levels.includes("critical");
}

export function toggleHighAndCritical(levels: readonly AuditLevel[]): AuditLevel[] {
  if (isHighAndCriticalSelected(levels)) return [];
  return ["high", "critical"];
}

export function toggleFilterItem<T>(items: readonly T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

export function hasNonDefaultAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.period !== "7d" ||
    filters.connectionIds.length > 0 ||
    filters.environments.length > 0 ||
    filters.levels.length > 0 ||
    filters.kinds.length > 0 ||
    filters.outcomes.length > 0 ||
    filters.q.trim().length > 0 ||
    filters.scriptRunId !== null
  );
}
