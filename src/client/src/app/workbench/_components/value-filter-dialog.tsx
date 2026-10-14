import { useId, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { visibleValues } from "../_lib/filter-menu";
import { shownPart } from "../_lib/grid-export/value-filter";
import { gridFilterCopy } from "../_lib/grid-filter.copy";
import type { OpenValueFilter } from "../_lib/use-record-edits";

const copy = gridFilterCopy.values;

/** O valor como a lista o mostra: o nulo é "NULL", o vazio é "(vazio)", e os controles e invisíveis viram espaço (a lista é de uma linha por valor). */
function valueText(value: string | null): { text: string; special: boolean } {
  if (value === null) return { text: copy.nullValue, special: true };
  if (value === "") return { text: copy.emptyValue, special: true };
  return { text: value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+/gu, " "), special: false };
}

/**
 * O "Filtrar por valor…" (Ctrl+F11, RN-GRADE-013): os valores distintos da coluna nas linhas já carregadas, cada um com
 * quantas vezes aparece, do mais frequente ao menos, com busca e caixas de marcar. "Filtrar" monta `coluna IN (…)` (`=` com um valor só) e o nulo marcado
 * como `coluna IS NULL`, juntos por `OR`, e a condição entra no campo de filtro como a do menu. O valor cortado e o que não vira literal ficam na lista,
 * desabilitados. A lista desenha até 500 valores; a busca acha os outros.
 */
export function ValueFilterDialog({ column, values, rows, more, onApply, onClose }: OpenValueFilter) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set());
  const listId = useId();
  const { entries, total } = visibleValues(values, search);
  const unusable = values.filter((value) => !value.usable).length;

  const toggle = (index: number) =>
    setChosen((held) => {
      const next = new Set(held);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const markShown = (on: boolean) =>
    setChosen((held) => {
      const next = new Set(held);
      for (const { index, value } of entries) {
        if (!value.usable) continue;
        if (on) next.add(index);
        else next.delete(index);
      }
      return next;
    });

  function apply() {
    if (chosen.size > 0) onApply([...chosen].sort((a, b) => a - b).map((index) => values[index].value));
  }

  return (
    <Dialog
      open
      size="md"
      title={copy.title(shownPart(column))}
      description={copy.description(rows, more)}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted" role="status">
            {copy.chosen(chosen.size)}
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="button" onClick={apply} disabled={chosen.size === 0}>
            {copy.apply}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            // O foco entra na busca: digitar já filtra a lista.
            autoFocus
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            aria-label={copy.search}
            aria-controls={listId}
            placeholder={copy.searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm text-ink outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-accent"
          />
          <Button type="button" variant="secondary" size="compact" className="h-8 px-2.5 text-xs" onClick={() => markShown(true)}>
            {copy.selectAll}
          </Button>
          <Button type="button" variant="secondary" size="compact" className="h-8 px-2.5 text-xs" onClick={() => markShown(false)}>
            {copy.selectNone}
          </Button>
        </div>

        <ul id={listId} aria-label={copy.list} className="max-h-80 overflow-y-auto rounded-md border border-border bg-background py-1">
          {entries.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{copy.noMatch}</li> : null}
          {entries.map(({ index, value }) => {
            const { text, special } = valueText(value.value);
            return (
              <li key={index}>
                <label title={text} className={cn("flex h-7 cursor-pointer items-center gap-2 px-3 text-sm hover:bg-selected", !value.usable && "cursor-not-allowed opacity-50")}>
                  <input type="checkbox" checked={chosen.has(index)} disabled={!value.usable} onChange={() => toggle(index)} className="size-3.5 flex-none accent-accent" />
                  <span className={cn("min-w-0 flex-1 truncate font-mono text-[13px]", special ? "text-muted italic" : "text-ink")}>{text}</span>
                  <span className="flex-none font-mono text-xs text-muted" aria-label={copy.countLabel(value.count)}>
                    {copy.count(value.count)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {total > entries.length ? <p className="text-xs text-muted">{copy.capped(entries.length, total)}</p> : null}
        {unusable > 0 ? <p className="text-xs text-muted">{copy.unusable(unusable)}</p> : null}
      </div>
    </Dialog>
  );
}
