import { Button, DatabaseIcon } from "@/components/ui";
import type { TableChanges } from "../_lib/build-model";
import { buildCopy } from "../_lib/build.copy";

export type ExistingTableBannerProps = {
  baseLabel: string;
  changes: TableChanges;
  onRevertTable: () => void;
};

export function ExistingTableBanner({
  baseLabel,
  changes,
  onRevertTable,
}: ExistingTableBannerProps) {
  const isChanged = changes.kind === "changed";
  const isDropped = changes.kind === "dropped";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-subtle px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-muted">
          <DatabaseIcon />
        </span>
        <span className="font-semibold">Existe em {baseLabel}</span>
        {isChanged ? (
          <span className="inline-flex h-4 items-center rounded border border-accent px-1.5 text-[10px] font-semibold leading-[14px] text-accent">
            {buildCopy.changedTableBadge}
          </span>
        ) : null}
        {isDropped ? (
          <span className="inline-flex h-4 items-center rounded border border-danger px-1.5 text-[10px] font-semibold leading-[14px] text-danger">
            {buildCopy.droppedTableBadge}
          </span>
        ) : null}
      </div>
      <p className="m-0 text-xs leading-[18px] text-muted">
        O que você mudar aqui vira ALTER no DDL de diferenças. A tabela não muda de esquema.
      </p>
      {isChanged || isDropped ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            onClick={onRevertTable}
            className="h-7 px-2.5 text-xs"
          >
            Desfazer as mudanças desta tabela
          </Button>
        </div>
      ) : null}
    </div>
  );
}
