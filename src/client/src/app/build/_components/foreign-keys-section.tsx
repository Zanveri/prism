import { Button, CloseIcon, PlusIcon, Select } from "@/components/ui";
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
      className="flex flex-col gap-1.5 border-t border-border pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-fks" className="m-0 text-[13px] font-semibold">
          Chaves estrangeiras
        </h2>
        <span className="text-xs text-subtle">{table.foreignKeys.length}</span>
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={handleAdd}
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
        >
          <PlusIcon />
          <span>Nova FK</span>
        </Button>
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
            className="grid grid-cols-[minmax(0,1fr)_164px_28px] items-center gap-x-2 gap-y-1.5 rounded-md border border-border bg-raised px-2.5 py-2 font-mono text-xs"
          >
            <span className="min-w-0 truncate">
              {colsLabel} <span className="text-accent">→</span> {targetDisplay}
              <span className="text-subtle">
                {" "}
                ({fk.target.columns.join(", ")})
              </span>
            </span>

            <Select
              aria-label={`Ao excluir em ${colsLabel}`}
              value={fk.onDelete}
              onChange={(nextAction) =>
                onUpdateForeignKey(idx, {
                  ...fk,
                  onDelete: nextAction as FkAction,
                })
              }
              options={options.map((action) => ({
                value: action,
                label: deleteActionLabels[action],
              }))}
              wideList
              className="min-h-7 bg-background px-2 py-1 font-sans text-xs"
            />

            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-label={`Remover a FK de ${colsLabel}`}
              onClick={() => onRemoveForeignKey(idx)}
              className="h-7 w-7 p-0"
            >
              <CloseIcon />
            </Button>

            {!targetInModel ? (
              <span className="col-span-full font-sans text-xs leading-[18px] text-muted">
                {fk.target.schema}.{fk.target.table} não está no modelo; a FK
                continua como está no banco.
              </span>
            ) : null}
          </div>
        );
      })}

      {!table.origin ? (
        <p className="m-0 text-xs leading-[18px] text-muted">
          Ou arraste uma coluna até a tabela de destino no diagrama. A FK pode
          apontar para uma tabela existente.
        </p>
      ) : null}
    </section>
  );
}
