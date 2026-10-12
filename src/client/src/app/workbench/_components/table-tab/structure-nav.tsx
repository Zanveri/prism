import type { KeyboardEvent, Ref } from "react";

import { navItem } from "@/components/ui";

import type { EntryMark, StructureSection } from "../../_lib/structure-sections";
import { tabForKey, type TabOrientation } from "../../_lib/table-view";
import { workbenchCopy } from "../../_lib/workbench.copy";

const text = workbenchCopy.tableTab.structure;

/**
 * Os ids ligam cada entrada da lista ao painel da seção, que o `aria-labelledby` aponta para a entrada escolhida (como `table-view-tabs.tsx`). O `idBase` é de
 * cada Estrutura montada (`useId`): as abas de tabela ficam todas montadas, e ids fixos fariam o painel de uma ser nomeado pela entrada da outra.
 */
export const structureTabId = (idBase: string, section: StructureSection) => `${idBase}-tab-${section}`;
export const structurePanelId = (idBase: string) => `${idBase}-panel`;

/** Uma entrada da lista: a seção, o nome dela e o que a entrada mostra à direita do nome. */
export type NavEntry = { id: StructureSection; label: string; mark: EntryMark };

type StructureNavProps = {
  idBase: string;
  entries: readonly NavEntry[];
  /** A seção escolhida: a única entrada selecionada e a única que entra no Tab. */
  selected: StructureSection;
  onSelect: (section: StructureSection) => void;
  /**
   * Como a pessoa vê a lista: em coluna ao lado da seção (`vertical`, o padrão) ou em fileira no topo dela, com o painel estreito (`horizontal`). É o
   * `aria-orientation` e dá as setas que valem. Quem decide o desenho é o CSS (consulta de contêiner); `useNavOrientation` lê o que ele decidiu.
   */
  orientation?: TabOrientation;
  /** O elemento da lista: `useNavOrientation` o observa. */
  ref?: Ref<HTMLDivElement>;
};

/** A contagem de itens da seção, ou a marca de aviso (com texto para o leitor de tela) quando a lista dela falhou. Sem marca, nada. */
function Mark({ mark }: { mark: EntryMark }) {
  if (mark.kind === "none") return null;
  if (mark.kind === "count") return <span className="flex-none text-xs font-normal text-muted tabular-nums">{mark.count}</span>;

  return (
    <span className="flex flex-none items-center">
      <span aria-hidden="true" className="inline-flex size-[18px] items-center justify-center rounded-full border border-danger text-[11px] leading-none font-semibold text-danger">
        !
      </span>
      <span className="sr-only">{text.sections.failed}</span>
    </span>
  );
}

/**
 * A lista lateral de seções da Estrutura (RN-TABELA-009), como a do DBeaver: uma lista de abas, vertical ao lado da seção. As setas para cima e para baixo
 * escolhem a seção e levam o foco a ela, com a volta nas pontas; Home e End vão à primeira e à última; só a escolhida entra no Tab. É a mesma `tabForKey` do
 * seletor de vistas, na orientação da lista. A entrada escolhida tem o estilo da escolhida na lista de Configurações (`navItem`). Vem das entradas que
 * recebe: seção nova entra na lista de `structure-sections.ts` e aparece aqui sem redesenho.
 *
 * Com o painel estreito (menos de `@4xl` de contêiner, 56 rem) a lista vira uma fileira no topo da Estrutura, e não uma coluna que tirasse 200 px da tabela da
 * seção: é a consulta de contêiner das classes, e a largura limite está só aqui e na raiz da Estrutura. A orientação segue o desenho (`orientation`): na
 * fileira valem esquerda e direita. Se nem a fileira cabe, as entradas passam para outra linha, e a lista nunca rola na horizontal.
 */
export function StructureNav({ idBase, entries, selected, onSelect, orientation = "vertical", ref }: StructureNavProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, from: StructureSection) {
    const next = tabForKey(
      entries.map((entry) => entry.id),
      from,
      event.key,
      orientation,
    );
    if (next === null) return;

    event.preventDefault();
    onSelect(next);
    document.getElementById(structureTabId(idBase, next))?.focus();
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation={orientation}
      aria-label={text.sections.label}
      className="flex flex-none flex-row flex-wrap gap-1 border-b border-border bg-panel px-3 py-2 @4xl:w-[200px] @4xl:flex-col @4xl:flex-nowrap @4xl:gap-0.5 @4xl:overflow-y-auto @4xl:border-r @4xl:border-b-0 @4xl:p-2"
    >
      {entries.map((entry) => {
        const active = entry.id === selected;

        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={structureTabId(idBase, entry.id)}
            aria-selected={active}
            aria-controls={structurePanelId(idBase)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(entry.id)}
            onKeyDown={(event) => handleKeyDown(event, entry.id)}
            className={navItem({ active })}
          >
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <Mark mark={entry.mark} />
          </button>
        );
      })}
    </div>
  );
}
