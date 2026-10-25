import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { ContextMenu, useHost, useToast } from "@/components/ui";
import { hostClipboard } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import { copyTextOf, emptyView, navigate, panelRows, showMoreOf, type PanelRow, type PanelView } from "../_lib/variables-panel";
import { variablesPanelCopy as copy } from "../_lib/variables-panel.copy";
import type { ScriptModel } from "../_lib/variables/script";
import type { TabValuesSnapshot } from "../_lib/variables/tab-values";

type VariablesPanelProps = {
  /** O texto do editor lido (as variáveis declaradas, na ordem). */
  model: ScriptModel;
  values: TabValuesSnapshot;
  /** A variável escolhida de fora (o Ctrl+Enter numa declaração traz o painel com a linha dela escolhida), e quantas vezes isso foi pedido. */
  select: { serial: number; name: string | null };
  /** "Ir para a declaração": o Enter, o duplo clique e o menu da linha. O nome é o da variável. */
  onGoTo: (name: string) => void;
};

const cell = "min-w-0 truncate px-2 py-1";

/**
 * O painel "Variáveis" (RN-VAR-024): uma tabela em árvore (`role="treegrid"`) com "Nome", "Tipo", "Valor", "Origem" e "Quando". A lista e o objeto abrem em um item
 * ou um campo por linha; a lista longa mostra os 100 primeiros e "Mostrar mais 100 (de N)". O teclado é o da árvore (`navigate`): as setas, Home e End, a seta para
 * a direita abre e a para a esquerda fecha ou vai ao pai; Ctrl+C copia o valor da linha; Enter e o duplo clique levam o cursor do editor à declaração. É só para
 * ver: os valores mudam pelo script e pelo Ctrl+Enter na declaração.
 */
export function VariablesPanel({ model, values, select, onGoTo }: VariablesPanelProps) {
  const toast = useToast();
  const host = useHost();
  const [view, setView] = useState<PanelView>(emptyView);
  // O painel abre com a linha da variável pedida de fora escolhida: ele só é montado depois do pedido, e o ajuste abaixo só vale para os pedidos seguintes.
  const [focused, setFocused] = useState<string | null>(select.name);
  const [menu, setMenu] = useState<{ row: PanelRow; point: { x: number; y: number } } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  // O pedido de fora (Ctrl+Enter numa declaração): a linha dela fica escolhida. Ajuste durante a renderização, uma vez por pedido.
  const [seen, setSeen] = useState(select.serial);
  if (seen !== select.serial) {
    setSeen(select.serial);
    if (select.name !== null) setFocused(select.name);
  }

  const rows = useMemo(() => panelRows(model, values, view), [model, values, view]);
  const current = rows.find((row) => row.key === focused) ?? rows[0] ?? null;

  const setOpen = (key: string, open: boolean) =>
    setView((held) => {
      const next = new Set(held.open);
      if (open) next.add(key);
      else next.delete(key);
      return { ...held, open: next };
    });

  async function copyRow(row: PanelRow) {
    const text = copyTextOf(row);
    if (text === null) return;
    try {
      await hostClipboard(host).writeText(text);
      toast.success(copy.copied);
    } catch {
      toast.warning(copy.notCopied);
    }
  }

  // A linha que recebe o foco do teclado depois da próxima renderização (a que ainda não existe quando se pede).
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    body.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
  });

  function moreOf(row: PanelRow) {
    if (row.more === null || row.parent === null) return;
    const parent = row.parent;
    const { shown, total } = row.more;
    const next = showMoreOf(shown, total);
    setView((held) => ({ ...held, shown: new Map(held.shown).set(parent, next) }));
    // Mostrado o resto, a linha "Mostrar mais" sai do DOM com o foco do teclado nela: o foco vai ao primeiro item que apareceu (RN-VAR-024).
    if (next >= total) {
      const first = `${parent}/${shown}`;
      setFocused(first);
      pendingFocus.current = first;
    }
  }

  function focusRow(key: string) {
    setFocused(key);
    body.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (current === null || event.altKey) return;
    // No macOS o Prism usa o ⌘ onde os outros usam o Ctrl (RN-VAR-024).
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyRow(current);
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (current.kind === "more") moreOf(current);
      else onGoTo(current.variable);
      return;
    }
    const move = navigate(rows, current.key, event.key);
    if (move === null) return;
    event.preventDefault();
    if (move.open !== undefined) setOpen(move.open, true);
    if (move.close !== undefined) setOpen(move.close, false);
    focusRow(move.focus);
  }

  function onContextMenu(event: MouseEvent, row: PanelRow) {
    event.preventDefault();
    if (row.kind === "more") return;
    setFocused(row.key);
    setMenu({ row, point: { x: event.clientX, y: event.clientY } });
  }

  if (rows.length === 0) {
    return (
      <p role="status" className="flex-1 p-4 text-muted">
        {copy.empty}
      </p>
    );
  }

  return (
    <div ref={body} className="flex min-h-0 flex-1 flex-col overflow-auto text-xs">
      <div role="treegrid" aria-label={copy.label} aria-rowcount={rows.length + 1} onKeyDown={onKeyDown} className="min-w-[36rem]">
        <div role="row" className="sticky top-0 grid grid-cols-[minmax(8rem,1.2fr)_minmax(6rem,1fr)_minmax(10rem,3fr)_6rem_9rem] border-b border-border bg-panel font-medium text-muted">
          {(["name", "type", "value", "origin", "when"] as const).map((column) => (
            <div key={column} role="columnheader" className={cell}>
              {copy.columns[column]}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div
            key={row.key}
            role="row"
            data-row-key={row.key}
            aria-level={row.level}
            aria-expanded={row.expandable ? row.expanded : undefined}
            aria-selected={current?.key === row.key}
            tabIndex={current?.key === row.key ? 0 : -1}
            title={row.noValue ? undefined : row.isSql ? copy.sqlWarning : row.hint}
            onFocus={() => setFocused(row.key)}
            onClick={() => (row.kind === "more" ? moreOf(row) : setFocused(row.key))}
            onDoubleClick={() => {
              if (row.kind !== "more") onGoTo(row.variable);
            }}
            onContextMenu={(event) => onContextMenu(event, row)}
            className={cn("grid cursor-default grid-cols-[minmax(8rem,1.2fr)_minmax(6rem,1fr)_minmax(10rem,3fr)_6rem_9rem] border-b border-border outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-accent", current?.key === row.key && "bg-selected")}
          >
            {row.kind === "more" ? (
              <div role="gridcell" aria-colspan={5} className="col-span-5 px-2 py-1 text-accent" style={{ paddingLeft: `${row.level * 16 + 8}px` }}>
                {row.name}
              </div>
            ) : (
              <>
                <div role="rowheader" className={cn(cell, "flex items-center gap-1 font-mono text-ink")} style={{ paddingLeft: `${(row.level - 1) * 16 + 8}px` }}>
                  {row.expandable ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={row.expanded ? "Fechar" : "Abrir"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpen(row.key, !row.expanded);
                      }}
                      className="w-3 flex-none cursor-pointer text-muted"
                    >
                      {row.expanded ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span aria-hidden className="w-3 flex-none" />
                  )}
                  <span className="truncate">{row.name}</span>
                </div>
                <div role="gridcell" className={cn(cell, "font-mono text-muted")}>
                  {row.type}
                </div>
                <div role="gridcell" className={cn(cell, "font-mono", row.noValue || row.isNull ? "text-muted" : "text-ink")}>
                  {row.isSql ? (
                    <span aria-hidden className="mr-1 text-accent">
                      ⚠
                    </span>
                  ) : null}
                  {row.noValue ? copy.noValue : row.value}
                </div>
                <div role="gridcell" className={cn(cell, "text-muted")}>
                  {row.origin ?? ""}
                </div>
                <div role="gridcell" className={cn(cell, "text-muted")}>
                  {row.when ?? ""}
                  {row.stale ? <span className="ml-1 text-accent">{copy.stale}</span> : null}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {menu === null ? null : (
        <ContextMenu
          key={`${menu.row.key}@${menu.point.x},${menu.point.y}`}
          label={copy.menu.label}
          point={menu.point}
          initialFocus="menu"
          groups={[
            [
              { id: "copy", label: copy.menu.copy, disabled: menu.row.raw === null, onSelect: () => void copyRow(menu.row) },
              { id: "goTo", label: copy.menu.goTo, onSelect: () => onGoTo(menu.row.variable) },
            ],
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
