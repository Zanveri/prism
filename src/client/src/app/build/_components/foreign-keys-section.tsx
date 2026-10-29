import { sameName } from "../_lib/build-engines";
import type {
  BuildModel,
  FkAction,
  ModelForeignKey,
  ModelTable,
} from "../_lib/build-model.schema";
import { fkActionOptions } from "../_lib/editor-rows";

const deleteActionLabels: Record<FkAction, string> = {
  noAction: "Ao excluir: impedir",
  restrict: "Ao excluir: restringir",
  cascade: "Ao excluir: cascata",
  setNull: "Ao excluir: anular",
  setDefault: "Ao excluir: valor padrão",
};

export type ForeignKeysSectionProps = {
  model: BuildModel;
  table: ModelTable;
  onAddForeignKey: (fk: ModelForeignKey) => void;
  onUpdateForeignKey: (index: number, fk: ModelForeignKey) => void;
  onRemoveForeignKey: (index: number) => void;
};

export function ForeignKeysSection({
  model,
  table,
  onAddForeignKey,
  onUpdateForeignKey,
  onRemoveForeignKey,
}: ForeignKeysSectionProps) {
  const options = fkActionOptions(model.engine).onDelete;

  const handleAdd = () => {
    const candidateTarget =
      model.tables.find(
        (t) =>
          (t.schema !== table.schema || t.name !== table.name) &&
          t.primaryKey &&
          t.primaryKey.columns.length > 0,
      ) ?? model.tables[0];
    const sourceCol = table.columns[0]?.name ?? "id";
    const targetSchema = candidateTarget?.schema ?? table.schema;
    const targetTable = candidateTarget?.name ?? table.name;
    const targetCols = candidateTarget?.primaryKey?.columns ?? ["id"];

    onAddForeignKey({
      name: null,
      columns: [sourceCol],
      target: {
        schema: targetSchema,
        table: targetTable,
        columns: [...targetCols],
      },
      onDelete: "noAction",
      onUpdate: "noAction",
    });
  };

  return (
    <section
      aria-labelledby="h-fks"
      className="flex flex-col gap-1.5 border-t border-line pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-fks" className="m-0 text-[13px] font-semibold">
          Chaves estrangeiras
        </h2>
        <span className="text-xs text-ink-faint">{table.foreignKeys.length}</span>
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
          <span>Nova FK</span>
        </button>
      </div>

      {table.foreignKeys.map((fk, idx) => {
        const colsLabel = fk.columns.join(", ");
        const sameSchema = sameName(
          model.engine,
          { name: fk.target.schema, exactName: false },
          { name: table.schema, exactName: false },
        );
        const targetDisplay = sameSchema
          ? fk.target.table
          : `${fk.target.schema}.${fk.target.table}`;
        const targetInModel = model.tables.some(
          (t) =>
            sameName(
              model.engine,
              { name: t.schema, exactName: false },
              { name: fk.target.schema, exactName: false },
            ) &&
            sameName(
              model.engine,
              { name: t.name, exactName: t.exactName },
              { name: fk.target.table, exactName: false },
            ),
        );

        return (
          <div
            key={`${colsLabel}-${idx}`}
            className="grid grid-cols-[minmax(0,1fr)_128px_28px] items-center gap-x-2 gap-y-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-2 font-mono text-xs"
          >
            <span className="min-w-0 truncate">
              {colsLabel} <span className="text-accent">→</span> {targetDisplay}
              <span className="text-ink-faint">
                {" "}
                ({fk.target.columns.join(", ")})
              </span>
            </span>

            <select
              aria-label={`Ao excluir em ${colsLabel}`}
              value={fk.onDelete}
              onChange={(e) =>
                onUpdateForeignKey(idx, {
                  ...fk,
                  onDelete: e.target.value as FkAction,
                })
              }
              className="h-7 rounded border border-line bg-canvas px-1.5 font-sans text-xs text-ink"
            >
              {options.map((action) => (
                <option key={action} value={action}>
                  {deleteActionLabels[action]}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label={`Remover a FK de ${colsLabel}`}
              onClick={() => onRemoveForeignKey(idx)}
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

            {!targetInModel ? (
              <span className="col-span-full font-sans text-xs leading-[18px] text-ink-muted">
                {fk.target.schema}.{fk.target.table} não está no modelo; a FK
                continua como está no banco.
              </span>
            ) : null}
          </div>
        );
      })}

      {!table.origin ? (
        <p className="m-0 text-xs leading-[18px] text-ink-muted">
          Ou arraste uma coluna até a tabela de destino no diagrama. A FK pode
          apontar para uma tabela existente.
        </p>
      ) : null}
    </section>
  );
}
