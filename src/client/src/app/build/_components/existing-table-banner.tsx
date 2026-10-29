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
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-muted"
        >
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
          <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </svg>
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
          <button
            type="button"
            onClick={onRevertTable}
            className="h-7 cursor-pointer rounded-md border border-border-strong bg-transparent px-2.5 text-xs text-ink"
          >
            Desfazer as mudanças desta tabela
          </button>
        </div>
      ) : null}
    </div>
  );
}
