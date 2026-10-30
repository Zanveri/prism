import { useEffect } from "react";

import { HighlightedSql } from "@/app/workbench/_components/highlighted-sql";
import { CloseIcon, EnvironmentPill, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { auditCopy } from "../_lib/audit.copy";
import type { AuditEntry, AuditLevelCode, AuditOutcomeCode } from "../_lib/audit.service";

const copy = auditCopy;

const levelBadgeStyles: Record<AuditLevelCode, string> = {
  info: "bg-level-info/15 text-level-info",
  warning: "bg-level-warn/15 text-level-warn",
  high: "bg-level-high/15 text-level-high",
  critical: "bg-level-critical/15 text-level-critical",
};

export function AuditLevelBadge({ level }: { level: AuditLevelCode }) {
  const meta = copy.levels[level];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded px-2 text-xs font-semibold whitespace-nowrap",
        levelBadgeStyles[level],
      )}
    >
      <span aria-hidden="true">{meta.mark}</span>
      <span>{meta.label}</span>
    </span>
  );
}

export function formatAuditDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs === undefined) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export function formatAuditDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatAuditTimeOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function outcomeToneClass(outcome: AuditOutcomeCode): string {
  switch (outcome) {
    case "ok":
      return "text-success";
    case "error":
      return "text-danger";
    case "refused":
      return "text-accent";
    default:
      return "text-muted";
  }
}

export type AuditDetailProps = {
  entry: AuditEntry;
  connectionDeleted?: boolean;
  onClose: () => void;
  onOpenInEditor: (entry: AuditEntry) => void;
  onFilterByScriptRun: (scriptRunId: string) => void;
};

export function AuditDetail({
  entry,
  connectionDeleted = false,
  onClose,
  onOpenInEditor,
  onFilterByScriptRun,
}: AuditDetailProps) {
  const toast = useToast();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const sqlText = entry.historyText ?? entry.sql ?? null;
  const originLabel =
    entry.origin && entry.origin in copy.origins
      ? copy.origins[entry.origin as keyof typeof copy.origins]
      : entry.origin;

  const whenText = entry.endedAt
    ? `${formatAuditDateTime(entry.startedAt)} → ${formatAuditTimeOnly(entry.endedAt)} (${formatAuditDuration(entry.durationMs)})`
    : `${formatAuditDateTime(entry.startedAt)} (${formatAuditDuration(entry.durationMs)})`;

  const connectionParts = [
    entry.connectionName
      ? `${entry.connectionName}${connectionDeleted ? ` ${copy.filters.deletedConnectionSuffix}` : ""}`
      : null,
    entry.engine ?? null,
    entry.database ?? null,
  ].filter(Boolean);

  async function handleCopy() {
    if (!sqlText) return;
    try {
      await navigator.clipboard.writeText(sqlText);
      toast.success(copy.detail.copied);
    } catch {
      // Sem permissão de área de transferência no ambiente de teste
    }
  }

  return (
    <aside
      aria-label={copy.detail.ariaLabel}
      className="flex w-full max-w-[420px] min-w-[320px] flex-1 flex-col gap-3.5 overflow-y-auto border-l border-border bg-panel px-5 py-4"
    >
      <div className="flex items-center gap-2">
        <AuditLevelBadge level={entry.level} />
        <span className="text-xs text-subtle">{copy.detail.numberLabel(entry.id)}</span>
        <button
          type="button"
          aria-label={copy.detail.closeLabel}
          onClick={onClose}
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-selected hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      <div>
        <h3 className="m-0 text-[15px] leading-[22px] font-semibold text-ink">
          {entry.action}
          {entry.summary ? ` · ${entry.summary}` : ""}
        </h3>
        {entry.reason ? <p className="mt-0.5 text-xs text-muted">{entry.reason}</p> : null}
      </div>

      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-xs">
        <dt className="text-subtle">{copy.detail.when}</dt>
        <dd className="m-0 font-mono text-body">{whenText}</dd>

        {connectionParts.length > 0 ? (
          <>
            <dt className="text-subtle">{copy.detail.connection}</dt>
            <dd className="m-0 text-ink">{connectionParts.join(" · ")}</dd>
          </>
        ) : null}

        {entry.folderPath ? (
          <>
            <dt className="text-subtle">{copy.detail.folder}</dt>
            <dd className="m-0 text-ink">{entry.folderPath}</dd>
          </>
        ) : null}

        {entry.environmentName ? (
          <>
            <dt className="text-subtle">{copy.detail.environment}</dt>
            <dd className="m-0 flex items-center gap-1.5">
              <EnvironmentPill
                name={entry.environmentName}
                color={entry.environmentColor?.startsWith("#") ? entry.environmentColor : null}
              />
            </dd>
          </>
        ) : null}

        {originLabel ? (
          <>
            <dt className="text-subtle">{copy.detail.origin}</dt>
            <dd className="m-0 text-ink">{originLabel}</dd>
          </>
        ) : null}

        {entry.protections ? (
          <>
            <dt className="text-subtle">{copy.detail.protections}</dt>
            <dd className="m-0 text-ink">{entry.protections}</dd>
          </>
        ) : null}

        <dt className="text-subtle">{copy.detail.confirmation}</dt>
        <dd className={cn("m-0", entry.confirmed ? "text-accent" : "text-muted")}>
          {entry.confirmed ? copy.detail.confirmedYes : copy.detail.confirmedNo}
        </dd>

        <dt className="text-subtle">{copy.detail.outcome}</dt>
        <dd className={cn("m-0 font-medium", outcomeToneClass(entry.outcome))}>
          {copy.outcomes[entry.outcome]}
        </dd>

        {entry.scriptRunId ? (
          <>
            <dt className="text-subtle">{copy.detail.script}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onFilterByScriptRun(entry.scriptRunId!)}
                className="text-xs font-medium text-link underline-offset-2 hover:underline"
              >
                {copy.detail.filterByScript}
              </button>
            </dd>
          </>
        ) : null}

        {entry.errorCode || entry.sqlState || entry.errorMessage ? (
          <>
            <dt className="text-subtle">{copy.detail.error}</dt>
            <dd className="m-0 flex flex-col gap-1 text-danger">
              {entry.errorCode || entry.sqlState ? (
                <span className="font-mono text-[11px]">
                  {[entry.errorCode, entry.sqlState].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {entry.errorMessage ? (
                <pre className="m-0 max-h-36 overflow-auto rounded border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-danger">
                  {entry.errorMessage}
                </pre>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>

      {sqlText ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-subtle">{copy.detail.sqlSent}</span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="ml-auto h-7 rounded-md border border-border-strong px-2.5 text-xs text-ink transition-colors hover:bg-selected"
            >
              {copy.detail.copy}
            </button>
            <button
              type="button"
              onClick={() => onOpenInEditor(entry)}
              className="h-7 rounded-md border border-border-strong px-2.5 text-xs text-ink transition-colors hover:bg-selected"
            >
              {copy.detail.openInEditor}
            </button>
          </div>
          <pre className="m-0 max-h-60 overflow-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-xs leading-[18px] whitespace-pre-wrap text-body">
            <HighlightedSql text={sqlText} />
          </pre>
        </div>
      ) : null}
    </aside>
  );
}
