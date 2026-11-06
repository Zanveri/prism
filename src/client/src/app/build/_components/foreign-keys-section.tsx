import { useState } from "react";
import {
  Button,
  CloseIcon,
  Dialog,
  Field,
  FieldLabel,
  PlusIcon,
  Select,
} from "@/components/ui";
import { sameName } from "../_lib/build-engines";
import { tableKey } from "../_lib/build-model";
import type {
  BuildModel,
  FkAction,
  ModelForeignKey,
  ModelTable,
} from "../_lib/build-model.schema";
import { fkActionOptions } from "../_lib/editor-rows";
import { buildCopy } from "../_lib/build.copy";
import { buildUiCopy } from "../_lib/build-ui.copy";

const deleteActionLabels: Record<FkAction, string> = buildUiCopy.foreignKeys.deleteActions;

export type ForeignKeysSectionProps = {
  model: BuildModel;
  table: ModelTable;
  onAddForeignKey: (fk: ModelForeignKey) => void;
  onUpdateForeignKey: (index: number, fk: ModelForeignKey) => void;
  onRemoveForeignKey: (index: number) => void;
  onFocusTableInDiagram?: (tableKey: string) => void;
};

type FkDraft = {
  editIndex: number | null;
  sourceColumn: string;
  targetTableKey: string;
  targetColumn: string;
  onDelete: FkAction;
};

export function ForeignKeysSection({
  model,
  table,
  onAddForeignKey,
  onUpdateForeignKey,
  onRemoveForeignKey,
  onFocusTableInDiagram,
}: ForeignKeysSectionProps) {
  const options = fkActionOptions(model.engine).onDelete;
  const [draft, setDraft] = useState<FkDraft | null>(null);

  const openNewDraft = () => {
    const candidateTarget =
      model.tables.find(
        (t) =>
          (t.schema !== table.schema || t.name !== table.name) &&
          t.primaryKey &&
          t.primaryKey.columns.length > 0,
      ) ??
      model.tables.find(
        (t) => t.schema !== table.schema || t.name !== table.name,
      ) ??
      model.tables[0];
    const sourceCol = table.columns[0]?.name ?? "id";
    const targetKey = candidateTarget ? tableKey(candidateTarget) : tableKey(table);
    const targetCol =
      candidateTarget?.primaryKey?.columns[0] ??
      candidateTarget?.columns[0]?.name ??
      "id";
    const defaultOnDelete: FkAction =
      model.engine === "informix" ? "noAction" : "restrict";

    setDraft({
      editIndex: null,
      sourceColumn: sourceCol,
      targetTableKey: targetKey,
      targetColumn: targetCol,
      onDelete: options.includes(defaultOnDelete) ? defaultOnDelete : (options[0] ?? "noAction"),
    });
  };

  const openEditDraft = (idx: number, fk: ModelForeignKey) => {
    const targetKey = `${fk.target.schema}.${fk.target.table}`;
    setDraft({
      editIndex: idx,
      sourceColumn: fk.columns[0] ?? table.columns[0]?.name ?? "id",
      targetTableKey: targetKey,
      targetColumn: fk.target.columns[0] ?? "id",
      onDelete: fk.onDelete,
    });
  };

  const submitDraft = () => {
    if (!draft) return;
    const targetTable =
      model.tables.find((t) => tableKey(t) === draft.targetTableKey) ?? table;
    const fk: ModelForeignKey = {
      name: draft.editIndex !== null ? (table.foreignKeys[draft.editIndex]?.name ?? null) : null,
      columns: [draft.sourceColumn],
      target: {
        schema: targetTable.schema,
        table: targetTable.name,
        columns: [draft.targetColumn],
      },
      onDelete: draft.onDelete,
      onUpdate: "noAction",
    };
    if (draft.editIndex !== null) {
      onUpdateForeignKey(draft.editIndex, fk);
    } else {
      onAddForeignKey(fk);
    }
    setDraft(null);
  };

  const draftTargetTable = draft
    ? (model.tables.find((t) => tableKey(t) === draft.targetTableKey) ?? null)
    : null;

  return (
    <section
      aria-labelledby="h-fks"
      className="flex flex-col gap-1.5 border-t border-border pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-fks" className="m-0 text-[13px] font-semibold">
          {buildUiCopy.foreignKeys.title}
        </h2>
        <span className="text-xs text-subtle">{table.foreignKeys.length}</span>
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={openNewDraft}
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
        >
          <PlusIcon />
          <span>{buildUiCopy.foreignKeys.add}</span>
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
            key={idx}
            className="grid grid-cols-[minmax(0,1fr)_164px_28px] items-center gap-x-2 gap-y-1.5 rounded-md border border-border bg-raised px-2.5 py-2 font-mono text-xs"
          >
            <button
              type="button"
              onClick={(e) => {
                if ((e.ctrlKey || e.metaKey) && onFocusTableInDiagram) {
                  e.preventDefault();
                  onFocusTableInDiagram(`${fk.target.schema}.${fk.target.table}`);
                  return;
                }
                openEditDraft(idx, fk);
              }}
              title={buildUiCopy.foreignKeys.editHint}
              className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-xs text-ink hover:underline"
            >
              {colsLabel} <span className="text-accent">→</span> {targetDisplay}
              <span className="text-subtle">
                {" "}
                ({fk.target.columns.join(", ")})
              </span>
            </button>

            <Select
              aria-label={buildUiCopy.foreignKeys.onDeleteIn(colsLabel)}
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
              className="h-7 min-h-7 bg-background px-2 py-0 font-sans text-xs"
            />

            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-label={buildUiCopy.foreignKeys.remove(colsLabel)}
              onClick={() => onRemoveForeignKey(idx)}
              className="h-7 w-7 p-0"
            >
              <CloseIcon />
            </Button>

            {!targetInModel ? (
              <span className="col-span-full font-sans text-xs leading-[18px] text-muted">
                {buildUiCopy.foreignKeys.targetNotInModel(`${fk.target.schema}.${fk.target.table}`)}
              </span>
            ) : null}
          </div>
        );
      })}

      {draft !== null ? (
        <Dialog
          open
          title={draft.editIndex !== null ? buildUiCopy.foreignKeys.dialogEdit : buildUiCopy.foreignKeys.dialogNew}
          onClose={() => setDraft(null)}
          size="md"
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraft(null)}
              >
                {buildCopy.cancelButton}
              </Button>
              <Button type="button" variant="primary" onClick={submitDraft}>
                {buildUiCopy.foreignKeys.save}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel>{buildUiCopy.foreignKeys.columnIn(table.name)}</FieldLabel>
              <Select
                aria-label={buildUiCopy.foreignKeys.columnIn(table.name)}
                value={draft.sourceColumn}
                onChange={(nextCol) =>
                  setDraft((prev) =>
                    prev ? { ...prev, sourceColumn: nextCol } : null,
                  )
                }
                options={
                  table.columns.length > 0
                    ? table.columns.map((c) => ({
                        value: c.name,
                        label: `${c.name} (${c.type})`,
                      }))
                    : [{ value: draft.sourceColumn, label: draft.sourceColumn }]
                }
              />
            </Field>

            <Field>
              <FieldLabel>{buildUiCopy.foreignKeys.targetTable}</FieldLabel>
              <Select
                aria-label={buildUiCopy.foreignKeys.targetTable}
                value={draft.targetTableKey}
                onChange={(nextKey) => {
                  const nextTarget = model.tables.find(
                    (t) => tableKey(t) === nextKey,
                  );
                  const nextTargetCol =
                    nextTarget?.primaryKey?.columns[0] ??
                    nextTarget?.columns[0]?.name ??
                    "id";
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          targetTableKey: nextKey,
                          targetColumn: nextTargetCol,
                        }
                      : null,
                  );
                }}
                options={model.tables.map((t) => {
                  const k = tableKey(t);
                  return {
                    value: k,
                    label: t.schema === table.schema ? t.name : k,
                  };
                })}
              />
            </Field>

            <Field>
              <FieldLabel>{buildUiCopy.foreignKeys.targetColumn}</FieldLabel>
              <Select
                aria-label={buildUiCopy.foreignKeys.targetColumn}
                value={draft.targetColumn}
                onChange={(nextCol) =>
                  setDraft((prev) =>
                    prev ? { ...prev, targetColumn: nextCol } : null,
                  )
                }
                options={
                  draftTargetTable && draftTargetTable.columns.length > 0
                    ? draftTargetTable.columns.map((c) => ({
                        value: c.name,
                        label: `${c.name} (${c.type})`,
                      }))
                    : [{ value: draft.targetColumn, label: draft.targetColumn }]
                }
              />
            </Field>

            <Field>
              <FieldLabel>{buildUiCopy.foreignKeys.onDelete}</FieldLabel>
              <Select
                aria-label={buildUiCopy.foreignKeys.onDelete}
                value={draft.onDelete}
                onChange={(nextAction) =>
                  setDraft((prev) =>
                    prev ? { ...prev, onDelete: nextAction as FkAction } : null,
                  )
                }
                options={options.map((action) => ({
                  value: action,
                  label: deleteActionLabels[action],
                }))}
              />
            </Field>
          </div>
        </Dialog>
      ) : null}

      {!table.origin ? (
        <p className="m-0 text-xs leading-[18px] text-muted">
          {buildUiCopy.foreignKeys.diagramHint}
        </p>
      ) : null}
    </section>
  );
}
