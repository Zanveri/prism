import {
  Button,
  ChevronIcon,
  DownloadIcon,
  DuplicateIcon,
  EngineTag,
  WorkbenchIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { ignoreWarning } from "../_lib/build-model";
import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { connectionEngineNumber } from "../_lib/catalog-tree";
import { generateDdl } from "../_lib/ddl-changes";
import {
  applyFix,
  checkModel,
  type ProblemFix,
} from "../_lib/model-check";
import { ProblemsList } from "./problems-list";

export type DdlViewProps = {
  model: BuildModel;
  modelName: string;
  baseLabel?: string | null;
  baseEnvironment?: string | null;
  prismVersion?: string;
  generatedAt?: string;
  notes?: { code: "W8" | "W13"; message: string }[];
  onBackToDiagram: () => void;
  onChangeModel: (next: BuildModel) => void;
  onCopy?: (sql: string) => void;
  onSaveSql?: (sql: string) => void;
  onOpenInWorkbench?: (sql: string) => void;
  onGoToColumn?: (table: string, column: string | null) => void;
  onReread?: () => void;
};

export function DdlView({
  model,
  modelName,
  baseLabel = null,
  baseEnvironment = null,
  prismVersion = "0.6.0",
  generatedAt = "29/10/2026 14:32",
  notes = [],
  onBackToDiagram,
  onChangeModel,
  onCopy,
  onSaveSql,
  onOpenInWorkbench,
  onGoToColumn,
  onReread,
}: DdlViewProps) {
  const effectiveScope: "changes" | "full" =
    model.base !== null ? (model.ddl.scope ?? "changes") : "full";
  const resolvedBaseLabel =
    baseLabel ??
    (model.base
      ? `${model.base.connectionId} / ${model.base.database ?? ""}`
      : null);

  const ddlModel: BuildModel =
    model.ddl.scope === effectiveScope
      ? model
      : { ...model, ddl: { ...model.ddl, scope: effectiveScope } };

  const ddl = generateDdl(ddlModel, {
    modelName,
    prismVersion,
    generatedAt,
    baseLabel: resolvedBaseLabel,
  });

  const problems = checkModel(ddlModel, {
    scope: effectiveScope,
    baseLabel: resolvedBaseLabel,
    baseEnvironment,
    notes,
  });

  const firstError = problems.find((p) => p.severity === "error") ?? null;
  const nothingChanged =
    model.base !== null &&
    effectiveScope === "changes" &&
    ddl.statements === 0;

  const actionsDisabled = firstError !== null || nothingChanged;
  const disabledReason = firstError
    ? firstError.message
    : nothingChanged
      ? buildCopy.ddlNothingChanged(resolvedBaseLabel ?? "a base")
      : null;

  const lines = ddl.text.split("\n");
  const summaryText = `${ddl.statements} ${ddl.statements === 1 ? "comando" : "comandos"} · ${lines.length} ${lines.length === 1 ? "linha" : "linhas"}`;

  const setScope = (nextScope: "changes" | "full") => {
    onChangeModel({
      ...model,
      ddl: {
        ...model.ddl,
        scope: nextScope,
      },
    });
  };

  const toggleSchemaCreate = (schemaName: string, checked: boolean) => {
    onChangeModel({
      ...model,
      schemas: model.schemas.map((s) =>
        s.name === schemaName ? { ...s, create: checked } : s,
      ),
    });
  };

  const updateDdlOption = <K extends keyof BuildModel["ddl"]>(
    key: K,
    value: BuildModel["ddl"][K],
  ) => {
    onChangeModel({
      ...model,
      ddl: {
        ...model.ddl,
        [key]: value,
      },
    });
  };

  const handleApplyFix = (fix: ProblemFix) => {
    onChangeModel(applyFix(model, fix));
  };

  const handleIgnoreWarning = (key: string) => {
    onChangeModel(ignoreWarning(model, key));
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-ink">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={onBackToDiagram}
          className="gap-1.5 px-2 text-ink"
        >
          <ChevronIcon direction="left" />
          <span>{buildCopy.ddlBackToDiagram}</span>
        </Button>

        <h1 className="m-0 mx-1 text-sm font-semibold">
          {buildCopy.ddlTitlePrefix}{" "}
          <span className="font-mono">{modelName}</span>
        </h1>

        <EngineTag engine={connectionEngineNumber(model.engine)} />

        {model.base !== null && (
          <div
            role="radiogroup"
            aria-label={buildCopy.ddlScopeGroupLabel}
            className="ml-2 flex gap-0.5 rounded-md border border-border bg-background p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={effectiveScope === "changes"}
              onClick={() => setScope("changes")}
              className={cn(
                "h-6.5 cursor-pointer rounded-sm border-0 px-2.5 text-xs",
                effectiveScope === "changes"
                  ? "bg-selected font-semibold text-ink"
                  : "bg-transparent font-normal text-muted hover:text-ink",
              )}
            >
              {buildCopy.scopeChangesLabel}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={effectiveScope === "full"}
              onClick={() => setScope("full")}
              className={cn(
                "h-6.5 cursor-pointer rounded-sm border-0 px-2.5 text-xs",
                effectiveScope === "full"
                  ? "bg-selected font-semibold text-ink"
                  : "bg-transparent font-normal text-muted hover:text-ink",
              )}
            >
              {buildCopy.scopeFullLabel}
            </button>
          </div>
        )}

        <span className="text-xs text-muted">{summaryText}</span>

        <Button
          type="button"
          variant="secondary"
          size="compact"
          disabled={actionsDisabled}
          title={disabledReason ?? undefined}
          onClick={() => onCopy?.(ddl.text)}
          className="ml-auto gap-1.5 px-3"
        >
          <DuplicateIcon />
          <span>{buildCopy.ddlCopyButton}</span>
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="compact"
          disabled={actionsDisabled}
          title={disabledReason ?? undefined}
          onClick={() => onSaveSql?.(ddl.text)}
          className="gap-1.5 px-3"
        >
          <DownloadIcon />
          <span>{buildCopy.ddlSaveSqlButton}</span>
        </Button>

        <Button
          type="button"
          variant="primary"
          size="compact"
          disabled={actionsDisabled}
          title={disabledReason ?? buildCopy.ddlOpenInWorkbenchHint}
          onClick={() => onOpenInWorkbench?.(ddl.text)}
          className="gap-2 px-3"
        >
          <WorkbenchIcon />
          <span>{buildCopy.ddlOpenInWorkbenchButton}</span>
        </Button>
      </div>

      <div
        role="group"
        aria-label={buildCopy.ddlOptionsGroupLabel}
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border bg-panel px-3 py-2 text-xs text-ink"
      >
        {model.engine !== "informix" && model.schemas.length > 0 && (
          <span className="flex items-center gap-2.5">
            <span className="font-mono text-muted">CREATE SCHEMA</span>
            {model.schemas.map((schema) => (
              <label
                key={schema.name}
                className="flex cursor-pointer items-center gap-1.5"
              >
                <input
                  type="checkbox"
                  checked={schema.create}
                  onChange={(e) =>
                    toggleSchemaCreate(schema.name, e.target.checked)
                  }
                  className="size-4 accent-accent"
                />
                <span className="font-mono">{schema.name}</span>
              </label>
            ))}
          </span>
        )}

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={model.ddl.constraintNames}
            onChange={(e) =>
              updateDdlOption("constraintNames", e.target.checked)
            }
            className="size-4 accent-accent"
          />
          <span>{buildCopy.ddlOptionConstraintNames}</span>
        </label>

        {model.engine !== "informix" && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={model.ddl.comments}
              onChange={(e) => updateDdlOption("comments", e.target.checked)}
              className="size-4 accent-accent"
            />
            <span>{buildCopy.ddlOptionComments}</span>
          </label>
        )}

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={model.ddl.foreignKeysAtEnd}
            onChange={(e) =>
              updateDdlOption("foreignKeysAtEnd", e.target.checked)
            }
            className="size-4 accent-accent"
          />
          <span>{buildCopy.ddlOptionFkAtEnd}</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={model.ddl.dropNewFirst}
            onChange={(e) => updateDdlOption("dropNewFirst", e.target.checked)}
            className="size-4 accent-accent"
          />
          <span>{buildCopy.ddlOptionDropNewFirst}</span>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          aria-label={buildCopy.ddlReadOnlyLabel}
          className="min-h-0 min-w-0 flex-[999_1_560px] overflow-auto bg-background py-3 pr-4 font-mono text-xs leading-5 whitespace-pre text-ink"
        >
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            return (
              <div key={lineNumber} className="flex gap-3">
                <span className="w-9 flex-none text-right text-subtle">
                  {lineNumber}
                </span>
                <span>{line}</span>
              </div>
            );
          })}
        </div>

        <ProblemsList
          problems={problems}
          lineOf={ddl.lineOf}
          onApplyFix={handleApplyFix}
          onIgnoreWarning={handleIgnoreWarning}
          onGoToColumn={onGoToColumn}
          onReread={onReread}
        />
      </div>
    </div>
  );
}
