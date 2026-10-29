import type { TableChanges } from "../_lib/build-model";
import type { ModelIndex, ModelTable } from "../_lib/build-model.schema";

export type IndexesSectionProps = {
  table: ModelTable;
  changes: TableChanges | null;
  onAddIndex: (columns: string[]) => void;
  onUpdateIndex: (index: number, value: ModelIndex) => void;
  onRemoveIndex: (index: number) => void;
};

export function IndexesSection({
  table,
  changes,
  onAddIndex,
  onUpdateIndex,
  onRemoveIndex,
}: IndexesSectionProps) {
  const newIndexesCount = changes?.addedIndexes.length ?? 0;
  const countLabel =
    newIndexesCount > 0
      ? `${table.indexes.length} · ${newIndexesCount} ${newIndexesCount === 1 ? "novo" : "novos"}`
      : `${table.indexes.length}`;

  const handleAdd = () => {
    const firstNonPk =
      table.columns.find((c) => !table.primaryKey?.columns.includes(c.name))
        ?.name ??
      table.columns[0]?.name ??
      "id";
    onAddIndex([firstNonPk]);
  };

  return (
    <section
      aria-labelledby="h-indices"
      className="flex flex-col gap-1.5 border-t border-line pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-indices" className="m-0 text-[13px] font-semibold">
          Índices
        </h2>
        <span className="text-xs text-ink-faint">{countLabel}</span>
        <button
          type="button"
          onClick={handleAdd}
          className="ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-transparent px-2.5 text-xs text-ink"
        >
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
            className="shrink-0"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
          <span>Novo índice</span>
        </button>
      </div>

      {table.indexes.map((ix, idx) => {
        const isNewInExisting =
          changes?.addedIndexes.some((a) => a.name === ix.name) ?? false;
        const availableCols = table.columns
          .map((c) => c.name)
          .filter((name) => !ix.columns.includes(name));

        return (
          <div
            key={`${ix.name}-${idx}`}
            className={`grid grid-cols-[minmax(0,1fr)_26px_28px] items-center gap-x-2 gap-y-1.5 rounded-md border bg-surface-raised px-2.5 py-2 ${
              isNewInExisting ? "border-success" : "border-line"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <input
                type="text"
                value={ix.name}
                aria-label={`Nome do índice ${idx + 1}`}
                onChange={(e) =>
                  onUpdateIndex(idx, { ...ix, name: e.target.value })
                }
                className="box-border h-7 min-w-0 flex-1 rounded border border-line bg-canvas px-2 font-mono text-xs text-ink"
              />
              {isNewInExisting ? (
                <span className="font-mono text-[10px] font-semibold text-success">
                  NOVO
                </span>
              ) : null}
            </div>

            <button
              type="button"
              aria-pressed={ix.unique}
              aria-label="Índice único"
              onClick={() => onUpdateIndex(idx, { ...ix, unique: !ix.unique })}
              className={`h-6 cursor-pointer rounded border p-0 font-mono text-[10px] font-semibold ${
                ix.unique
                  ? "border-ink-faint bg-surface-hover text-ink"
                  : "border-line bg-transparent text-ink-faint"
              }`}
            >
              UQ
            </button>

            <button
              type="button"
              aria-label={`Remover o índice ${ix.name}`}
              onClick={() => onRemoveIndex(idx)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-ink-muted"
            >
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
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>

            <div className="col-span-full flex flex-wrap items-center gap-1.5">
              {ix.columns.map((col) => (
                <span
                  key={col}
                  className="inline-flex h-6 items-center gap-1.5 rounded border border-line-strong pr-1 pl-2 font-mono text-xs"
                >
                  {col}
                  <button
                    type="button"
                    aria-label={`Tirar ${col} do índice`}
                    onClick={() => {
                      const nextCols = ix.columns.filter((c) => c !== col);
                      if (nextCols.length === 0) {
                        onRemoveIndex(idx);
                      } else {
                        onUpdateIndex(idx, { ...ix, columns: nextCols });
                      }
                    }}
                    className="flex h-[18px] w-[18px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-ink-muted"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </span>
              ))}

              {availableCols.length > 0 ? (
                <select
                  aria-label="Adicionar coluna ao índice"
                  value=""
                  onChange={(e) => {
                    const selected = e.target.value;
                    if (selected) {
                      onUpdateIndex(idx, {
                        ...ix,
                        columns: [...ix.columns, selected],
                      });
                    }
                  }}
                  className="h-6 rounded border border-dashed border-line-strong bg-transparent px-1.5 text-xs text-ink-muted"
                >
                  <option value="">+ coluna</option>
                  {availableCols.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
