import { useState } from "react";
import { Button, CodeIcon, Dialog, InfoIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { generateChangesDdl } from "../_lib/ddl-changes";
import { generateFullDdl } from "../_lib/ddl-full";

export type ScopeDialogProps = {
  model: BuildModel;
  modelName: string;
  baseLabel: string;
  onCancel: () => void;
  onConfirm: (scope: "changes" | "full") => void;
};

function summarizeDdlCommands(sql: string): string {
  const createTables = (sql.match(/^CREATE TABLE\b/gm) ?? []).length;
  const alterTables = (sql.match(/^ALTER TABLE\b/gm) ?? []).length;
  const createIndexes = (sql.match(/^CREATE(?: UNIQUE)? INDEX\b/gm) ?? []).length;
  const parts: string[] = [];
  if (createTables > 0) parts.push(`${createTables} CREATE TABLE`);
  if (alterTables > 0) parts.push(`${alterTables} ALTER TABLE`);
  if (createIndexes > 0) parts.push(`${createIndexes} CREATE INDEX`);
  return parts.length > 0 ? parts.join(" · ") : "0 comandos";
}

export function ScopeDialog({
  model,
  modelName,
  baseLabel,
  onCancel,
  onConfirm,
}: ScopeDialogProps) {
  const [scope, setScope] = useState<"changes" | "full">(
    model.ddl.scope ?? "changes",
  );

  const context = {
    modelName,
    prismVersion: "0.6.0",
    generatedAt: "",
    baseLabel,
  };
  const changesDdl = generateChangesDdl(model, context);
  const fullDdl = generateFullDdl(model, context);

  const changesSummary = summarizeDdlCommands(changesDdl.text);
  const fullSummary = summarizeDdlCommands(fullDdl.text);

  return (
    <Dialog
      open={true}
      title={buildCopy.scopeDialogTitle}
      icon={<CodeIcon />}
      size="md"
      describedBy="escopo-texto"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {buildCopy.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onConfirm(scope)}
          >
            {buildCopy.toolbarGenerateDdl}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p id="escopo-texto" className="m-0 text-muted">
          {buildCopy.scopeDialogIntro(modelName, baseLabel)}
        </p>

        <div
          role="radiogroup"
          aria-label={buildCopy.scopeDialogTitle}
          className="flex flex-col gap-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={scope === "changes"}
            onClick={() => setScope("changes")}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 text-left text-ink transition-colors",
              scope === "changes"
                ? "border-accent bg-selected"
                : "border-border-strong bg-transparent hover:bg-selected",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border",
                scope === "changes" ? "border-accent" : "border-border-strong",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  scope === "changes" ? "bg-accent" : "bg-transparent",
                )}
              />
            </span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="font-semibold">{buildCopy.scopeChangesLabel}</span>
              <span className="text-xs text-muted">
                {buildCopy.scopeChangesDescription(baseLabel)}
              </span>
              <span className="font-mono text-xs text-ink">{changesSummary}</span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={scope === "full"}
            onClick={() => setScope("full")}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 text-left text-ink transition-colors",
              scope === "full"
                ? "border-accent bg-selected"
                : "border-border-strong bg-transparent hover:bg-selected",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border",
                scope === "full" ? "border-accent" : "border-border-strong",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  scope === "full" ? "bg-accent" : "bg-transparent",
                )}
              />
            </span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="font-semibold">{buildCopy.scopeFullLabel}</span>
              <span className="text-xs text-muted">
                {buildCopy.scopeFullDescription(baseLabel)}
              </span>
              <span className="font-mono text-xs text-ink">{fullSummary}</span>
            </span>
          </button>
        </div>

        <p className="m-0 flex items-center gap-2 text-xs text-muted">
          <InfoIcon />
          <span>{buildCopy.scopeSavedNotice}</span>
        </p>
      </div>
    </Dialog>
  );
}
