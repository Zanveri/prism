import { Button, CloseIcon, Input, PlusIcon, Select } from "@/components/ui";
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
      className="flex flex-col gap-1.5 border-t border-border pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-indices" className="m-0 text-[13px] font-semibold">
          Índices
        </h2>
        <span className="text-xs text-subtle">{countLabel}</span>
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={handleAdd}
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
        >
          <PlusIcon />
          <span>Novo índice</span>
        </Button>
      </div>

      {table.indexes.map((ix, idx) => {
        const isNewInExisting =
          changes?.addedIndexes.some((a) => a.name === ix.name) ?? false;
        const availableCols = table.columns
          .map((c) => c.name)
          .filter((name) => !ix.columns.includes(name));

        return (
          <div
            key={idx}
            className={`grid grid-cols-[minmax(0,1fr)_26px_28px] items-center gap-x-2 gap-y-1.5 rounded-md border bg-raised px-2.5 py-2 ${
              isNewInExisting ? "border-success" : "border-border"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Input
                type="text"
                value={ix.name}
                aria-label={`Nome do índice ${idx + 1}`}
                onChange={(e) =>
                  onUpdateIndex(idx, { ...ix, name: e.target.value })
                }
                className="h-7 min-w-0 flex-1 rounded border-border bg-background px-2 font-mono text-xs"
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
                  ? "border-subtle bg-selected text-ink"
                  : "border-border bg-transparent text-subtle"
              }`}
            >
              UQ
            </button>

            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-label={`Remover o índice ${ix.name}`}
              onClick={() => onRemoveIndex(idx)}
              className="h-7 w-7 p-0"
            >
              <CloseIcon />
            </Button>

            <div className="col-span-full flex flex-wrap items-center gap-1.5">
              {ix.columns.map((col) => (
                <span
                  key={col}
                  className="inline-flex h-6 items-center gap-1.5 rounded border border-border-strong pr-1 pl-2 font-mono text-xs"
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
                    className="flex h-[18px] w-[18px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted hover:text-ink"
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}

              {availableCols.length > 0 ? (
                <Select
                  aria-label="Adicionar coluna ao índice"
                  value=""
                  placeholder="+ coluna"
                  onChange={(selected) => {
                    if (selected) {
                      onUpdateIndex(idx, {
                        ...ix,
                        columns: [...ix.columns, selected],
                      });
                    }
                  }}
                  options={availableCols.map((col) => ({
                    value: col,
                    label: col,
                  }))}
                  wideList
                  className="h-6 min-h-6 border-dashed bg-transparent px-2 py-0 font-mono text-xs"
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
