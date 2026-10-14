import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEvent } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

import type { GridZoom } from "@/app/settings/_lib/preferences";
import { ChevronIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { baseWidths, cellPadding, charWidth, fitWidth } from "../_lib/grid-columns";
import { moveCell, type GridCell } from "../_lib/grid-cursor";
import { copiesCell, savesEdits, type GridEditing, type RowMark } from "../_lib/grid-editing";
import { recordsCopy } from "../_lib/records.copy";
import { anchorOf, gridMetrics, scrollFor, wheelZoom, zoomIn, zoomOut, type ScrollAnchor } from "../_lib/grid-zoom";
import type { QueryColumn, QueryRow } from "../_lib/query.schema";
import { nearEnd } from "../_lib/result-paging";
import { observeRenderedOffset } from "../_lib/row-measure";
import type { ColumnLink } from "../_lib/foreign-key-links";
import { fitsFilter, type RecordsSort } from "../_lib/table-sql";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CellEditor } from "./cell-editor";
import { ColumnResizer } from "./column-resizer";

const copy = workbenchCopy.result;
const editCopy = recordsCopy.edit;

/** Sem largura escolhida: todas as colunas com a de saída. */
const noWidths: Readonly<Record<number, number>> = Object.freeze({});

/** A divisória fica à direita de cada célula, e do número da linha: preso à esquerda, ele não se confunde com a coluna que rola por baixo. */
const cellClass = "absolute top-0 h-full truncate border-r border-selected px-3";

type GridRowProps = {
  index: number;
  start: number;
  row: QueryRow;
  columns: QueryColumn[];
  virtualColumns: VirtualItem[];
  /** As colunas desta linha cujo valor chegou cortado (RN-SQL-011). */
  truncated: ReadonlySet<number> | undefined;
  /** RN-EDIT-009: as colunas desta linha que o banco preencheu num Salvar da aba de consulta, cujo valor a tela não sabe. */
  generated?: ReadonlySet<number>;
  /** O texto que representa o valor nulo (RN-CONFIG-005). */
  nullText: string;
  /** As colunas que são chave estrangeira, e para onde levam (RN-TABELA-007). Só a vista Registros passa. */
  links?: ReadonlyMap<number, ColumnLink>;
  /** Clicar no valor de uma chave estrangeira. Tem de ter identidade estável: a linha é memorizada. */
  onFollow?: (columnIndex: number, value: string) => void;
  /** Este valor pode virar link? Quem conhece o banco da conexão diz (o mesmo `sqlLiteral` do clique); sem isto, vale o que cabe numa linha de filtro. Identidade estável. */
  linkable?: (value: string) => boolean;
  /** O zoom como fator (RN-GRADE-010): só para saber se o valor cabe na coluna. A altura e os espaços vêm das variáveis da caixa da grade. */
  scale?: number;
  /** RN-EDIT-004: as pendências desta linha (células alteradas, exclusão, linha nova, a que falhou). Só a edição dos Registros passa. */
  mark?: RowMark;
  /** A coluna da célula ativa, quando ela é desta linha. */
  activeColumn?: number | null;
  /** O campo de edição aberto numa célula desta linha. */
  editor?: { column: number; element: ReactNode } | null;
  /** O id de cada célula, para `aria-activedescendant`: com ele a grade é editável (`gridcell`, a célula ativa marcada). Identidade estável. */
  cellIdOf?: (row: number, column: number) => string;
};

/**
 * Uma linha da grade. Memorizada: rolar na vertical ou carregar mais linhas não redesenha as que
 * já estavam na tela, porque a linha, a posição e as colunas à vista são os mesmos objetos. Os
 * valores entram como texto dos filhos do React, nunca como HTML (RN-SHELL-002). A altura da linha
 * e a largura do número dela são as variáveis do zoom (`--grid-row` e `--grid-gutter`, na caixa da grade).
 */
export const GridRow = memo(function GridRow({ index, start, row, columns, virtualColumns, truncated, generated, nullText, links, onFollow, linkable = fitsFilter, scale = 1, mark, activeColumn = null, editor = null, cellIdOf }: GridRowProps) {
  const role = cellIdOf === undefined ? "cell" : "gridcell";
  const deleted = mark?.deleted === true;

  return (
    <div role="row" aria-rowindex={index + 2} className={cn("group absolute top-0 left-0 h-(--grid-row) w-full border-b border-selected leading-(--grid-row) hover:bg-raised", mark?.failed && "bg-danger/15")} style={{ transform: `translateY(${start}px)` }}>
      <div
        role="rowheader"
        title={mark?.kind === "new" ? editCopy.newRowMark : deleted ? editCopy.deletedMark : undefined}
        className={cn("sticky left-0 z-10 h-full w-(--grid-gutter) border-r border-selected bg-panel px-2 text-right text-subtle group-hover:bg-raised", deleted && "line-through", mark?.failed && "font-semibold text-danger")}
      >
        {mark?.kind === "new" ? (
          <>
            <span aria-hidden className="font-semibold text-accent">
              +
            </span>
            <span className="sr-only">{editCopy.newRowMark}</span>
          </>
        ) : (
          index + 1
        )}
      </div>
      {virtualColumns.map((item) => {
        const value = row[item.index];
        const style = { left: item.start, width: item.size };
        const align = columns[item.index].kind === "number" ? " text-right" : "";
        // Só na grade editável: o id que a célula ativa anuncia, a posição que o clique lê e as marcas da pendência, da exclusão e da célula ativa.
        const cell = cellIdOf === undefined ? {} : { id: cellIdOf(index, item.index), "data-row": index, "data-col": item.index, "aria-selected": activeColumn === item.index };
        const marked = cn(activeColumn === item.index && "outline-2 -outline-offset-2 outline-accent", deleted && "text-subtle line-through");

        if (editor?.column === item.index) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} className="absolute top-0 z-30 h-full" style={{ left: item.start, width: Math.max(item.size, 220 * scale) }}>
              {editor.element}
            </div>
          );
        }

        // RN-EDIT-004: a célula alterada mostra o valor lido riscado ao lado do novo, como no canvas; na linha nova, só o que foi preenchido.
        if (mark?.pending.has(item.index) === true) {
          const next = mark.pending.get(item.index) ?? null;
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={mark.kind === "read" ? editCopy.pendingTitle(value ?? nullText) : undefined} className={cn(cellClass, align, "bg-accent/20", marked)} style={style}>
              {mark.kind === "read" ? <span className="mr-2 text-[length:calc(11px*var(--grid-zoom))] text-muted line-through">{value ?? nullText}</span> : null}
              {next === null ? <span className="text-subtle">{nullText}</span> : next}
            </div>
          );
        }

        // A coluna da linha nova que ninguém preencheu fica vazia: o banco põe o padrão da tabela.
        if (mark?.kind === "new") return <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} className={cn(cellClass, marked)} style={style} />;

        // RN-EDIT-009: o banco preencheu a coluna da linha nova salva, e o valor só vem executando de novo.
        if (generated?.has(item.index) === true) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={editCopy.generated} className={cn(`${cellClass} text-subtle italic`, marked)} style={style}>
              {editCopy.generated}
            </div>
          );
        }

        if (value === null) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} className={cn(`${cellClass}${align} text-subtle`, marked)} style={style}>
              {nullText}
            </div>
          );
        }

        if (truncated?.has(item.index)) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={copy.truncated} className={cn(`${cellClass} flex`, marked)} style={style}>
              {/* Sem as reticências do corte visual: a marca do valor cortado é a do fim, em cor de atenção. */}
              <span className={`min-w-0 flex-1 overflow-hidden${align}`}>{value}</span>
              <span className="flex-none font-semibold text-accent">…</span>
            </div>
          );
        }

        // O valor de uma chave estrangeira é um link para a tabela referenciada, filtrada por ele (RN-TABELA-007); o cortado e o que não cabe no filtro, não.
        const link = links?.get(item.index);
        if (link !== undefined && onFollow !== undefined && linkable(value)) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} className={cn(`${cellClass}${align}`, marked)} style={style}>
              <button
                type="button"
                onClick={() => onFollow(item.index, value)}
                title={copy.followTitle(link.table.name, link.column)}
                aria-label={copy.followLabel(link.table.name, link.column, value)}
                className="max-w-full cursor-pointer truncate text-left text-postgres underline underline-offset-[3px] hover:brightness-125"
              >
                {value}
              </button>
            </div>
          );
        }

        // O valor que não cabe na coluna aparece inteiro na dica. A coluna e o texto estão no zoom, e a conta também.
        const fits = value.length * charWidth * scale <= item.size - cellPadding * scale;
        return (
          <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={fits ? undefined : value} className={cn(`${cellClass}${align}`, marked)} style={style}>
            {value}
          </div>
        );
      })}
    </div>
  );
});

type GridHeaderCellProps = {
  column: QueryColumn;
  item: VirtualItem;
  /** A ordem em vigor, quando a grade ordena pelo cabeçalho (a vista Registros, RN-TABELA-005). */
  sort?: RecordsSort | null;
  /** Clicar no cabeçalho. Sem ele o cabeçalho é só texto, como no resultado de uma consulta. */
  onSort?: (column: QueryColumn) => void;
  /** A largura da coluna a 100% de zoom: a que a divisa mostra e de onde o arrasto parte (RN-GRADE-009). */
  width?: number;
  /** A última coluna: a divisa fica dentro dela. */
  last?: boolean;
  /** Mudar a largura pela divisa (arrastar, setas). Sem ele não há divisa. */
  onResize?: (width: number) => void;
  /** Ajustar a coluna ao conteúdo (o duplo clique na divisa). */
  onFit?: () => void;
  /** O tipo de dado ao lado do nome (`results.showColumnTypes`, RN-CONFIG-006). Desligado, só o nome. */
  showType?: boolean;
  /** O zoom como fator (RN-GRADE-010): o arrasto da divisa anda na escala dele. */
  scale?: number;
  /** RN-EDIT-002: por que a coluna não se edita (ou, numa junção, o que a editável altera), na dica do cabeçalho, quando o catálogo já respondeu. */
  hint?: string | null;
  /** RN-EDIT-002: a coluna não se edita, e o cabeçalho diz "somente leitura" depois do tipo, como no canvas (na aba de consulta). */
  readOnlyMark?: boolean;
};

/**
 * O cabeçalho de uma coluna: o nome e o tipo. Na vista Registros ele é um botão (RN-TABELA-005): clicar
 * ordena crescente, de novo decrescente, de novo tira a ordem; `aria-sort` e a dica dizem em que pé está.
 * À direita, nas duas grades, a divisa que muda a largura da coluna (RN-GRADE-009), irmã do botão: o clique
 * que termina um arrasto não ordena. O nome do cabeçalho para o leitor de tela é o da coluna e o tipo
 * (`aria-label`), e não o que se juntaria da divisa que mora dentro dele.
 */
export function GridHeaderCell({ column, item, sort, onSort, width = item.size, last = false, onResize, onFit, showType = true, scale = 1, hint = null, readOnlyMark = false }: GridHeaderCellProps) {
  // A largura de saída da coluna é contada sem a seta da ordem (`baseWidths`, em `grid-columns.ts`). Quando a seta aparece, quem cede os 18 px dela é o TIPO, e só ele: o nome não
  // encolhe (`shrink-0`), e o tipo absorve o que falta inteiro, até sumir. Não há peso de encolhimento entre os dois: com um peso, por maior que fosse o do tipo,
  // o nome ainda perdia centésimos de pixel, e com 1/64 de pixel a menos o Chromium já desenha a reticência (`cliente_id` virava `cliente_…`; antes disso o `id`
  // ordenado encolhia a zero e sobrava `integer ▲`: E1). A caixa do rótulo encolhe com a célula e fica ao lado da seta, que é irmã dela: `max-w-full` no nome é
  // "o que cabe já descontada a seta", e só o nome que nem sozinho cabe é cortado, com reticências, em vez de vazar para a coluna ao lado.
  const label = (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <span className="max-w-full shrink-0 truncate">{column.name}</span>
      {/* 11 px em 100%, no zoom da grade (RN-GRADE-010). */}
      {showType || readOnlyMark ? (
        <span className="min-w-0 truncate text-[length:calc(11px*var(--grid-zoom))] font-normal text-subtle">{showType && readOnlyMark ? `${column.type} · ${editCopy.readOnlyMark}` : showType ? column.type : editCopy.readOnlyMark}</span>
      ) : null}
    </span>
  );
  const align = column.kind === "number" ? " justify-end" : "";
  const position = { left: item.start, width: item.size };
  // O nome para o leitor de tela é o que se vê; a dica do cabeçalho só de texto diz o tipo mesmo com ele escondido.
  const name = `${showType ? `${column.name} ${column.type}` : column.name}${readOnlyMark ? `, ${editCopy.readOnlyMark}` : ""}`;
  const resizer = onResize === undefined ? null : <ColumnResizer name={column.name} width={width} zoom={scale} last={last} onResize={onResize} onFit={onFit ?? (() => {})} />;

  if (onSort === undefined) {
    return (
      <div role="columnheader" aria-colindex={item.index + 2} aria-label={name} title={hint === null ? `${column.name} · ${column.type}` : `${column.name} · ${column.type}\n${hint}`} className={`absolute top-0 flex h-full gap-1.5 border-r border-border px-3 whitespace-nowrap${align}`} style={position}>
        {label}
        {resizer}
      </div>
    );
  }

  const direction = sort?.column === column.name ? sort.direction : null;

  return (
    <div role="columnheader" aria-colindex={item.index + 2} aria-label={name} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"} className="absolute top-0 h-full border-r border-border whitespace-nowrap" style={position}>
      <button type="button" onClick={() => onSort(column)} title={hint === null ? copy.sortTitle(column.name, direction) : `${copy.sortTitle(column.name, direction)}\n${hint}`} className={`flex h-full w-full cursor-pointer items-center gap-1.5 px-3 text-left transition-colors hover:bg-selected${align}`}>
        {label}
        {direction === null ? null : <ChevronIcon className={cn("size-3 text-accent", direction === "asc" && "rotate-180")} />}
      </button>
      {resizer}
    </div>
  );
}

type ResultGridProps = {
  columns: QueryColumn[];
  rows: QueryRow[];
  truncated: ReadonlyMap<number, ReadonlySet<number>>;
  /** RN-EDIT-009: as colunas de cada linha nova salva na aba de consulta que o banco preencheu. */
  generated?: ReadonlyMap<number, ReadonlySet<number>>;
  /** O texto do valor nulo (`results.nullText`, RN-CONFIG-005). */
  nullText?: string;
  /**
   * Chamada quando a grade chega ao fim (ao rolar, e depois de cada página se o conteúdo ainda não passa da janela).
   * Só existe quando a busca automática está armada (`autoLoadArmed`): a grade não decide nada, só avisa. Tem de
   * ter identidade estável, para a grade memorizada não ser refeita à toa.
   */
  onReachEnd?: () => void;
  /** Ordenar pelo cabeçalho (RN-TABELA-005): só a vista Registros passa; no resultado de uma consulta a ordem é do `ORDER BY` da pessoa. */
  sort?: RecordsSort | null;
  onSort?: (column: QueryColumn) => void;
  /** As chaves estrangeiras da tabela (RN-TABELA-007): o valor das colunas que elas cobrem leva à tabela referenciada. Só a vista Registros passa. */
  links?: ReadonlyMap<number, ColumnLink>;
  onFollow?: (columnIndex: number, value: string) => void;
  linkable?: (value: string) => boolean;
  /**
   * As larguras que a pessoa escolheu, por posição da coluna, a 100% de zoom (RN-GRADE-009). Quem as guarda é a área de resultado, que não é refeita a cada
   * execução: valem enquanto as colunas forem as mesmas. A coluna sem largura escolhida tem a de saída.
   */
  widths?: Readonly<Record<number, number>>;
  /** Mudar a largura de uma coluna (a divisa do cabeçalho). Sem ele não há divisa. Identidade estável: a grade é memorizada. */
  onResize?: (index: number, width: number) => void;
  /**
   * O tipo de dado no cabeçalho (`results.showColumnTypes`, RN-CONFIG-006). Trocar a preferência vale na hora: as larguras de saída são contadas de novo
   * (sem o tipo a coluna não reserva lugar para ele), e as escolhidas ficam.
   */
  showTypes?: boolean;
  /** O zoom da grade (`results.gridZoom`, RN-GRADE-010); sem ele, 100%. */
  zoom?: GridZoom;
  /** Ctrl+roda do mouse sobre a grade pede outro zoom. Identidade estável: a grade é memorizada. */
  onZoom?: (zoom: GridZoom) => void;
  /** RN-EDIT-001 a 004: a edição das células (Registros e aba de consulta). Com ela a grade é editável (`grid`), com as linhas novas depois das lidas. */
  editing?: GridEditing;
};

/** A caixa que rola tem caixa? Escondida por `display: none` (a aba inativa, a área de trabalho por baixo de outra tela), o que se lê dela não é posição. */
const hasBox = (element: HTMLElement) => element.clientHeight > 0 || element.clientWidth > 0;

/**
 * A grade do resultado (RN-SQL-011 e 012), virtualizada nas duas direções: só as linhas e as
 * colunas à vista existem na página, com 200 linhas ou com 10.000. O cabeçalho fica preso no topo
 * e o número da linha à esquerda. Quem a usa dá uma `key` por execução: as larguras de saída são
 * contadas uma vez, da primeira página, e "carregar mais" só aumenta a altura rolável. As escolhidas
 * pela pessoa (`widths`) passam por cima delas.
 */
export const ResultGrid = memo(function ResultGrid({ columns, rows: read, truncated, generated, nullText = copy.null, onReachEnd, sort, onSort, links, onFollow, linkable, widths: chosen = noWidths, onResize, showTypes = true, zoom = 100, onZoom, editing }: ResultGridProps) {
  const scroll = useRef<HTMLDivElement>(null);
  // As linhas que a grade desenha: com a edição, as lidas e, depois delas, as novas.
  const rows = editing?.rows ?? read;
  const gridId = useId();
  const cellIdOf = useCallback((row: number, column: number) => `${gridId}-${row}-${column}`, [gridId]);
  // A primeira página é a que conta para a largura de saída: carregar mais não muda o que está na tela.
  const [firstPage] = useState(read);
  // RN-EDIT-002: a marca "somente leitura" do cabeçalho cabe na largura de saída quando o catálogo responde (na aba de consulta).
  const readOnly = editing?.columnReadOnly ?? null;
  const marks = useMemo(() => readOnly?.map((marked) => (marked ? editCopy.readOnlyMark : null)) ?? null, [readOnly]);
  const base = useMemo(() => baseWidths(columns, firstPage, nullText, showTypes, marks), [columns, firstPage, nullText, showTypes, marks]);
  const widths = useMemo(() => base.map((width, index) => chosen[index] ?? width), [base, chosen]);
  // O zoom (RN-GRADE-010) muda juntos o texto, a altura das linhas, o número da linha, as larguras (as escolhidas também, na mesma proporção) e os espaços.
  // As larguras guardadas são as de 100%; o que se desenha é a conta delas no zoom, em pixels inteiros.
  const metrics = useMemo(() => gridMetrics(zoom), [zoom]);
  const drawn = useMemo(() => widths.map(metrics.width), [widths, metrics]);

  // A grade fica escondida por `display: none` com a aba inativa e com a área de trabalho por baixo de outra tela: a rolagem lida sem caixa não é posição
  // (`observeRenderedOffset`, nas duas direções), senão quem rola e troca de aba logo em seguida volta para uma grade em branco. As linhas e as colunas não são
  // medidas (altura fixa e largura contada): não há `measureElement` aqui.
  // A altura estimada da linha é a do zoom (a de verdade, porque nada é medido), e o cabeçalho preso no topo é o `paddingStart`, da mesma altura.
  // eslint-disable-next-line react-hooks/incompatible-library -- o virtualizador devolve funções que não se memorizam; nada aqui depende disso.
  const rowVirtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => metrics.rowHeight, overscan: 6, paddingStart: metrics.rowHeight, observeElementOffset: observeRenderedOffset });
  const columnVirtualizer = useVirtualizer({ horizontal: true, count: columns.length, getScrollElement: () => scroll.current, estimateSize: (index) => drawn[index], overscan: 2, paddingStart: metrics.gutterWidth, observeElementOffset: observeRenderedOffset });
  const virtualColumns = columnVirtualizer.getVirtualItems();

  // Uma largura mudou (a divisa, o zoom, o tipo no cabeçalho), ou a altura da linha (o zoom): o virtualizador só relê `estimateSize` quando lhe pedem, e
  // `measure` refaz as posições antes de a tela ser pintada (o efeito de layout redesenha na mesma hora). Sem isto as colunas da direita ficariam na posição
  // de antes, encavaladas ou com uma faixa vazia. Nada é medido no DOM: a largura é a contada ou a escolhida, e a altura é a do zoom.
  const measured = useRef({ drawn, rowHeight: metrics.rowHeight });
  useLayoutEffect(() => {
    const before = measured.current;
    measured.current = { drawn, rowHeight: metrics.rowHeight };
    if (before.drawn !== drawn) columnVirtualizer.measure();
    if (before.rowHeight !== metrics.rowHeight) rowVirtualizer.measure();
  }, [drawn, metrics, columnVirtualizer, rowVirtualizer]);

  // Trocar o zoom com a grade rolada mantém à vista a mesma linha do topo (e, na horizontal, o mesmo ponto): a rolagem é lida em linhas a cada evento
  // (`anchorOf`), e no zoom novo volta a ela (`scrollFor`), antes de a tela ser pintada. Lida e posta só com a caixa à vista: escondida, a grade espera
  // reaparecer (a lista volta a ser desenhada, e este efeito roda de novo) para pôr a rolagem no zoom que vale.
  const anchor = useRef<ScrollAnchor>({ row: 0, left: 0, zoom });
  useLayoutEffect(() => {
    const element = scroll.current;
    if (element === null || anchor.current.zoom === zoom || !hasBox(element)) return;

    anchor.current = { ...anchor.current, zoom };
    const { top, left } = scrollFor(anchor.current, zoom);
    element.scrollTop = top;
    element.scrollLeft = left;
  });

  // Ctrl+roda sobre a grade muda o zoom, e não rola nem amplia a página: precisa de `preventDefault`, e o React registra `wheel` como passivo.
  const zoomNow = useRef(zoom);
  useEffect(() => {
    zoomNow.current = zoom;
  }, [zoom]);
  useEffect(() => {
    const element = scroll.current;
    if (element === null || onZoom === undefined) return;

    let rest = 0;
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const step = wheelZoom(rest, event.deltaY, event.deltaMode);
      rest = step.rest;
      if (step.direction !== 0) onZoom?.((step.direction > 0 ? zoomIn : zoomOut)(zoomNow.current));
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onZoom]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    // A rolagem que o zoom preserva; não com a caixa escondida, nem antes de o zoom novo ter posto a rolagem dele.
    if (hasBox(element) && anchor.current.zoom === zoom) anchor.current = anchorOf({ top: element.scrollTop, left: element.scrollLeft }, zoom);
    if (onReachEnd !== undefined && nearEnd(element)) onReachEnd();
  }

  // As medidas do zoom para o CSS da grade: a linha e o número da linha em pixels inteiros, e o fator que escala o texto (o tamanho de `text-sm`) e os
  // espaços (`--spacing`, de que o Tailwind tira `px-3`, `gap-1.5`, `size-3`…). Em 100% cada valor é, número por número, o de antes do zoom.
  const zoomStyle = {
    "--grid-row": `${metrics.rowHeight}px`,
    "--grid-gutter": `${metrics.gutterWidth}px`,
    "--grid-zoom": String(metrics.factor),
    "--spacing": `calc(0.25rem * ${metrics.factor})`,
    fontSize: `calc(var(--text-sm) * ${metrics.factor})`,
    lineHeight: `calc(var(--text-sm--line-height) * ${metrics.factor})`,
  } as CSSProperties;

  // A célula ativa fica à vista quando muda: a linha nova entra depois das lidas, e o "Nova linha" a ativa lá no fim.
  const activeRow = editing?.active?.row ?? null;
  const activeColumn = editing?.active?.column ?? null;
  useEffect(() => {
    if (activeRow === null || activeColumn === null) return;
    rowVirtualizer.scrollToIndex(activeRow);
    columnVirtualizer.scrollToIndex(activeColumn);
  }, [activeRow, activeColumn, rowVirtualizer, columnVirtualizer]);

  // Fechar o campo de edição devolve o foco à grade, para as setas e o F2 seguirem dali; não o rouba de quem o levou para outro lugar.
  const editorOpen = editing?.editor != null;
  const wasOpen = useRef(editorOpen);
  useEffect(() => {
    const element = scroll.current;
    if (wasOpen.current && !editorOpen && element !== null && (document.activeElement === document.body || element.contains(document.activeElement))) element.focus({ preventScroll: true });
    wasOpen.current = editorOpen;
  }, [editorOpen]);

  /** A célula do evento, pela posição que ela leva (`data-row`, `data-col`), ou nula fora de uma. */
  function cellOf(target: EventTarget): GridCell | null {
    const element = target instanceof Element ? target.closest<HTMLElement>("[data-col]") : null;
    if (element === null || scroll.current?.contains(element) !== true) return null;
    return { row: Number(element.dataset.row), column: Number(element.dataset.col) };
  }

  const editingAt = (cell: GridCell) => editing?.editor?.row === cell.row && editing.editor.column === cell.column;

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    const cell = editing === undefined || event.button !== 0 ? null : cellOf(event.target);
    if (cell !== null && !editingAt(cell)) editing!.onActivate(cell);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const cell = editing === undefined ? null : cellOf(event.target);
    if (cell !== null && !editingAt(cell)) editing!.onEdit(cell);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (editing === undefined) return;
    // O menu do sistema nunca abre sobre a grade editável; o da célula, só sobre uma célula (a tecla de menu solta cai na grade, e é ignorada).
    event.preventDefault();
    const cell = cellOf(event.target);
    if (cell === null || editingAt(cell)) return;
    editing.onActivate(cell);
    editing.onMenu(cell, { x: event.clientX, y: event.clientY }, false);
  }

  /** O pé da célula, onde o menu aberto pelo teclado aparece; sem ela na página, o canto da grade. */
  function pointOf(cell: GridCell): { x: number; y: number } {
    const rect = (document.getElementById(cellIdOf(cell.row, cell.column)) ?? scroll.current)?.getBoundingClientRect();
    return rect === undefined ? { x: 0, y: 0 } : { x: rect.left, y: rect.bottom };
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editing === undefined || editing.editor !== null || event.target !== event.currentTarget) return;

    if (savesEdits(event, editing.pending)) {
      event.preventDefault();
      editing.onSave();
      return;
    }
    if (event.altKey && event.key === "Insert") {
      event.preventDefault();
      editing.onNewRow();
      return;
    }

    const moved = moveCell(editing.active, event.key, { rows: rows.length, columns: columns.length }, event.ctrlKey || event.metaKey);
    if (moved !== null) {
      event.preventDefault();
      editing.onActivate(moved);
      return;
    }

    const active = editing.active;
    if (active === null) return;
    if (copiesCell(event)) {
      // RN-SQL-017: a célula cortada é copiada com o valor completo, que a edição busca na API.
      event.preventDefault();
      editing.onCopy(active);
    } else if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault();
      editing.onEdit(active);
    } else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      editing.onMenu(active, pointOf(active), true);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Começar a digitar abre o campo com o que foi digitado, no lugar do valor.
      event.preventDefault();
      editing.onEdit(active, event.key);
    }
  }

  const editor = editing?.editor ?? null;
  const editorElement =
    editor === null ? null : (
      <CellEditor
        label={editCopy.editorLabel(columns[editor.column]?.name ?? "", editor.row < read.length ? editCopy.rowLabel(editor.row + 1) : editCopy.newRowMark)}
        draft={editor.draft}
        number={columns[editor.column]?.kind === "number"}
        onDraft={editing!.onDraft}
        onCommit={editing!.onCommit}
        onCancel={editing!.onCancel}
      />
    );
  const activeId = editing?.active == null ? undefined : cellIdOf(editing.active.row, editing.active.column);

  // Uma página que não chega a encher a janela não tem o que rolar: a seguinte vem sem a pessoa pedir.
  useEffect(() => {
    const element = scroll.current;
    if (element !== null && onReachEnd !== undefined && nearEnd(element)) onReachEnd();
  }, [rows.length, onReachEnd]);

  return (
    <div
      ref={scroll}
      role={editing === undefined ? "table" : "grid"}
      aria-label={copy.grid}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + 1}
      aria-activedescendant={activeId}
      tabIndex={0}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      className="min-h-0 flex-1 overflow-auto font-mono text-sm -outline-offset-2"
      style={zoomStyle}
    >
      <div className="relative min-w-full" style={{ height: rowVirtualizer.getTotalSize(), width: columnVirtualizer.getTotalSize() }}>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-20 h-(--grid-row) w-full border-b border-border bg-raised leading-(--grid-row) font-semibold">
          <div role="columnheader" className="sticky left-0 z-10 h-full w-(--grid-gutter) border-r border-border bg-raised px-2 text-right font-medium text-subtle">
            {copy.rowNumber}
          </div>
          {virtualColumns.map((item) => (
            <GridHeaderCell
              key={item.index}
              column={columns[item.index]}
              item={item}
              sort={sort}
              onSort={onSort}
              width={widths[item.index]}
              last={item.index === columns.length - 1}
              showType={showTypes}
              scale={metrics.factor}
              hint={editing?.columnHints?.[item.index] ?? null}
              readOnlyMark={editing?.columnReadOnly?.[item.index] === true}
              onResize={onResize === undefined ? undefined : (width) => onResize(item.index, width)}
              // O ajuste olha TODAS as linhas carregadas, e não só a primeira página (RN-GRADE-009).
              onFit={onResize === undefined ? undefined : () => onResize(item.index, fitWidth(columns[item.index], item.index, rows, nullText, { sortable: onSort !== undefined, showType: showTypes, mark: marks?.[item.index] ?? null }))}
            />
          ))}
        </div>

        {rowVirtualizer.getVirtualItems().map((item) => (
          <GridRow
            key={item.index}
            index={item.index}
            start={item.start}
            row={rows[item.index]}
            columns={columns}
            virtualColumns={virtualColumns}
            truncated={truncated.get(item.index)}
            generated={generated?.get(item.index)}
            nullText={nullText}
            links={links}
            onFollow={onFollow}
            linkable={linkable}
            scale={metrics.factor}
            mark={editing?.marks.get(item.index)}
            activeColumn={editing?.active?.row === item.index ? editing.active.column : null}
            editor={editor?.row === item.index ? { column: editor.column, element: editorElement } : null}
            cellIdOf={editing === undefined ? undefined : cellIdOf}
          />
        ))}
      </div>
    </div>
  );
});
