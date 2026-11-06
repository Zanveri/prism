import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import {
  AlertIcon,
  Button,
  CheckIcon,
  CloseIcon,
  controlClassName,
  DuplicateIcon,
  EnvironmentPill,
  HistoryIcon,
  MinusIcon,
  SearchIcon,
  TrashIcon
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  formatHistoryTime,
  groupByDay,
  splitPreviewLines
} from "../_lib/history";
import { historyCopy } from "../_lib/history.copy";
import {
  getHistory,
  hideConnectionHistory,
  hideHistoryEntry,
  type HistoryItem,
  type HistoryOutcome
} from "../_lib/history.service";
import { HighlightedSql } from "./highlighted-sql";

export type HistoryPanelProps = {
  connectionId: string | null;
  connectionName?: string | null;
  onInsertAtCursor: (sql: string) => void;
  onOpenInNewTab: (item: HistoryItem) => void;
  onClose: () => void;
};

const PAGE_LIMIT = 100;

function OutcomeBadge({ outcome }: { outcome: HistoryOutcome }) {
  const label = historyCopy.outcomes[outcome] ?? historyCopy.outcomes.interrupted;
  if (outcome === "ok" || outcome === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <CheckIcon className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (outcome === "error" || outcome === "refused") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
        <AlertIcon className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      <MinusIcon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function HistoryPanel({
  connectionId,
  connectionName,
  onInsertAtCursor,
  onOpenInNewTab,
  onClose
}: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"connection" | "all">(
    connectionId ? "connection" : "all"
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 150);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const effectiveConnectionId = scope === "connection" ? connectionId : null;

  const historyQuery = useInfiniteQuery({
    queryKey: ["journal", "history", effectiveConnectionId, debouncedSearch],
    queryFn: ({ pageParam }) =>
      getHistory({
        connectionId: effectiveConnectionId,
        q: debouncedSearch || undefined,
        before: pageParam,
        limit: PAGE_LIMIT
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_LIMIT
        ? lastPage[lastPage.length - 1]?.id
        : undefined
  });

  const hideEntryMutation = useMutation({
    mutationFn: (id: number) => hideHistoryEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["journal", "history"] });
    }
  });

  const hideConnectionMutation = useMutation({
    mutationFn: (connId: string) => hideConnectionHistory(connId),
    onSuccess: () => {
      setConfirmingClear(false);
      void queryClient.invalidateQueries({ queryKey: ["journal", "history"] });
    }
  });

  const pages = historyQuery.data?.pages ?? [];
  const items: HistoryItem[] = [];
  for (const page of pages) {
    for (const item of page) {
      items.push(item);
    }
  }

  const selected =
    items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const groups = groupByDay(items);

  function handleCopy(item: HistoryItem) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(item.text);
    }
    setCopiedId(item.id);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirmingClear) {
        setConfirmingClear(false);
        return;
      }
      if (searchInput.length > 0) {
        setSearchInput("");
        setDebouncedSearch("");
        return;
      }
      onClose();
      return;
    }

    if (items.length === 0) return;

    const currentIndex = selected
      ? items.findIndex((item) => item.id === selected.id)
      : 0;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = Math.min(items.length - 1, currentIndex + 1);
      const nextItem = items[nextIndex];
      if (nextItem) setSelectedId(nextItem.id);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = Math.max(0, currentIndex - 1);
      const prevItem = items[prevIndex];
      if (prevItem) setSelectedId(prevItem.id);
      return;
    }

    if (!selected) return;

    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onOpenInNewTab(selected);
      } else {
        onInsertAtCursor(selected.text);
      }
      return;
    }

    if (
      e.key === "Delete" &&
      (typeof document === "undefined" ||
        searchRef.current !== document.activeElement)
    ) {
      e.preventDefault();
      hideEntryMutation.mutate(selected.id);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (!sel || sel.isCollapsed) {
        e.preventDefault();
        handleCopy(selected);
      }
    }
  }

  function handleListScroll(e: UIEvent<HTMLDivElement>) {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      void historyQuery.fetchNextPage();
    }
  }

  return (
    <aside
      aria-label={historyCopy.title}
      onKeyDown={handleKeyDown}
      className="flex h-full w-[420px] max-w-[420px] min-w-0 flex-none flex-col border-l border-border bg-panel text-ink"
    >
      {/* Cabeçalho */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <HistoryIcon className="h-3.5 w-3.5 text-muted" />
            <span>{historyCopy.title}</span>
          </div>
          <button
            type="button"
            aria-label={historyCopy.close}
            title={historyCopy.close}
            onClick={onClose}
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-selected hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Busca */}
        <div className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted" />
          <input
            ref={searchRef}
            type="search"
            autoFocus={true}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={historyCopy.searchPlaceholder}
            aria-label={historyCopy.searchPlaceholder}
            className={cn(controlClassName, "h-8 bg-background pl-8 pr-7 text-xs")}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              aria-label={historyCopy.clearSearch}
              onClick={() => {
                setSearchInput("");
                setDebouncedSearch("");
                searchRef.current?.focus();
              }}
              className="absolute right-1.5 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-muted hover:text-ink"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Escopo */}
        <div
          role="radiogroup"
          aria-label={historyCopy.scopeAria}
          className="grid grid-cols-2 gap-1 rounded bg-background p-0.5 text-xs"
        >
          <button
            type="button"
            role="radio"
            aria-checked={scope === "connection"}
            disabled={!connectionId}
            onClick={() => setScope("connection")}
            className={cn(
              "h-6 cursor-pointer rounded px-2 text-[11px] font-medium transition-colors",
              scope === "connection"
                ? "bg-raised text-ink shadow-xs"
                : "text-muted hover:text-ink",
              !connectionId && "cursor-not-allowed opacity-50"
            )}
          >
            {historyCopy.scopeThisConnection}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === "all"}
            onClick={() => setScope("all")}
            className={cn(
              "h-6 cursor-pointer rounded px-2 text-[11px] font-medium transition-colors",
              scope === "all"
                ? "bg-raised text-ink shadow-xs"
                : "text-muted hover:text-ink"
            )}
          >
            {historyCopy.scopeAllConnections}
          </button>
        </div>
      </div>

      {/* Lista agrupada por dia */}
      <div
        onScroll={handleListScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {historyQuery.isLoading ? (
          <div className="px-3 py-6 text-center text-xs text-muted">
            {historyCopy.loading}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">
            {debouncedSearch.length > 0
              ? historyCopy.emptyFiltered
              : historyCopy.empty}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.day} className="border-b border-border/60 last:border-b-0">
              <div className="sticky top-0 z-10 border-b border-border/60 bg-panel/95 px-3 py-1 text-[10px] font-semibold tracking-wider text-subtle uppercase backdrop-blur-xs">
                {group.day}
              </div>
              <div className="divide-y divide-border/50">
                {group.items.map((item) => {
                  const isSelected = selected?.id === item.id;
                  const { preview, extraLines } = splitPreviewLines(item.text, 3);
                  const time = formatHistoryTime(item.lastAt || item.startedAt);
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      onClick={() => setSelectedId(item.id)}
                      onDoubleClick={() => onInsertAtCursor(item.text)}
                      className={cn(
                        "cursor-pointer px-3 py-2 transition-colors",
                        isSelected
                          ? "bg-selected"
                          : "hover:bg-selected/60"
                      )}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        <span className="font-mono text-subtle">{time}</span>
                        <OutcomeBadge outcome={item.outcome} />
                        <span className="font-mono text-muted">
                          {historyCopy.durationFormat(item.durationMs)}
                        </span>
                        {item.rows !== null && (
                          <span className="text-muted">
                            · {historyCopy.rowsFormat(item.rows)}
                          </span>
                        )}
                        {item.repeat > 1 && (
                          <span
                            title={historyCopy.repeatTitle(item.repeat)}
                            className="ml-auto rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted"
                          >
                            {historyCopy.repeatBadge(item.repeat)}
                          </span>
                        )}
                      </div>

                      {scope === "all" && item.connectionName && (
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                          {item.environmentName && item.environmentColor && (
                            <EnvironmentPill
                              name={item.environmentName}
                              color={item.environmentColor}
                            />
                          )}
                          <span className="truncate font-medium text-ink">
                            {item.connectionName}
                          </span>
                          {item.database && (
                            <span className="truncate font-mono text-[10px] text-subtle">
                              / {item.database}
                            </span>
                          )}
                        </div>
                      )}

                      <pre className="line-clamp-3 font-mono text-xs leading-snug break-all whitespace-pre-wrap">
                        <HighlightedSql text={preview} />
                      </pre>
                      {extraLines > 0 && (
                        <div className="mt-0.5 text-[10px] text-subtle">
                          {historyCopy.moreLines(extraLines)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {historyQuery.hasNextPage && (
          <div className="p-2 text-center">
            <Button
              size="sm"
              variant="ghost"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}
            >
              {historyCopy.loadMore}
            </Button>
          </div>
        )}
      </div>

      {/* Prévia do item selecionado + ações */}
      {selected && (
        <div className="flex flex-col border-t border-border bg-background">
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-2.5 py-1.5">
            <Button
              size="sm"
              variant="primary"
              title={historyCopy.insertAtCursorHint}
              onClick={() => onInsertAtCursor(selected.text)}
              className="h-6 px-2 text-xs"
            >
              {historyCopy.insertAtCursor}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              title={historyCopy.openInNewTabHint}
              onClick={() => onOpenInNewTab(selected)}
              className="h-6 px-2 text-xs"
            >
              {historyCopy.openInNewTab}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={historyCopy.copyHint}
              onClick={() => handleCopy(selected)}
              className="h-6 px-2 text-xs"
            >
              <DuplicateIcon className="h-3 w-3" />
              <span>
                {copiedId === selected.id ? historyCopy.copied : historyCopy.copy}
              </span>
            </Button>
            <button
              type="button"
              aria-label={historyCopy.removeFromHistory}
              title={historyCopy.removeFromHistoryHint}
              onClick={() => hideEntryMutation.mutate(selected.id)}
              className="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-selected hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <pre className="max-h-36 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            <HighlightedSql text={selected.text} />
          </pre>

          {selected.errorMessage && (
            <div className="border-t border-danger/30 bg-danger/10 px-3 py-1.5 font-mono text-[11px] text-danger">
              {selected.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Rodapé: Limpar o histórico desta conexão (RN-HIST-006) */}
      {connectionId && scope === "connection" && (
        <div className="border-t border-border bg-panel px-3 py-2">
          {!confirmingClear ? (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="cursor-pointer text-[11px] text-muted underline-offset-2 hover:text-danger hover:underline"
            >
              {historyCopy.clearConnectionTrigger}
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="font-medium text-ink">
                {historyCopy.clearConnectionConfirmTitle(
                  connectionName ?? connectionId
                )}
              </div>
              <div className="text-[11px] text-muted">
                {historyCopy.clearConnectionConfirmNote}
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingClear(false)}
                  className="h-6 px-2 text-xs"
                >
                  {historyCopy.clearConnectionCancelButton}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => hideConnectionMutation.mutate(connectionId)}
                  className="h-6 px-2 text-xs"
                >
                  {historyCopy.clearConnectionConfirmButton}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
