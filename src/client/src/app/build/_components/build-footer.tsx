import type { BuildModel } from "@/app/build/_lib/build-model.schema";
import { buildCopy } from "@/app/build/_lib/build.copy";
import { connectionEngineNumber } from "@/app/build/_lib/catalog-tree";
import type { Problem } from "@/app/build/_lib/model-check";
import { footerCountsLabel } from "@/app/build/_lib/model-summary";
import { EngineTag, LockOpenIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

type BuildFooterProps = {
  userName: string;
  savedModelsCount: number;
  model: BuildModel | null;
  modelName?: string | null;
  connectionName: (id: string) => string | null;
  problems?: readonly Problem[];
  onOpenDdlView?: () => void;
};

export function BuildFooter({
  userName,
  savedModelsCount,
  model,
  modelName,
  connectionName,
  problems = [],
  onOpenDdlView,
}: BuildFooterProps) {
  if (!model) {
    return (
      <footer className="flex min-h-7 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-panel px-3 py-1 text-xs leading-[18px] text-muted">
        <span>{buildCopy.footerSavedModelsCount(savedModelsCount)}</span>
        {userName !== "" && (
          <span className="ml-auto flex items-center gap-1.5">
            <LockOpenIcon />
            <span>{buildCopy.footerVaultOpen(userName)}</span>
          </span>
        )}
      </footer>
    );
  }

  const baseConn = model.base ? (connectionName(model.base.connectionId) ?? model.base.connectionId) : null;
  const errorCount = problems.filter((p) => p.severity === "error").length;
  const warningCount = problems.filter((p) => p.severity === "warning").length;

  return (
    <footer className="flex min-h-7 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-panel px-3 py-1 text-xs leading-[18px] text-muted">
      <span className="flex items-center gap-1.5">
        <EngineTag engine={connectionEngineNumber(model.engine)} />
        <span>
          Modelo {modelName ?? ""}
          {model.base && baseConn
            ? ` · existentes lidas de ${baseConn} / ${model.base.database} em ${model.base.readAt}`
            : ""}
        </span>
      </span>

      <span>{footerCountsLabel(model)}</span>

      {(errorCount > 0 || warningCount > 0) && (
        <button
          type="button"
          onClick={onOpenDdlView}
          className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-ink hover:underline"
        >
          <span
            className={cn(
              "h-2 w-2 flex-none rounded-full",
              errorCount > 0 ? "bg-danger" : "bg-accent",
            )}
          />
          <span>
            {errorCount > 0
              ? `${errorCount} ${errorCount === 1 ? "erro" : "erros"}`
              : `${warningCount} ${warningCount === 1 ? "aviso" : "avisos"}`}
          </span>
        </button>
      )}

      {userName !== "" && (
        <span className="ml-auto flex items-center gap-1.5">
          <LockOpenIcon />
          <span>{buildCopy.footerVaultOpen(userName)}</span>
        </span>
      )}
    </footer>
  );
}
