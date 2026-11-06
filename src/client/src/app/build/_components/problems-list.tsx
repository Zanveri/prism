import { AlertIcon, Button, InfoIcon, RefreshIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { buildCopy } from "../_lib/build.copy";
import { fixButtonLabel, type Problem, type ProblemFix } from "../_lib/model-check";
import { buildUiCopy } from "../_lib/build-ui.copy";

export type ProblemsListProps = {
  problems: readonly Problem[];
  lineOf?: Record<string, number>;
  onApplyFix?: (fix: ProblemFix) => void;
  onIgnoreWarning?: (key: string) => void;
  onGoToColumn?: (table: string, column: string | null) => void;
  onReread?: () => void;
};

function problemTitle(problem: Problem): string {
  const titles: Record<string, string> = buildUiCopy.problemTitles;
  return titles[problem.code] ?? buildUiCopy.problemFallbackTitle(problem.code);
}

export function formatProblemsSummary(problems: readonly Problem[]): string {
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const warningsText =
    warnings === 0
      ? buildUiCopy.summary.noWarnings
      : buildUiCopy.summary.warningCount(warnings);
  const errorsText =
    errors === 0
      ? buildUiCopy.summary.noErrors
      : buildUiCopy.summary.errorCount(errors);
  return `${warningsText} · ${errorsText}`;
}

export function ProblemsList({
  problems,
  lineOf = {},
  onApplyFix,
  onIgnoreWarning,
  onGoToColumn,
  onReread,
}: ProblemsListProps) {
  const summary = formatProblemsSummary(problems);

  return (
    <aside
      aria-labelledby="problemas-titulo"
      className="flex min-h-0 min-w-0 flex-1 basis-[340px] flex-col gap-2.5 overflow-x-hidden overflow-y-auto border-l border-border bg-panel p-4"
    >
      <div className="flex items-center gap-2">
        <h2 id="problemas-titulo" className="m-0 text-sm font-semibold text-ink">
          {buildCopy.ddlProblemsTitle}
        </h2>
        <span className="text-xs text-muted">{summary}</span>
      </div>

      <p className="m-0 text-xs text-muted">{buildCopy.ddlProblemsExplain}</p>

      {problems.map((problem) => {
        const line =
          (problem.table && problem.column
            ? lineOf[`${problem.table}.${problem.column}`]
            : null) ?? (problem.table ? lineOf[problem.table] : null);
        const isError = problem.severity === "error";
        const isWarning = problem.severity === "warning";

        return (
          <section
            key={problem.key}
            aria-label={problemTitle(problem)}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-md border p-3",
              isError
                ? "border-danger bg-raised"
                : isWarning
                  ? "border-border bg-raised"
                  : "border-border bg-transparent",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "flex-none",
                  isError
                    ? "text-danger"
                    : isWarning
                      ? "text-accent"
                      : "text-muted",
                )}
              >
                {problem.code === "I2" ? (
                  <RefreshIcon />
                ) : isError || isWarning ? (
                  <AlertIcon />
                ) : (
                  <InfoIcon />
                )}
              </span>
              <span className="min-w-0 break-words font-semibold text-ink">
                {problemTitle(problem)}
              </span>
              {line !== undefined && line !== null && (
                <span className="ml-auto flex-none text-xs text-muted">
                  {buildUiCopy.problemLine(line)}
                </span>
              )}
            </div>

            <p className="m-0 min-w-0 break-words [overflow-wrap:anywhere] text-xs leading-relaxed text-ink">
              {problem.message}
            </p>

            {(problem.fix || isWarning || problem.column) && (
              <div className="flex flex-wrap gap-1.5">
                {problem.fix && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    onClick={() => {
                      if (problem.fix?.kind === "reread") {
                        onReread?.();
                      } else if (problem.fix) {
                        onApplyFix?.(problem.fix);
                      }
                    }}
                    className="h-7 border-0 bg-selected px-2.5 text-xs"
                  >
                    {fixButtonLabel(problem.fix)}
                  </Button>
                )}

                {problem.table && problem.column && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    onClick={() => onGoToColumn?.(problem.table!, problem.column)}
                    className="h-7 px-2.5 text-xs"
                  >
                    {buildCopy.ddlGoToColumn}
                  </Button>
                )}

                {isWarning && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    onClick={() => onIgnoreWarning?.(problem.key)}
                    className="h-7 px-2.5 text-xs text-muted hover:text-ink"
                  >
                    {buildCopy.ddlIgnoreWarning}
                  </Button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}
