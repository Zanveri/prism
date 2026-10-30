import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type UIEvent } from "react";
import { useNavigate } from "react-router";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { openFromHistory } from "@/app/workbench/_lib/history";
import { useOptionalWorkbench } from "@/app/workbench/_lib/workbench-state";
import {
  ChevronIcon,
  CloseIcon,
  EnvironmentPill,
  SearchIcon,
  ShieldCheckIcon,
  useToast,
} from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { cn } from "@/lib/utils/cn";

import {
  AUDIT_NO_ENVIRONMENT,
  AUDIT_PAGE_SIZE,
  auditKinds,
  auditLevels,
  auditOutcomes,
  auditPeriods,
  defaultAuditFilters,
  hasNonDefaultAuditFilters,
  isHighAndCriticalSelected,
  toggleFilterItem,
  toggleHighAndCritical,
  type AuditFilterOutcome,
  type AuditFilters,
  type AuditKind,
  type AuditLevel,
  type AuditPeriod,
} from "../_lib/audit-filters";
import { auditCopy } from "../_lib/audit.copy";
import {
  auditEntriesQueryKey,
  auditEntryQueryKey,
  auditFacetsQueryKey,
  auditSettingsQueryKey,
  getAuditEntries,
  getAuditEntry,
  getAuditFacets,
  getJournalSettings,
  updateJournalSettings,
  type AuditEntry,
  type AuditItem,
} from "../_lib/audit.service";
import {
  AuditDetail,
  AuditLevelBadge,
  formatAuditDateTime,
  formatAuditDuration,
  outcomeToneClass,
} from "./audit-detail";
import { AuditPurgeDialog } from "./audit-purge-dialog";

const copy = auditCopy;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return copy.stats.noOldest;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return copy.stats.noOldest;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatRetentionLabel(days: number): string {
  const option = copy.retention.options.find((item) => item.value === days);
  return option ? option.label : `${days} dias`;
}

type OpenDropdown = "period" | "connections" | "environments" | "levels" | "kinds" | "outcomes" | null;

export function AuditSection({ anchor }: { anchor: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workbench = useOptionalWorkbench();

  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const connections = useQuery({ ...connectionsQuery, enabled: false });

  const [filters, setFilters] = useState<AuditFilters>(() => defaultAuditFilters());
  const [searchDraft, setSearchDraft] = useState("");
  const [connectionFilterSearch, setConnectionFilterSearch] = useState("");
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.q === searchDraft ? current : { ...current, q: searchDraft }));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const facetsQuery = useQuery({
    queryKey: auditFacetsQueryKey,
    queryFn: getAuditFacets,
  });

  const settingsQuery = useQuery({
    queryKey: auditSettingsQueryKey,
    queryFn: getJournalSettings,
  });

  const entriesQuery = useInfiniteQuery({
    queryKey: auditEntriesQueryKey(filters),
    queryFn: ({ pageParam }) =>
      getAuditEntries(filters, {
        before: pageParam,
        limit: AUDIT_PAGE_SIZE,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });

  const detailQuery = useQuery({
    queryKey: auditEntryQueryKey(selectedId ?? 0),
    queryFn: () => getAuditEntry(selectedId!),
    enabled: selectedId !== null,
  });

  const retentionMutation = useMutation({
    mutationFn: updateJournalSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(auditSettingsQueryKey, updated);
      void queryClient.invalidateQueries({ queryKey: ["user-journal"] });
      toast.success(copy.retention.savedToast);
    },
    onError: () => {
      toast.error(copy.retention.saveErrorToast);
    },
  });

  const facets = facetsQuery.data;
  const retentionDays = settingsQuery.data?.retentionDays ?? facets?.retentionDays ?? 90;

  const deletedConnectionIds = useMemo(() => {
    const set = new Set<string>();
    for (const conn of facets?.connections ?? []) {
      if (conn.deleted) set.add(conn.id);
    }
    return set;
  }, [facets?.connections]);

  const allItems = useMemo<AuditItem[]>(
    () => entriesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [entriesQuery.data],
  );
  const totalFound = entriesQuery.data?.pages[0]?.total ?? allItems.length;

  const filteredConnections = useMemo(() => {
    const list = facets?.connections ?? [];
    const term = connectionFilterSearch.trim().toLowerCase();
    if (!term) return list;
    return list.filter((conn) => conn.name.toLowerCase().includes(term));
  }, [facets?.connections, connectionFilterSearch]);

  function handleTableScroll(event: UIEvent<HTMLDivElement>) {
    if (!entriesQuery.hasNextPage || entriesQuery.isFetchingNextPage) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      void entriesQuery.fetchNextPage();
    }
  }

  function handleResetFilters() {
    setSearchDraft("");
    setFilters(defaultAuditFilters());
    setOpenDropdown(null);
  }

  function handleOpenInEditor(entry: AuditEntry) {
    const sqlText = entry.historyText ?? entry.sql ?? "";
    const activeConnections = Array.isArray(connections.data)
      ? connections.data.map((conn) => ({ id: conn.id }))
      : (facets?.connections ?? []).filter((conn) => !conn.deleted).map((conn) => ({ id: conn.id }));

    const target = openFromHistory(
      {
        connectionId: entry.connectionId ?? null,
        database: entry.database ?? null,
        text: sqlText,
      },
      activeConnections,
    );

    if (workbench) {
      workbench.openQueryTab(target.connectionId, target.sql, target.database);
      toast.success(copy.detail.openedInEditor);
      void navigate(pathsConfig.workbench);
    }
  }

  const userName = session.data?.userName;
  const subtitle = userName ? copy.subtitle(userName) : copy.subtitleAnonymous;

  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="flex min-h-[calc(100vh-8rem)] flex-col gap-4"
    >
      {/* Cabeçalho com título, subtítulo e contadores (RN-AUDIT-010) */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border pb-4">
        <div className="min-w-0 flex-1 basis-[420px]">
          <h2
            id={`${anchor}-title`}
            tabIndex={-1}
            className="m-0 flex items-center gap-2.5 text-lg leading-[26px] font-semibold text-ink"
          >
            <ShieldCheckIcon className="size-5 text-postgres" />
            <span>{copy.title}</span>
          </h2>
          <p className="mt-1 max-w-[70ch] text-muted">{subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-5 text-xs text-muted">
          <span>
            <strong className="block text-base font-semibold text-ink">
              {(facets?.count ?? 0).toLocaleString("pt-BR")}
            </strong>
            {copy.stats.entries}
          </span>
          <span>
            <strong className="block text-base font-semibold text-ink">
              {formatShortDate(facets?.oldest)}
            </strong>
            {copy.stats.oldest}
          </span>
          <span>
            <strong className="block text-base font-semibold text-ink">
              {formatRetentionLabel(retentionDays)}
            </strong>
            {copy.stats.retentionAndSize(formatBytes(facets?.sizeBytes ?? 0))}
          </span>
        </div>
      </div>

      {/* Barra de filtros que quebra linha (RN-AUDIT-011) */}
      <div
        role="search"
        aria-label={copy.filters.regionLabel}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="flex h-[34px] min-w-[240px] flex-1 basis-[260px] items-center gap-2 rounded-md border border-border-strong bg-raised px-2.5">
          <SearchIcon className="size-3.5 text-subtle" />
          <span className="sr-only">{copy.filters.searchLabel}</span>
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={copy.filters.searchPlaceholder}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-subtle"
          />
        </label>

        {/* Período */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "period"}
            onClick={() => setOpenDropdown((current) => (current === "period" ? null : "period"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.period !== "all" ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.periodLabel}</span>
            <span>{copy.periods[filters.period]}</span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "period" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex w-64 flex-col gap-1 rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              {auditPeriods.map((period: AuditPeriod) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => {
                    setFilters((current) => ({ ...current, period }));
                    if (period !== "custom") setOpenDropdown(null);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded px-2 py-1.5 text-left text-xs",
                    filters.period === period ? "bg-selected font-semibold text-ink" : "text-body hover:bg-selected",
                  )}
                >
                  <span>{copy.periods[period]}</span>
                </button>
              ))}
              {filters.period === "custom" ? (
                <div className="mt-1 flex flex-col gap-2 border-t border-border pt-2">
                  <label className="flex flex-col gap-1 text-[11px] text-subtle">
                    <span>{copy.filters.customFrom}</span>
                    <input
                      type="datetime-local"
                      value={filters.customRange.from}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          customRange: { ...current.customRange, from: event.target.value },
                        }))
                      }
                      className="h-8 rounded border border-border-strong bg-background px-2 text-xs text-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-subtle">
                    <span>{copy.filters.customTo}</span>
                    <input
                      type="datetime-local"
                      value={filters.customRange.to}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          customRange: { ...current.customRange, to: event.target.value },
                        }))
                      }
                      className="h-8 rounded border border-border-strong bg-background px-2 text-xs text-ink"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Conexões */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "connections"}
            onClick={() => setOpenDropdown((current) => (current === "connections" ? null : "connections"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.connectionIds.length > 0 ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.connectionsLabel}</span>
            <span>
              {filters.connectionIds.length === 0
                ? copy.filters.allFeminine
                : String(filters.connectionIds.length)}
            </span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "connections" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex max-h-72 w-72 flex-col gap-1.5 overflow-y-auto rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              <input
                type="search"
                value={connectionFilterSearch}
                onChange={(event) => setConnectionFilterSearch(event.target.value)}
                placeholder={copy.filters.connectionSearchPlaceholder}
                className="h-8 rounded border border-border-strong bg-background px-2 text-xs text-ink"
              />
              {filteredConnections.map((conn) => {
                const checked = filters.connectionIds.includes(conn.id);
                return (
                  <label
                    key={conn.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink hover:bg-selected"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setFilters((current) => ({
                          ...current,
                          connectionIds: toggleFilterItem(current.connectionIds, conn.id),
                        }))
                      }
                    />
                    <span className="truncate">{conn.name}</span>
                    {conn.deleted ? (
                      <span className="text-[11px] text-subtle">{copy.filters.deletedConnectionSuffix}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Ambientes */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "environments"}
            onClick={() => setOpenDropdown((current) => (current === "environments" ? null : "environments"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.environments.length > 0 ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.environmentsLabel}</span>
            <span>
              {filters.environments.length === 0
                ? copy.filters.all
                : filters.environments
                    .map((env) => (env === AUDIT_NO_ENVIRONMENT ? copy.filters.noEnvironment : env))
                    .join(", ")}
            </span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "environments" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex w-60 flex-col gap-1 rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              {(facets?.environments ?? []).map((env) => {
                const checked = filters.environments.includes(env.name);
                return (
                  <label
                    key={env.name}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink hover:bg-selected"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setFilters((current) => ({
                          ...current,
                          environments: toggleFilterItem(current.environments, env.name),
                        }))
                      }
                    />
                    <EnvironmentPill
                      name={env.name}
                      color={env.color?.startsWith("#") ? env.color : null}
                    />
                  </label>
                );
              })}
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-muted hover:bg-selected">
                <input
                  type="checkbox"
                  checked={filters.environments.includes(AUDIT_NO_ENVIRONMENT)}
                  onChange={() =>
                    setFilters((current) => ({
                      ...current,
                      environments: toggleFilterItem(current.environments, AUDIT_NO_ENVIRONMENT),
                    }))
                  }
                />
                <span>{copy.filters.noEnvironment}</span>
              </label>
            </div>
          ) : null}
        </div>

        {/* Nível */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "levels"}
            onClick={() => setOpenDropdown((current) => (current === "levels" ? null : "levels"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.levels.length > 0 ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.levelsLabel}</span>
            <span>
              {filters.levels.length === 0
                ? copy.filters.all
                : filters.levels.map((lv) => copy.levels[lv].label).join(", ")}
            </span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "levels" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex w-56 flex-col gap-1 rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              <button
                type="button"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    levels: toggleHighAndCritical(current.levels),
                  }))
                }
                className={cn(
                  "mb-1 rounded border px-2 py-1 text-left text-xs font-medium",
                  isHighAndCriticalSelected(filters.levels)
                    ? "border-postgres bg-selected text-ink"
                    : "border-border text-body hover:bg-selected",
                )}
              >
                {copy.filters.highAndCriticalShortcut}
              </button>
              {auditLevels.map((lv: AuditLevel) => (
                <label
                  key={lv}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink hover:bg-selected"
                >
                  <input
                    type="checkbox"
                    checked={filters.levels.includes(lv)}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        levels: toggleFilterItem(current.levels, lv),
                      }))
                    }
                  />
                  <AuditLevelBadge level={lv} />
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {/* Tipo */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "kinds"}
            onClick={() => setOpenDropdown((current) => (current === "kinds" ? null : "kinds"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.kinds.length > 0 ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.kindsLabel}</span>
            <span>
              {filters.kinds.length === 0
                ? copy.filters.all
                : filters.kinds.map((k) => copy.kinds[k]).join(", ")}
            </span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "kinds" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              {auditKinds.map((kind: AuditKind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink hover:bg-selected"
                >
                  <input
                    type="checkbox"
                    checked={filters.kinds.includes(kind)}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        kinds: toggleFilterItem(current.kinds, kind),
                      }))
                    }
                  />
                  <span>{copy.kinds[kind]}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {/* Resultado */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openDropdown === "outcomes"}
            onClick={() => setOpenDropdown((current) => (current === "outcomes" ? null : "outcomes"))}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs text-ink",
              filters.outcomes.length > 0 ? "border-postgres" : "border-border-strong",
            )}
          >
            <span className="text-subtle">{copy.filters.outcomesLabel}</span>
            <span>
              {filters.outcomes.length === 0
                ? copy.filters.all
                : filters.outcomes.map((o) => copy.outcomes[o]).join(", ")}
            </span>
            <ChevronIcon className="size-3" />
          </button>
          {openDropdown === "outcomes" ? (
            <div className="absolute top-full left-0 z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-border-strong bg-raised p-2 shadow-lg">
              {auditOutcomes.map((outcome: AuditFilterOutcome) => (
                <label
                  key={outcome}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink hover:bg-selected"
                >
                  <input
                    type="checkbox"
                    checked={filters.outcomes.includes(outcome)}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        outcomes: toggleFilterItem(current.outcomes, outcome),
                      }))
                    }
                  />
                  <span>{copy.outcomes[outcome]}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleResetFilters}
          className="h-[34px] px-2.5 text-xs text-link hover:underline"
        >
          {copy.filters.clearFilters}
        </button>
      </div>

      {/* Faixa de filtros ativos e total encontrado */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{copy.filters.activePrefix}</span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-selected px-2.5 text-ink">
          {copy.periods[filters.period]}
        </span>
        {isHighAndCriticalSelected(filters.levels) ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-selected px-2.5 text-ink">
            {copy.filters.highAndCriticalShortcut}
            <button
              type="button"
              aria-label={copy.filters.removeFilter(copy.filters.levelsLabel)}
              onClick={() => setFilters((current) => ({ ...current, levels: [] }))}
              className="flex items-center text-muted hover:text-ink"
            >
              <CloseIcon className="size-2.5" />
            </button>
          </span>
        ) : null}
        {filters.scriptRunId ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-selected px-2.5 text-ink">
            {copy.filters.scriptFilterChip}
            <button
              type="button"
              aria-label={copy.filters.removeFilter(copy.filters.scriptFilterChip)}
              onClick={() => setFilters((current) => ({ ...current, scriptRunId: null }))}
              className="flex items-center text-muted hover:text-ink"
            >
              <CloseIcon className="size-2.5" />
            </button>
          </span>
        ) : null}
        <span className="ml-auto">{copy.filters.totalFound(totalFound)}</span>
      </div>

      {/* Corpo: tabela com cabeçalho fixo + painel de detalhe à direita (RN-AUDIT-012 e 013) */}
      <div className="flex min-h-[380px] flex-1 flex-wrap rounded-md border border-border bg-background">
        <div
          onScroll={handleTableScroll}
          className="max-h-[560px] min-w-0 flex-1 basis-[560px] overflow-auto"
        >
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-border bg-panel text-muted">
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {copy.table.dateTime}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.table.level}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.table.event}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.table.connection}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.table.environment}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.table.outcome}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {copy.table.duration}
                </th>
              </tr>
            </thead>
            <tbody>
              {allItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    {entriesQuery.isLoading
                      ? copy.table.loading
                      : hasNonDefaultAuditFilters(filters)
                        ? copy.table.emptyFiltered
                        : copy.table.empty}
                  </td>
                </tr>
              ) : (
                allItems.map((item) => {
                  const isSelected = selectedId === item.id;
                  const isDeletedConnection =
                    Boolean(item.connectionId) && deletedConnectionIds.has(item.connectionId!);
                  return (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(item.id);
                        }
                      }}
                      className={cn(
                        "cursor-pointer border-b border-border/60 transition-colors hover:bg-selected/60",
                        isSelected && "bg-selected shadow-[inset_2px_0_0_var(--color-postgres)]",
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-body">
                        {formatAuditDateTime(item.startedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <AuditLevelBadge level={item.level} />
                      </td>
                      <td className="min-w-[220px] px-3 py-2">
                        <span className="font-medium text-ink">{item.action}</span>
                        {item.summary ? (
                          <span className="ml-1.5 text-subtle">· {item.summary}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {item.connectionName ? (
                          <div>
                            <span className="text-ink">{item.connectionName}</span>
                            {isDeletedConnection ? (
                              <span className="ml-1 text-[11px] text-subtle">
                                {copy.filters.deletedConnectionSuffix}
                              </span>
                            ) : null}
                            {item.database ? (
                              <span className="block text-[11px] text-subtle">{item.database}</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.environmentName ? (
                          <EnvironmentPill
                            name={item.environmentName}
                            color={
                              item.environmentColor?.startsWith("#") ? item.environmentColor : null
                            }
                          />
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className={cn("px-3 py-2 whitespace-nowrap", outcomeToneClass(item.outcome))}>
                        {copy.outcomes[item.outcome]}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                        {formatAuditDuration(item.durationMs)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {entriesQuery.hasNextPage ? (
            <div className="flex justify-center p-3">
              <button
                type="button"
                disabled={entriesQuery.isFetchingNextPage}
                onClick={() => void entriesQuery.fetchNextPage()}
                className="h-8 rounded-md border border-border-strong px-3 text-xs text-ink hover:bg-selected"
              >
                {entriesQuery.isFetchingNextPage ? copy.table.loadingMore : copy.table.loadMore}
              </button>
            </div>
          ) : null}
        </div>

        {selectedId !== null && detailQuery.data ? (
          <AuditDetail
            entry={detailQuery.data}
            connectionDeleted={
              Boolean(detailQuery.data.connectionId) &&
              deletedConnectionIds.has(detailQuery.data.connectionId!)
            }
            onClose={() => setSelectedId(null)}
            onOpenInEditor={handleOpenInEditor}
            onFilterByScriptRun={(scriptRunId) =>
              setFilters((current) => ({ ...current, scriptRunId }))
            }
          />
        ) : null}
      </div>

      {/* Cartão da guarda e Apagar registros… (RN-AUDIT-015 e 016, RN-DIARIO-008) */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-raised p-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="aud-guarda" className="text-xs font-medium text-ink">
              {copy.retention.label}
            </label>
            <select
              id="aud-guarda"
              value={retentionDays}
              disabled={retentionMutation.isPending}
              onChange={(event) => retentionMutation.mutate(Number(event.target.value))}
              className="h-8 rounded-md border border-border-strong bg-background px-2.5 text-xs text-ink"
            >
              {copy.retention.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="m-0 text-xs text-subtle">{copy.retention.hint}</p>
        </div>

        <button
          type="button"
          onClick={() => setPurgeOpen(true)}
          className="h-8 rounded-md border border-danger/50 px-3 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
        >
          {copy.retention.purgeButton}
        </button>
      </div>

      <AuditPurgeDialog open={purgeOpen} onClose={() => setPurgeOpen(false)} />
    </section>
  );
}
