import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils/cn";

import { tableViews, tabForKey } from "../../_lib/table-view";
import type { TableView } from "../../_lib/workbench-model";
import { workbenchCopy } from "../../_lib/workbench.copy";

const copy = workbenchCopy.tableTab;

/** Os ids ligam cada botão do seletor ao painel da vista, que o `aria-labelledby` aponta para o botão ativo. */
export const tableViewTabId = (tabId: string, view: TableView) => `table-view-${tabId}-${view}`;
export const tableViewPanelId = (tabId: string) => `table-view-panel-${tabId}`;

type TableViewTabsProps = {
  tabId: string;
  view: TableView;
  onChange: (view: TableView) => void;
};

/**
 * O seletor de vistas da aba de uma tabela (RN-TABELA-001): Registros, Estrutura e Diagrama, no
 * desenho do canvas (`TabelaDados`): um grupo de 28 px de altura com a vista ativa em destaque. É uma
 * lista de abas: as setas movem e escolhem, e só a vista ativa entra na ordem do Tab. Com uma vista
 * só não há o que escolher, e nada é desenhado.
 */
export function TableViewTabs({ tabId, view, onChange }: TableViewTabsProps) {
  if (tableViews.length < 2) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = tabForKey(tableViews, view, event.key);
    if (next === null) return;

    event.preventDefault();
    onChange(next);
    document.getElementById(tableViewTabId(tabId, next))?.focus();
  }

  return (
    <div role="tablist" aria-label={copy.viewsLabel} className="flex gap-1 rounded-lg border border-border bg-background p-[3px]">
      {tableViews.map((item) => {
        const selected = item === view;

        return (
          <button
            key={item}
            type="button"
            role="tab"
            id={tableViewTabId(tabId, item)}
            aria-selected={selected}
            aria-controls={tableViewPanelId(tabId)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item)}
            onKeyDown={handleKeyDown}
            className={cn("flex h-7 cursor-pointer items-center rounded-md px-3.5 transition-colors", selected ? "bg-selected font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {copy.views[item]}
          </button>
        );
      })}
    </div>
  );
}
