import { useId, useState } from "react";

import {
  Button,
  ConfirmDialog,
  ContextMenu,
  type ContextMenuGroup,
  Field,
  FieldLabel,
  Input,
  MoreIcon,
  PlusIcon,
  Select,
} from "@/components/ui";
import { engineRules, sameName } from "../_lib/build-engines";
import {
  addColumn,
  addForeignKey,
  addIndex,
  copyAsNewTable,
  moveTableToSchema,
  removeColumn,
  removeForeignKey,
  removeIndex,
  removeTable,
  renameTable,
  restoreColumn,
  revertColumn,
  revertTable,
  setDropInDatabase,
  tableChanges,
  tableKey as getTableKey,
  togglePrimaryKey,
  toggleUnique,
  updateColumn,
  updateForeignKey,
  updateIndex,
} from "../_lib/build-model";
import type { BuildModel, ModelColumn } from "../_lib/build-model.schema";
import { tableChangesDdl } from "../_lib/ddl-changes";
import type { DdlContext } from "../_lib/ddl-full";
import { columnRowState, removedColumns } from "../_lib/editor-rows";
import { ColumnRow, RemovedColumnRow } from "./column-row";
import { ForeignKeysSection } from "./foreign-keys-section";
import { IndexesSection } from "./indexes-section";
import { TableCommands } from "./table-commands";

export type SimpleEditorProps = {
  model: BuildModel;
  tableKey: string | null;
  baseLabel: string | null;
  ddlContext: DdlContext;
  onChange: (next: BuildModel, nextSelectedTableKey?: string | null) => void;
};

export function SimpleEditor({
  model,
  tableKey,
  ddlContext,
  onChange,
}: SimpleEditorProps) {
  const uid = useId();
  const tableInputId = `${uid}-table-name`;
  const schemaSelectId = `${uid}-table-schema`;
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [confirmDropOpen, setConfirmDropOpen] = useState(false);

  const table =
    model.tables.find((t) => getTableKey(t) === tableKey) ??
    model.tables[0] ??
    null;

  if (!table) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted">
        Selecione ou crie uma tabela para editar.
      </div>
    );
  }

  const currentKey = getTableKey(table);
  const isExisting = table.origin !== null;
  const changes = tableChanges(model.engine, table);
  const removedCols = removedColumns(table);
  const catalogTypes = engineRules[model.engine].types;

  const schemaNames = Array.from(
    new Set([
      model.defaultSchema,
      ...model.schemas.map((s) => s.name),
      ...model.tables.map((t) => t.schema),
    ]),
  );

  const columnCountParts = [`${table.columns.length + removedCols.length}`];
  if (isExisting) {
    if (changes.addedColumns.length > 0) {
      columnCountParts.push(
        `${changes.addedColumns.length} ${changes.addedColumns.length === 1 ? "nova" : "novas"}`,
      );
    }
    if (changes.changedColumns.length > 0) {
      columnCountParts.push(
        `${changes.changedColumns.length} ${changes.changedColumns.length === 1 ? "alterada" : "alteradas"}`,
      );
    }
    if (removedCols.length > 0) {
      columnCountParts.push(`${removedCols.length} a remover`);
    }
  }

  const tableDdl = isExisting
    ? tableChangesDdl(model, currentKey, ddlContext)
    : "";

  const handleDuplicateColumn = (col: ModelColumn) => {
    const next = addColumn(model, currentKey, {
      ...col,
      name: `${col.name}_copia`,
      originName: null,
      identity: null,
    });
    onChange(next);
  };

  const menuGroups: ContextMenuGroup[] = [
    [
      {
        id: "copy-table",
        label: isExisting ? "Copiar como tabela nova" : "Duplicar tabela",
        hint: "Uma tabela nova com as mesmas colunas",
        onSelect: () =>
          onChange(copyAsNewTable(model, currentKey, model.defaultSchema)),
      },
      ...(isExisting && changes.kind === "changed"
        ? [
            {
              id: "revert-table",
              label: "Desfazer alterações da tabela",
              hint: "Volta a tabela para como está no banco",
              onSelect: () => onChange(revertTable(model, currentKey)),
            },
          ]
        : []),
      {
        id: "remove-table",
        label: isExisting ? "Tirar do modelo" : "Excluir tabela",
        hint: "Some daqui; nada vai para o DDL",
        onSelect: () => onChange(removeTable(model, currentKey), null),
      },
    ],
    ...(isExisting
      ? [
          [
            {
              id: "drop-in-db",
              label: table.dropInDatabase
                ? "Cancelar exclusão no banco"
                : "Excluir no banco…",
              hint: "Vira DROP TABLE no DDL de diferenças",
              onSelect: () => {
                if (table.dropInDatabase) {
                  onChange(setDropInDatabase(model, currentKey, false));
                } else {
                  setConfirmDropOpen(true);
                }
              },
            },
          ],
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-10">
      <div className="grid grid-cols-[minmax(0,1fr)_140px_32px] items-end gap-2">
        <Field className="gap-1">
          <FieldLabel htmlFor={tableInputId} className="text-xs">
            Tabela
          </FieldLabel>
          <Input
            id={tableInputId}
            type="text"
            value={table.name}
            onChange={(e) => {
              const nextName = e.target.value;
              const nextModel = renameTable(model, currentKey, nextName);
              onChange(nextModel, `${table.schema}.${nextName.trim()}`);
            }}
            className="h-8 bg-background px-2.5 font-mono text-[13px] font-semibold"
          />
        </Field>

        <Field
          className="gap-1"
          title={
            isExisting
              ? "Uma tabela existente não muda de esquema"
              : undefined
          }
        >
          <FieldLabel htmlFor={schemaSelectId} className="text-xs">
            Esquema
          </FieldLabel>
          <Select
            id={schemaSelectId}
            value={table.schema}
            disabled={isExisting}
            onChange={(nextSchema) => {
              const nextModel = moveTableToSchema(
                model,
                currentKey,
                nextSchema,
              );
              onChange(nextModel, `${nextSchema}.${table.name}`);
            }}
            options={schemaNames.map((schemaName) => ({
              value: schemaName,
              label: schemaName,
            }))}
            wideList
            className="h-8 min-h-8 px-2 py-0 font-mono text-[13px]"
          />
        </Field>

        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Mais ações da tabela"
          aria-haspopup="menu"
          aria-expanded={menuPoint !== null}
          onClick={(e) => {
            if (menuPoint !== null) {
              setMenuPoint(null);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPoint({ x: rect.left, y: rect.bottom + 4 });
            }
          }}
          className={menuPoint !== null ? "bg-selected" : ""}
        >
          <MoreIcon />
        </Button>
      </div>

      {menuPoint !== null ? (
        <ContextMenu
          label={`Ações de ${table.name}`}
          point={menuPoint}
          groups={menuGroups}
          onClose={() => setMenuPoint(null)}
        />
      ) : null}

      <section aria-labelledby="h-colunas" className="flex flex-col gap-1">
        <div className="flex h-7 items-center gap-2">
          <h2 id="h-colunas" className="m-0 text-[13px] font-semibold">
            Colunas
          </h2>
          <span className="text-xs text-subtle">
            {columnCountParts.join(" · ")}
          </span>
        </div>

        <div
          aria-hidden="true"
          className="grid h-5 grid-cols-[12px_minmax(0,1fr)_112px_repeat(4,26px)_24px] items-center gap-1 text-[11px] font-medium text-subtle"
        >
          <span />
          <span>Nome</span>
          <span>Tipo</span>
          <span title="Chave primária" className="text-center">
            PK
          </span>
          <span title="Não aceita nulo" className="text-center">
            NN
          </span>
          <span title="Valor único" className="text-center">
            UQ
          </span>
          <span
            title="Gerado pelo banco (identity, serial)"
            className="text-center"
          >
            AI
          </span>
          <span />
        </div>

        {table.columns.map((column, idx) => {
          const isPk = table.primaryKey?.columns.includes(column.name) ?? false;
          const isUnique = table.uniques.some(
            (u) => u.columns.length === 1 && u.columns[0] === column.name,
          );
          const fk = table.foreignKeys.find(
            (f) => f.columns.length === 1 && f.columns[0] === column.name,
          );
          const fkTargetDisplay = fk
            ? sameName(
                model.engine,
                { name: fk.target.schema, exactName: false },
                { name: table.schema, exactName: false },
              )
              ? fk.target.table
              : `${fk.target.schema}.${fk.target.table}`
            : null;
          const state = columnRowState(model.engine, table, column);
          const escapedColName = column.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const colCheckRegex = column.name
            ? new RegExp(`(?:^|[^a-zA-Z0-9_$])${escapedColName}(?:$|[^a-zA-Z0-9_$])`)
            : null;
          const matchesColCheck = (ck: { name: string | null; expression: string }) =>
            ck.name === column.name || (colCheckRegex !== null && colCheckRegex.test(ck.expression));
          const colCheck =
            table.checks.find(matchesColCheck)
              ?.expression ?? "";

          return (
            <ColumnRow
              key={column.originName ?? idx}
              index={idx}
              column={column}
              isExistingTable={isExisting}
              isPk={isPk}
              isUnique={isUnique}
              fkTargetDisplay={fkTargetDisplay}
              rowState={state}
              catalogTypes={catalogTypes}
              checkExpression={colCheck}
              onUpdateColumn={(patch) =>
                onChange(updateColumn(model, currentKey, column.name, patch, idx))
              }
              onTogglePk={() =>
                onChange(togglePrimaryKey(model, currentKey, column.name))
              }
              onToggleUnique={() =>
                onChange(toggleUnique(model, currentKey, column.name))
              }
              onUpdateCheck={(expression) => {
                const nextTables = model.tables.map((t) => {
                  if (getTableKey(t) !== currentKey) return t;
                  const existingCheck = t.checks.find(matchesColCheck);
                  const others = t.checks.filter((ck) => !matchesColCheck(ck));
                  return {
                    ...t,
                    checks: expression.trim()
                      ? [...others, { name: existingCheck?.name ?? null, expression: expression.trim() }]
                      : others,
                  };
                });
                onChange({ ...model, tables: nextTables });
              }}
              onDuplicate={() => handleDuplicateColumn(column)}
              onRemove={() =>
                onChange(removeColumn(model, currentKey, column.name).model)
              }
              onRevert={() =>
                onChange(revertColumn(model, currentKey, column.name))
              }
              onAddNextColumn={
                idx === table.columns.length - 1
                  ? () => onChange(addColumn(model, currentKey))
                  : undefined
              }
            />
          );
        })}

        {removedCols.map((removed) => (
          <RemovedColumnRow
            key={removed.originName ?? removed.name}
            column={removed}
            onRestore={() =>
              onChange(
                restoreColumn(
                  model,
                  currentKey,
                  removed.originName ?? removed.name,
                ),
              )
            }
          />
        ))}

        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={() => onChange(addColumn(model, currentKey))}
          className="mt-1 gap-1.5 self-start border-dashed px-3 text-xs"
        >
          <PlusIcon />
          <span>Adicionar coluna</span>
          {!isExisting ? (
            <span className="font-mono text-[11px] text-muted">
              Enter na última
            </span>
          ) : null}
        </Button>
      </section>

      <ForeignKeysSection
        model={model}
        table={table}
        onAddForeignKey={(fk) => onChange(addForeignKey(model, currentKey, fk))}
        onUpdateForeignKey={(index, fk) =>
          onChange(updateForeignKey(model, currentKey, index, fk))
        }
        onRemoveForeignKey={(index) =>
          onChange(removeForeignKey(model, currentKey, index))
        }
      />

      <IndexesSection
        table={table}
        changes={isExisting ? changes : null}
        onAddIndex={(cols) => onChange(addIndex(model, currentKey, cols))}
        onUpdateIndex={(index, value) =>
          onChange(updateIndex(model, currentKey, index, value))
        }
        onRemoveIndex={(index) =>
          onChange(removeIndex(model, currentKey, index))
        }
      />

      {isExisting ? (
        <TableCommands
          ddl={tableDdl}
          removedColumnNames={removedCols.map((c) => c.name)}
        />
      ) : (
        <section
          aria-labelledby="h-comentario"
          className="flex flex-col gap-1.5 border-t border-border pt-3"
        >
          <h2 id="h-comentario" className="m-0 text-[13px] font-semibold">
            Comentário da tabela
          </h2>
          <textarea
            aria-labelledby="h-comentario"
            rows={2}
            value={table.comment ?? ""}
            onChange={(e) => {
              const nextComment = e.target.value ? e.target.value : null;
              onChange({
                ...model,
                tables: model.tables.map((t) =>
                  getTableKey(t) === currentKey
                    ? { ...t, comment: nextComment }
                    : t,
                ),
              });
            }}
            className="box-border resize-y rounded-md border border-border-strong bg-raised px-2.5 py-2 text-ink outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
          />
        </section>
      )}

      <ConfirmDialog
        open={confirmDropOpen}
        title={`Marcar ${currentKey} para excluir no banco?`}
        description="A tabela ficará marcada para gerar DROP TABLE no DDL de diferenças. Nada é executado no banco agora."
        confirmLabel="Marcar para excluir"
        tone="danger"
        onConfirm={() => {
          setConfirmDropOpen(false);
          onChange(setDropInDatabase(model, currentKey, true));
        }}
        onCancel={() => setConfirmDropOpen(false)}
      />
    </div>
  );
}
