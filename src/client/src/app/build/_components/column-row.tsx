import { useMemo, useState } from "react";

import { Button, ChevronIcon, GripIcon, Input, Select, type SelectOption } from "@/components/ui";
import type { ModelColumn } from "../_lib/build-model.schema";
import type { RowState } from "../_lib/editor-rows";
import { buildUiCopy } from "@/app/build/_lib/build-ui.copy";

const parameterizedPresets: Record<string, readonly string[]> = {
  varchar: ["varchar(80)", "varchar(255)"],
  char: ["char(1)"],
  decimal: ["decimal(12,2)"],
  numeric: ["numeric(12,2)"],
};

export function buildTypeOptions(
  catalogTypes: readonly string[],
  currentType: string,
): SelectOption[] {
  const expanded: string[] = [];
  for (const t of catalogTypes) {
    const upperT = t.toUpperCase();
    if (!expanded.includes(upperT)) {
      expanded.push(upperT);
    }
    const presets = parameterizedPresets[t.toLowerCase()];
    if (presets) {
      for (const p of presets) {
        const upperP = p.toUpperCase();
        if (!expanded.includes(upperP)) {
          expanded.push(upperP);
        }
      }
    }
  }

  const currentUpper = currentType.trim().toUpperCase();
  let matchedCurrent = false;
  const options: SelectOption[] = expanded.map((upper) => {
    if (!matchedCurrent && upper === currentUpper) {
      matchedCurrent = true;
      return { value: currentType, label: upper };
    }
    return { value: upper, label: upper };
  });

  if (!matchedCurrent && currentType.trim() !== "") {
    options.unshift({ value: currentType, label: currentUpper });
  }

  return options;
}

export type ColumnRowProps = {
  index: number;
  column: ModelColumn;
  isExistingTable: boolean;
  isPk: boolean;
  isUnique: boolean;
  fkTargetDisplay: string | null;
  rowState: RowState;
  catalogTypes: readonly string[];
  checkExpression: string;
  isDragging?: boolean;
  isDropTargetBefore?: boolean;
  isDropTargetAfter?: boolean;
  onUpdateColumn: (patch: Partial<ModelColumn>) => void;
  onTogglePk: () => void;
  onToggleUnique: () => void;
  onUpdateCheck: (expression: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRevert: () => void;
  onAddNextColumn?: () => void;
  onCtrlClickFk?: () => void;
  onGripPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStartRow?: (e: React.DragEvent<HTMLElement>) => void;
  onDragOverRow?: (e: React.DragEvent<HTMLElement>) => void;
  onDropRow?: (e: React.DragEvent<HTMLElement>) => void;
  onDragEndRow?: () => void;
};

export function ColumnRow({
  index,
  column,
  isExistingTable,
  isPk,
  isUnique,
  fkTargetDisplay,
  rowState,
  catalogTypes,
  checkExpression,
  isDragging = false,
  isDropTargetBefore = false,
  isDropTargetAfter = false,
  onUpdateColumn,
  onTogglePk,
  onToggleUnique,
  onUpdateCheck,
  onDuplicate,
  onRemove,
  onRevert,
  onAddNextColumn,
  onCtrlClickFk,
  onGripPointerDown,
  onMoveUp,
  onMoveDown,
  onDragStartRow,
  onDragOverRow,
  onDropRow,
  onDragEndRow,
}: ColumnRowProps) {
  const [expanded, setExpanded] = useState(false);
  const typeOptions = useMemo(
    () => buildTypeOptions(catalogTypes, column.type),
    [catalogTypes, column.type],
  );
  const beforeId = rowState.marker === "changed" ? `col${index + 1}-antes` : undefined;
  const nameAriaLabel =
    rowState.marker === "new"
      ? buildUiCopy.column.nameLabelNew(index + 1)
      : buildUiCopy.column.nameLabel(index + 1);

  const borderClass =
    rowState.marker === "changed"
      ? "border-accent"
      : rowState.marker === "new"
        ? "border-success"
        : "border-border";

  const gripTitle =
    isExistingTable && rowState.marker === "changed"
      ? buildUiCopy.column.gripChanged
      : isExistingTable && rowState.marker === "new"
        ? buildUiCopy.column.gripNew
        : buildUiCopy.column.grip;

  return (
    <div
      data-column-row-index={index}
      onDragOver={onDragOverRow}
      onDrop={onDropRow}
      className={`${
        expanded
          ? "flex flex-col rounded-md border border-border-strong bg-raised"
          : "flex flex-col"
      } ${
        isDragging
          ? "rounded-md bg-selected/60 opacity-85 ring-1 ring-accent shadow-sm"
          : ""
      } ${isDropTargetBefore ? "border-t-2 border-t-accent" : ""} ${
        isDropTargetAfter ? "border-b-2 border-b-accent" : ""
      }`}
    >
      <div
        className={`grid h-8 grid-cols-[12px_minmax(0,1fr)_112px_repeat(4,26px)_24px] items-center gap-1 ${
          expanded ? "px-[3px]" : ""
        }`}
      >
        <button
          type="button"
          draggable
          aria-label={buildUiCopy.column.reorder(column.name)}
          title={gripTitle}
          onPointerDown={onGripPointerDown}
          onDragStart={onDragStartRow}
          onDragEnd={onDragEndRow}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && onMoveUp) {
              e.preventDefault();
              onMoveUp();
            } else if (e.key === "ArrowDown" && onMoveDown) {
              e.preventDefault();
              onMoveDown();
            }
          }}
          className="group -ml-1 flex h-7 w-4 cursor-grab touch-none items-center justify-center rounded border-none bg-transparent p-0 text-subtle select-none hover:bg-selected hover:text-ink active:cursor-grabbing"
        >
          {isExistingTable && rowState.marker === "changed" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-accent group-hover:hidden" />
              <GripIcon className="hidden text-accent group-hover:block" />
            </>
          ) : isExistingTable && rowState.marker === "new" ? (
            <>
              <span className="text-center font-mono font-semibold text-success group-hover:hidden">
                +
              </span>
              <GripIcon className="hidden text-success group-hover:block" />
            </>
          ) : (
            <GripIcon className="text-subtle group-hover:text-ink" />
          )}
        </button>

        <div className="relative min-w-0">
          <Input
            type="text"
            value={column.name}
            aria-label={nameAriaLabel}
            aria-describedby={beforeId}
            onChange={(e) => onUpdateColumn({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowUp" && onMoveUp) {
                e.preventDefault();
                onMoveUp();
                return;
              }
              if (e.altKey && e.key === "ArrowDown" && onMoveDown) {
                e.preventDefault();
                onMoveDown();
                return;
              }
              if (e.key === "Enter" && onAddNextColumn) {
                e.preventDefault();
                onAddNextColumn();
              }
            }}
            className={`h-7 min-w-0 rounded bg-background font-mono text-xs ${borderClass} ${
              fkTargetDisplay
                ? "pr-[30px] pl-2"
                : rowState.marker === "new"
                  ? "pr-[36px] pl-2"
                  : "px-2"
            }`}
          />
          {fkTargetDisplay ? (
            <span
              title={buildUiCopy.column.foreignKeyTo(fkTargetDisplay)}
              onClick={(e) => {
                if ((e.ctrlKey || e.metaKey) && onCtrlClickFk) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCtrlClickFk();
                }
              }}
              className={`absolute top-[5px] right-[7px] font-mono text-[10px] font-semibold text-accent ${
                onCtrlClickFk ? "cursor-pointer hover:underline" : ""
              }`}
            >
              FK
            </span>
          ) : rowState.marker === "new" ? (
            <span className="absolute top-[5px] right-[7px] font-mono text-[10px] font-semibold text-success">
              {buildUiCopy.column.newBadge}
            </span>
          ) : null}
        </div>

        <Select
          value={column.type}
          options={typeOptions}
          aria-label={buildUiCopy.column.typeOf(column.name)}
          aria-describedby={beforeId}
          onChange={(nextType) => onUpdateColumn({ type: nextType })}
          wideList
          className={`h-7 min-h-7 rounded bg-background px-2 py-0 font-mono text-xs text-body ${
            rowState.marker === "changed" ? "border-accent" : "border-border"
          }`}
        />

        <button
          type="button"
          aria-pressed={isPk}
          aria-disabled={rowState.locks.primaryKey}
          title={
            rowState.locks.primaryKey
              ? buildUiCopy.column.pkLocked
              : isPk
                ? buildUiCopy.column.pkOn
                : buildUiCopy.column.pkOff
          }
          aria-label={buildUiCopy.column.pkLabel(column.name)}
          onClick={() => {
            if (rowState.locks.primaryKey) return;
            onTogglePk();
          }}
          className={`h-6 rounded border p-0 font-mono text-[10px] font-semibold ${
            isPk
              ? "border-accent bg-accent/16 text-accent"
              : "border-border bg-transparent text-subtle"
          } ${rowState.locks.primaryKey ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          PK
        </button>

        <button
          type="button"
          aria-pressed={!column.nullable}
          title={
            !column.nullable
              ? buildUiCopy.column.nnOn
              : buildUiCopy.column.nnOff
          }
          aria-label={buildUiCopy.column.nnLabel(column.name)}
          onClick={() => onUpdateColumn({ nullable: !column.nullable })}
          className={`h-6 cursor-pointer rounded border p-0 font-mono text-[10px] font-semibold ${
            !column.nullable
              ? "border-subtle bg-selected text-ink"
              : "border-border bg-transparent text-subtle"
          }`}
        >
          NN
        </button>

        <button
          type="button"
          aria-pressed={isUnique}
          title={
            isUnique
              ? buildUiCopy.column.uqOn
              : buildUiCopy.column.uqOff
          }
          aria-label={buildUiCopy.column.uqLabel(column.name)}
          onClick={onToggleUnique}
          className={`h-6 cursor-pointer rounded border p-0 font-mono text-[10px] font-semibold ${
            isUnique
              ? "border-subtle bg-selected text-ink"
              : "border-border bg-transparent text-subtle"
          }`}
        >
          UQ
        </button>

        <button
          type="button"
          aria-pressed={column.identity !== null}
          aria-disabled={rowState.locks.identity}
          title={
            rowState.locks.identity
              ? buildUiCopy.column.aiLocked
              : column.identity !== null
                ? buildUiCopy.column.aiOn
                : buildUiCopy.column.aiOff
          }
          aria-label={buildUiCopy.column.aiLabel(column.name)}
          onClick={() => {
            if (rowState.locks.identity) return;
            onUpdateColumn({
              identity: column.identity === null ? "always" : null,
            });
          }}
          className={`h-6 rounded border p-0 font-mono text-[10px] font-semibold ${
            column.identity !== null
              ? "border-subtle bg-selected text-ink"
              : "border-border bg-transparent text-subtle"
          } ${rowState.locks.identity ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          AI
        </button>

        <Button
          type="button"
          variant="ghost"
          size="compact"
          title={
            expanded
              ? buildUiCopy.column.collapseOptions(column.name)
              : buildUiCopy.column.moreOptionsTitle(column.name)
          }
          aria-label={
            expanded
              ? buildUiCopy.column.lessOptions(column.name)
              : buildUiCopy.column.moreOptions(column.name)
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className={`h-6 w-6 rounded p-0 ${
            expanded ? "bg-selected text-ink" : ""
          }`}
        >
          <ChevronIcon direction={expanded ? "down" : "right"} />
        </Button>
      </div>

      {rowState.marker === "changed" && rowState.before ? (
        <div
          id={beforeId}
          className="flex items-center gap-2 pb-1 pl-4 text-xs leading-[18px] text-muted"
        >
          <span>
            {buildUiCopy.column.was} <span className="font-mono text-body">{rowState.before}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={onRevert}
            className="ml-auto h-6 px-2 text-xs underline"
          >
            {buildUiCopy.column.revert}
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 border-t border-border pt-2 pr-3 pb-3 pl-[19px] text-xs text-muted">
          <label htmlFor={`col-${index}-tipo`}>{buildUiCopy.column.typeAndSize}</label>
          <Input
            id={`col-${index}-tipo`}
            type="text"
            value={column.type}
            onChange={(e) => onUpdateColumn({ type: e.target.value })}
            className="h-7 rounded border-border bg-background px-2 font-mono text-xs text-body"
          />

          <label htmlFor={`col-${index}-padrao`}>{buildUiCopy.column.defaultValue}</label>
          <Input
            id={`col-${index}-padrao`}
            type="text"
            value={column.default ?? ""}
            onChange={(e) =>
              onUpdateColumn({ default: e.target.value ? e.target.value : null })
            }
            className="h-7 rounded border-border bg-background px-2 font-mono text-xs text-success"
          />

          <label htmlFor={`col-${index}-check`}>{buildUiCopy.column.check}</label>
          <Input
            id={`col-${index}-check`}
            type="text"
            value={checkExpression}
            onChange={(e) => onUpdateCheck(e.target.value)}
            className="h-7 rounded border-border bg-background px-2 font-mono text-xs text-body"
          />

          <label htmlFor={`col-${index}-comentario`}>{buildUiCopy.column.comment}</label>
          <Input
            id={`col-${index}-comentario`}
            type="text"
            value={column.comment ?? ""}
            onChange={(e) =>
              onUpdateColumn({ comment: e.target.value ? e.target.value : null })
            }
            className="h-7 rounded border-border bg-background px-2 text-xs text-ink"
          />

          <span />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={onDuplicate}
              className="h-7 px-2.5 text-xs"
            >
              {buildUiCopy.column.duplicate}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="compact"
              onClick={onRemove}
              className="h-7 px-2.5 text-xs"
            >
              {buildUiCopy.column.remove}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type RemovedColumnRowProps = {
  column: ModelColumn;
  onRestore: () => void;
};

export function RemovedColumnRow({ column, onRestore }: RemovedColumnRowProps) {
  return (
    <div className="grid h-8 grid-cols-[12px_minmax(0,1fr)_112px_minmax(0,128px)] items-center gap-1 text-subtle">
      <span title={buildUiCopy.column.toRemove} className="h-0.5 w-2 bg-danger" />
      <span className="px-2 font-mono text-xs line-through">{column.name}</span>
      <span className="px-2 font-mono text-xs line-through">{column.type}</span>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        onClick={onRestore}
        className="h-6 justify-self-end px-2 text-xs"
      >
        {buildUiCopy.column.restore}
      </Button>
    </div>
  );
}
