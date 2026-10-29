import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { engineRules, sameName } from "../_lib/build-engines";
import {
  addColumn,
  addForeignKey,
  addIndex,
  copyAsNewTable,
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
  moveTableToSchema,
} from "../_lib/build-model";
import type { BuildModel, ModelColumn } from "../_lib/build-model.schema";
import { tableChangesDdl } from "../_lib/ddl-changes";
import type { DdlContext } from "../_lib/ddl-full";
import { columnRowState, removedColumns } from "../_lib/editor-rows";
import { ColumnRow, RemovedColumnRow } from "./column-row";
import { ExistingTableBanner } from "./existing-table-banner";
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
  baseLabel,
  ddlContext,
  onChange,
}: SimpleEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDropOpen, setConfirmDropOpen] = useState(false);

  const table =
    model.tables.find((t) => getTableKey(t) === tableKey) ??
    model.tables[0] ??
    null;

  if (!table) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-muted">
        Selecione ou crie uma tabela para editar.
      </div>
    );
  }

  const currentKey = getTableKey(table);
  const isExisting = table.origin !== null;
  const changes = tableChanges(model.engine, table);
  const removedCols = removedColumns(table);
  const typesListId = `tipos-${model.engine}`;
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

  return (
    <div className="flex flex-col gap-4 p-4">
      {isExisting ? (
        <ExistingTableBanner
          baseLabel={
            baseLabel ??
            (model.base
              ? `${model.base.connectionId}${model.base.database ? ` / ${model.base.database}` : ""}`
              : "banco de base")
          }
          changes={changes}
          onRevertTable={() => onChange(revertTable(model, currentKey))}
        />
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_140px_32px] items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Tabela
          <input
            type="text"
            value={table.name}
            onChange={(e) => {
              const nextName = e.target.value;
              const nextModel = renameTable(model, currentKey, nextName);
              onChange(nextModel, `${table.schema}.${nextName.trim()}`);
            }}
            className="box-border h-8 rounded-md border border-line-strong bg-canvas px-2.5 font-mono text-[13px] font-semibold text-ink-strong"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Esquema
          <select
            value={table.schema}
            disabled={isExisting}
            title={
              isExisting
                ? "Uma tabela existente não muda de esquema"
                : undefined
            }
            onChange={(e) => {
              const nextSchema = e.target.value;
              const nextModel = moveTableToSchema(
                model,
                currentKey,
                nextSchema,
              );
              onChange(nextModel, `${nextSchema}.${table.name}`);
            }}
            className={`h-8 rounded-md border px-2 font-mono text-[13px] ${
              isExisting
                ? "border-line bg-surface text-ink-muted"
                : "border-line-strong bg-surface-raised text-ink"
            }`}
          >
            {schemaNames.map((schemaName) => (
              <option key={schemaName} value={schemaName}>
                {schemaName}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          aria-label="Mais ações da tabela"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-line-strong text-ink ${
            menuOpen ? "bg-surface-hover" : "bg-transparent"
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="3.5" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="12.5" cy="8" r="1.25" />
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          aria-label={`Ações de ${table.name}`}
          className="-mt-2.5 box-border w-[260px] self-end rounded-md border border-line-strong bg-surface-raised p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onChange(copyAsNewTable(model, currentKey, model.defaultSchema));
            }}
            className="flex w-full cursor-pointer flex-col rounded border-0 bg-transparent px-2 py-1 text-left text-ink-soft"
          >
            <span>
              {isExisting ? "Copiar como tabela nova" : "Duplicar tabela"}
            </span>
            <span className="text-xs leading-[18px] text-ink-muted">
              Uma tabela nova com as mesmas colunas
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onChange(removeTable(model, currentKey), null);
            }}
            className="flex w-full cursor-pointer flex-col rounded border-0 bg-transparent px-2 py-1 text-left text-ink-soft"
          >
            <span>{isExisting ? "Tirar do modelo" : "Excluir tabela"}</span>
            <span className="text-xs leading-[18px] text-ink-muted">
              Some daqui; nada vai para o DDL
            </span>
          </button>

          {isExisting ? (
            <>
              <div role="separator" className="my-1 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  if (table.dropInDatabase) {
                    onChange(setDropInDatabase(model, currentKey, false));
                  } else {
                    setConfirmDropOpen(true);
                  }
                }}
                className="flex w-full cursor-pointer flex-col rounded border-0 bg-transparent px-2 py-1 text-left text-danger"
              >
                <span>
                  {table.dropInDatabase
                    ? "Cancelar exclusão no banco"
                    : "Excluir no banco…"}
                </span>
                <span className="text-xs leading-[18px] text-ink-muted">
                  Vira DROP TABLE no DDL de diferenças
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="h-colunas" className="flex flex-col gap-1">
        <div className="flex h-7 items-center gap-2">
          <h2 id="h-colunas" className="m-0 text-[13px] font-semibold">
            Colunas
          </h2>
          <span className="text-xs text-ink-faint">
            {columnCountParts.join(" · ")}
          </span>
        </div>

        <div
          aria-hidden="true"
          className="grid h-5 grid-cols-[12px_minmax(0,1fr)_112px_repeat(4,26px)_24px] items-center gap-1 text-[11px] font-medium text-ink-faint"
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
          const colCheck =
            table.checks.find((ck) => ck.expression.includes(column.name))
              ?.expression ?? "";

          return (
            <ColumnRow
              key={column.originName ?? `${column.name}-${idx}`}
              index={idx}
              column={column}
              isExistingTable={isExisting}
              isPk={isPk}
              isUnique={isUnique}
              fkTargetDisplay={fkTargetDisplay}
              rowState={state}
              typesListId={typesListId}
              checkExpression={colCheck}
              onUpdateColumn={(patch) =>
                onChange(updateColumn(model, currentKey, column.name, patch))
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
                  const others = t.checks.filter(
                    (ck) => !ck.expression.includes(column.name),
                  );
                  return {
                    ...t,
                    checks: expression.trim()
                      ? [...others, { name: null, expression: expression.trim() }]
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

        <button
          type="button"
          onClick={() => onChange(addColumn(model, currentKey))}
          className="mt-1 flex h-8 cursor-pointer items-center gap-1.5 self-start rounded-md border border-dashed border-line-strong bg-transparent px-3 text-ink"
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
          <span>Adicionar coluna</span>
          {!isExisting ? (
            <span className="font-mono text-[11px] text-ink-muted">
              Enter na última
            </span>
          ) : null}
        </button>

        <datalist id={typesListId}>
          {catalogTypes.map((typeName) => (
            <option key={typeName} value={typeName} />
          ))}
        </datalist>
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
          className="flex flex-col gap-1.5 border-t border-line pt-3"
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
            className="box-border resize-y rounded-md border border-line bg-canvas px-2.5 py-2 text-ink"
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
