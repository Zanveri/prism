import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEvent } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

import type { GridZoom } from "@/app/settings/_lib/preferences";
import { ArrowDownIcon, ArrowsUpDownIcon, ArrowUpIcon, useHost } from "@/components/ui";
import { isElement } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";
import { isMacPlatform } from "@/lib/utils/platform";

import { baseWidths, cellPadding, charWidth, fitWidth } from "../_lib/grid-columns";
import { movementOf, moveCell, type GridCell } from "../_lib/grid-cursor";
import { copiesAdvanced, copiesCell, deletesRows, filterKey, rowShortcut, savesEdits, selectsAll, selectsColumns, selectsRows, type GridEditing, type RowMark } from "../_lib/grid-editing";
import { cellAtPoint, columnStarts, edgeScroll, pageRows, type GridBox } from "../_lib/grid-pointer";
import { choseWholeColumns, choseWholeRows, collapse, dragColumns, dragRows, escapeCollapses, extend, extendByKey, extendColumns, extendRows, headerChosen, rowSpan, select, selectAll, selectColumn, selectRow, toggleColumn, toggleRow, wholeColumns, wholeColumnSet, wholeRows } from "../_lib/grid-selection";
import { gridSelectionCopy } from "../_lib/grid-selection.copy";
import { multiEditCopy } from "../_lib/multi-edit.copy";
import type { EditValue } from "../_lib/record-edits";
import { recordsCopy } from "../_lib/records.copy";
import { anchorOf, gridMetrics, scrollFor, wheelZoom, zoomIn, zoomOut, type ScrollAnchor } from "../_lib/grid-zoom";
import type { QueryColumn, QueryRow } from "../_lib/query.schema";
import { nearEnd } from "../_lib/result-paging";
import { observeRenderedOffset } from "../_lib/row-measure";
import type { ColumnLink } from "../_lib/foreign-key-links";
import { fitsFilter, type SortDirection } from "../_lib/table-sql";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CellEditor } from "./cell-editor";
import { ColumnResizer } from "./column-resizer";

const copy = workbenchCopy.result;
const editCopy = recordsCopy.edit;

/** A plataforma, para os atalhos da linha (RN-EDIT-015): no macOS o Option faz o papel do Alt e o Cmd o do Ctrl. */
const platform = typeof navigator === "undefined" ? "" : navigator.platform;
/** No macOS, o Ctrl+clique abre o menu do sistema: quem acrescenta linhas à seleção é o Cmd+clique (RN-GRADE-001). */
const mac = isMacPlatform(platform);

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
  /** RN-GRADE-001: as colunas escolhidas nesta linha, de `selectedFrom` a `selectedTo` (-1 sem nenhuma). Números, para a linha memorizada comparar. */
  selectedFrom?: number;
  selectedTo?: number;
  /**
   * RN-GRADE-022: as colunas inteiras escolhidas, o MESMO conjunto para todas as linhas enquanto a seleção não muda (a linha memorizada não é redesenhada por
   * ele); nulo com outra forma. O número da linha não fica destacado por elas: nenhuma linha está escolhida inteira.
   */
  wholeColumns?: ReadonlySet<number> | null;
  /**
   * RN-EDIT-018: as alterações da coluna inteira pendentes, o MESMO mapa para todas as linhas enquanto as pendências não mudam: na linha lida que não está
   * marcada para exclusão, a célula daquela coluna mostra o valor novo, com o lido riscado ao lado; a que tem pendência própria mostra o dela, com o da coluna
   * inteira riscado.
   */
  columnPending?: ReadonlyMap<number, { value: EditValue; hint: string; uncertain: boolean }> | null;
};

/**
 * Uma linha da grade. Memorizada: rolar na vertical ou carregar mais linhas não redesenha as que
 * já estavam na tela, porque a linha, a posição e as colunas à vista são os mesmos objetos. Os
 * valores entram como texto dos filhos do React, nunca como HTML (RN-SHELL-002). A altura da linha
 * e a largura do número dela são as variáveis do zoom (`--grid-row` e `--grid-gutter`, na caixa da grade).
 */
export const GridRow = memo(function GridRow({ index, start, row, columns, virtualColumns, truncated, generated, nullText, links, onFollow, linkable = fitsFilter, scale = 1, mark, activeColumn = null, editor = null, cellIdOf, selectedFrom = -1, selectedTo = -1, wholeColumns = null, columnPending = null }: GridRowProps) {
  const role = cellIdOf === undefined ? "cell" : "gridcell";
  const deleted = mark?.deleted === true;
  const rowChosen = selectedFrom >= 0;

  return (
    // A linha com o campo de edição aberto fica por cima das outras (cada linha é um contexto de empilhamento, pelo `transform`): a dica do campo
    // (RN-EDIT-017) passa por cima da linha de baixo, e continua por baixo do cabeçalho preso.
    <div role="row" aria-rowindex={index + 2} className={cn("group absolute top-0 left-0 h-(--grid-row) w-full border-b border-selected leading-(--grid-row) hover:bg-raised", mark?.failed && "bg-danger/15", editor !== null && "z-[15]")} style={{ transform: `translateY(${start}px)` }}>
      <div
        role="rowheader"
        // Só na grade editável: a posição que o clique, o arraste e o botão direito no número da linha leem (RN-GRADE-001).
        {...(cellIdOf === undefined ? {} : { "data-rowheader": index })}
        title={mark?.kind === "new" ? editCopy.newRowMark : deleted ? editCopy.deletedMark : undefined}
        className={cn("sticky left-0 z-10 h-full w-(--grid-gutter) border-r border-selected bg-panel px-2 text-right text-subtle group-hover:bg-raised", rowChosen && "bg-selected font-semibold text-ink group-hover:bg-selected", deleted && "line-through", mark?.failed && "font-semibold text-danger")}
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
        // Só na grade editável: o id que a célula ativa anuncia, a posição que o clique lê, se a célula está escolhida (RN-GRADE-001) e as marcas da
        // pendência, da exclusão e da célula ativa. A escolhida tem o fundo de escolha do tema, o do item escolhido do navegador.
        const chosen = (rowChosen && item.index >= selectedFrom && item.index <= selectedTo) || wholeColumns?.has(item.index) === true;
        const cell = cellIdOf === undefined ? {} : { id: cellIdOf(index, item.index), "data-row": index, "data-col": item.index, "aria-selected": chosen };
        const marked = cn(chosen && "bg-selected", activeColumn === item.index && "outline-2 -outline-offset-2 outline-accent", deleted && "text-subtle line-through");

        if (editor?.column === item.index) {
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} className="absolute top-0 z-30 h-full" style={{ left: item.start, width: Math.max(item.size, 220 * scale) }}>
              {editor.element}
            </div>
          );
        }

        // RN-EDIT-018: a coluna inteira pendente vale na linha lida que não está marcada para exclusão; a referência da célula passa a ser o valor dela.
        const whole = mark?.kind === "new" || deleted ? undefined : columnPending?.get(item.index);

        // RN-EDIT-004: a célula alterada mostra o valor lido riscado ao lado do novo, como no canvas; na linha nova, só o que foi preenchido. Sob a coluna inteira,
        // o riscado é o valor dela (RN-EDIT-018).
        if (mark?.pending.has(item.index) === true) {
          const next = mark.pending.get(item.index) ?? null;
          const struck = whole === undefined ? value : whole.value;
          const title = mark.kind !== "read" ? undefined : whole === undefined ? editCopy.pendingTitle(value ?? nullText) : multiEditCopy.ownTitle(whole.value ?? nullText);
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={title} className={cn(cellClass, align, "bg-accent/20", marked, chosen && "bg-accent/35")} style={style}>
              {mark.kind === "read" ? <span className="mr-2 text-[length:calc(11px*var(--grid-zoom))] text-muted line-through">{struck ?? nullText}</span> : null}
              {next === null ? <span className="text-subtle">{nullText}</span> : next}
            </div>
          );
        }

        if (whole !== undefined) {
          const title = whole.uncertain ? `${multiEditCopy.wholeTitle(value ?? nullText)}\n${multiEditCopy.uncertain}` : multiEditCopy.wholeTitle(value ?? nullText);
          return (
            <div key={item.index} role={role} aria-colindex={item.index + 2} {...cell} title={title} className={cn(cellClass, align, "bg-accent/20", marked, chosen && "bg-accent/35")} style={style}>
              <span className="mr-2 text-[length:calc(11px*var(--grid-zoom))] text-muted line-through">{value ?? nullText}</span>
              {whole.value === null ? <span className="text-subtle">{nullText}</span> : whole.value}
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

/** RN-GRADE-021: o botão de ordenar de uma coluna: a ordem dela (nula sem ordem, ou com a ordem de outra coluna), o motivo de ele não valer e o clique. */
export type HeaderSortButton = { direction: SortDirection | null; reason: string | null; onSort: () => void };

type GridHeaderCellProps = {
  column: QueryColumn;
  item: VirtualItem;
  /**
   * RN-GRADE-021: o botão de ordenar, à direita do nome, com o espaço dele sempre reservado. Sem ele não há botão, e o nome ocupa o cabeçalho todo (as abas
   * guardadas do script, que não ordenam; o resultado sem a edição).
   */
  sort?: HeaderSortButton;
  /**
   * RN-GRADE-021 e 022: o nome é o botão que escolhe a coluna inteira (na grade editável), fora do Tab; o clique, o Shift, o Ctrl, o arraste e o botão direito
   * nele são lidos pela grade, por delegação (`data-colheader`). Sem ele, o nome é só texto.
   */
  choosable?: boolean;
  /** O clique no nome que chega sem ponteiro (o leitor de tela que aciona o botão): escolhe a coluna, como o `mousedown` da grade faria. */
  onChoose?: () => void;
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
  /** RN-GRADE-001: a coluna está na seleção, e o cabeçalho fica destacado. */
  selected?: boolean;
  /** RN-GRADE-022: a coluna está escolhida inteira: o `columnheader` diz `aria-selected`. */
  whole?: boolean;
  /** O macOS escreve o atalho do Ctrl+Espaço como Control+Espaço. */
  mac?: boolean;
  /** RN-EDIT-018: a coluna tem uma alteração pendente em todas as linhas: um ponto no tom de atenção ao lado do nome, com a dica ("… preco = 10.00"). */
  pendingHint?: string | null;
};

/** A seta do botão de ordenar: para cima na crescente, para baixo na decrescente, e as duas, no tom apagado, sem ordem (RN-GRADE-021). */
function SortArrow({ direction }: { direction: SortDirection | null }) {
  if (direction === "asc") return <ArrowUpIcon className="text-accent" />;
  if (direction === "desc") return <ArrowDownIcon className="text-accent" />;
  return <ArrowsUpDownIcon className="text-subtle" />;
}

/**
 * O cabeçalho de uma coluna (RN-GRADE-021): o `columnheader`, com o `aria-sort` dela quando a grade ordena, e duas partes lado a lado, mais a divisa da
 * largura (RN-GRADE-009), que continua irmã delas, na borda direita: o clique que termina um arrasto não chega ao nome.
 *
 * 1. O nome (e o tipo, quando a configuração o mostra): na grade editável, um botão fora do Tab que escolhe a coluna inteira (RN-GRADE-022). O clique, o
 *    arraste e o botão direito nele são da grade (`data-colheader`); o `mousedown` é cancelado lá, e o foco fica na grade. O clique que chega sem ponteiro (o
 *    leitor de tela que aciona o botão) também escolhe, por `onChoose`.
 * 2. O botão de ordenar, de 24 px, com a seta de 16 px, que termina antes da área da divisa. O espaço dele fica sempre reservado: o botão fica à vista na
 *    coluna que ordena e, nas outras, com o ponteiro sobre o cabeçalho; escondido, não recebe o clique, e o clique no espaço dele escolhe a coluna (o espaço
 *    também é `data-colheader`). Desabilitado, é `aria-disabled`, com o motivo na dica e no nome.
 *
 * O nome do cabeçalho para o leitor de tela é o da coluna e o tipo (`aria-label`), e não o que se juntaria dos botões e da divisa que moram dentro dele.
 */
export function GridHeaderCell({ column, item, sort, choosable = false, onChoose, width = item.size, last = false, onResize, onFit, showType = true, scale = 1, hint = null, readOnlyMark = false, selected = false, whole = false, mac = false, pendingHint = null }: GridHeaderCellProps) {
  const describedBy = useId();
  // A largura de saída da coluna é contada sem o botão de ordenar (`baseWidths`, em `grid-columns.ts`). O espaço dele é sempre reservado, e quem cede os px
  // dele é o TIPO, e só ele: o nome não encolhe (`shrink-0`), e o tipo absorve o que falta inteiro, até sumir. Não há peso de encolhimento entre os dois: com
  // um peso, por maior que fosse o do tipo, o nome ainda perdia centésimos de pixel, e com 1/64 de pixel a menos o Chromium já desenha a reticência
  // (`cliente_id` virava `cliente_…`: E1). A caixa do rótulo encolhe com a célula e fica ao lado do botão, que é irmão dela: `max-w-full` no nome é "o que
  // cabe já descontado o botão", e só o nome que nem sozinho cabe é cortado, com reticências, em vez de vazar para a coluna ao lado.
  const label = (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {pendingHint === null ? null : <span aria-hidden data-column-pending className="size-[calc(6px*var(--grid-zoom))] flex-none rounded-full bg-accent" />}
      <span className="max-w-full shrink-0 truncate">{column.name}</span>
      {/* 11 px em 100%, no zoom da grade (RN-GRADE-010). */}
      {showType || readOnlyMark ? (
        <span className="min-w-0 truncate text-[length:calc(11px*var(--grid-zoom))] font-normal text-subtle">{showType && readOnlyMark ? `${column.type} · ${editCopy.readOnlyMark}` : showType ? column.type : editCopy.readOnlyMark}</span>
      ) : null}
    </span>
  );
  const align = column.kind === "number" ? " justify-end" : "";
  const position = { left: item.start, width: item.size };
  // O nome para o leitor de tela é o que se vê; a dica do cabeçalho diz o tipo mesmo com ele escondido.
  const name = `${showType ? `${column.name} ${column.type}` : column.name}${readOnlyMark ? `, ${editCopy.readOnlyMark}` : ""}${pendingHint === null ? "" : `, ${multiEditCopy.headerMark}`}`;
  const about = [`${column.name} · ${column.type}`, hint, pendingHint].filter((part) => part !== null).join("\n");
  const resizer = onResize === undefined ? null : <ColumnResizer name={column.name} width={width} zoom={scale} last={last} onResize={onResize} onFit={onFit ?? (() => {})} />;
  const direction = sort?.direction ?? null;
  const ariaSort = sort === undefined ? {} : { "aria-sort": direction === "asc" ? ("ascending" as const) : direction === "desc" ? ("descending" as const) : ("none" as const) };
  const header = cn("group/header absolute top-0 flex h-full border-r border-border whitespace-nowrap", selected && "bg-selected text-ink");

  if (!choosable && sort === undefined) {
    return (
      <div role="columnheader" aria-colindex={item.index + 2} aria-label={name} title={about} className={cn(header, `gap-1.5 px-3${align}`)} style={position}>
        {label}
        {resizer}
      </div>
    );
  }

  const sortTitle = sort === undefined ? null : copy.sortTitle(column.name, direction);
  const sortLabel = sortTitle === null || sort === undefined ? null : sort.reason === null ? sortTitle : copy.sortUnavailable(sortTitle, sort.reason);
  // A dica do nome é a de antes (o nome, o tipo e o motivo da coluna que não se edita), e o que o clique faz.
  const nameTitle = choosable ? `${about}\n${copy.chooseColumnHint(mac)}` : about;
  const nameClass = cn("flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 text-left", sort === undefined && "pr-3", align);

  return (
    <div role="columnheader" aria-colindex={item.index + 2} aria-label={name} {...ariaSort} {...(whole ? { "aria-selected": true } : {})} className={header} style={position}>
      {choosable ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            data-colheader={item.index}
            aria-label={column.name}
            aria-describedby={describedBy}
            title={nameTitle}
            onClick={(event) => {
              // O clique do ponteiro já escolheu no `mousedown` (`detail` 1 em diante); o do leitor de tela chega sem ele.
              if (event.detail === 0) onChoose?.();
            }}
            className={cn(nameClass, "cursor-pointer transition-colors hover:bg-selected")}
          >
            {label}
          </button>
          <span id={describedBy} className="sr-only">
            {copy.chooseColumn}
          </span>
        </>
      ) : (
        <span title={nameTitle} className={nameClass}>
          {label}
        </span>
      )}
      {sort === undefined || sortLabel === null ? null : (
        // O espaço do botão, sempre reservado; escondido o botão, o clique aqui escolhe a coluna, como no nome. Termina antes da área da divisa.
        <span data-colheader={choosable ? item.index : undefined} className={cn("flex h-full w-6 flex-none items-center justify-center", last ? "mr-[8px]" : "mr-[4px]")}>
          <button
            type="button"
            tabIndex={-1}
            data-sort
            aria-label={sortLabel}
            aria-disabled={sort.reason !== null || undefined}
            title={sortLabel}
            // O clique no botão não tira o foco da grade (RN-GRADE-021): as teclas dela seguem valendo logo depois.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (sort.reason === null) sort.onSort();
            }}
            className={cn("flex h-full w-6 cursor-pointer items-center justify-center rounded-sm hover:bg-selected aria-disabled:cursor-not-allowed aria-disabled:opacity-50", direction === null && "invisible group-hover/header:visible")}
          >
            <SortArrow direction={direction} />
          </button>
        </span>
      )}
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
/**
 * A grade rola na vertical até a célula ativa que mudou (RN-GRADE-001), menos quando ela ficou na linha em que o gesto no nome da coluna a deixou
 * (RN-GRADE-021 e 022: o nome escolhe a coluna sem levar a grade de volta à linha da ativa); o campo de edição aberto a traz à vista sempre.
 */
export function followsActiveRow(row: number, heldRow: number | null, editorOpen: boolean): boolean {
  return editorOpen || row !== heldRow;
}

export const ResultGrid = memo(function ResultGrid({ columns, rows: read, truncated, generated, nullText = copy.null, onReachEnd, links, onFollow, linkable, widths: chosen = noWidths, onResize, showTypes = true, zoom = 100, onZoom, editing }: ResultGridProps) {
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
  // O cabeçalho e o número da linha, presos, cobrem o começo da caixa: o `scrollPaddingStart` do mesmo tamanho faz o `scrollToIndex` deixar a célula ativa
  // logo depois deles, e não por baixo (RN-GRADE-001: a grade rola para manter a célula ativa à vista, também no Ctrl+Home, no PageUp e no Home).
  // RN-ABAS-017: a área de resultado muda de página quando vai para a janela do resultado (ou volta). O virtualizador guarda a janela do elemento de rolagem
  // (`ownerDocument.defaultView`) quando o liga, e o `ResizeObserver` dela com ela: o de outra janela não avisaria o tamanho. Ao mudar de página ele é desligado e
  // ligado de novo na mesma passada, antes de pintar, e passa a observar pela janela de agora.
  const hostDocument = useHost().document;
  const [observedDocument, setObservedDocument] = useState(hostDocument);
  const observing = observedDocument === hostDocument;
  useLayoutEffect(() => {
    if (!observing) setObservedDocument(hostDocument);
  }, [observing, hostDocument]);
  // eslint-disable-next-line react-hooks/incompatible-library -- o virtualizador devolve funções que não se memorizam; nada aqui depende disso.
  const rowVirtualizer = useVirtualizer({ enabled: observing, count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => metrics.rowHeight, overscan: 6, paddingStart: metrics.rowHeight, scrollPaddingStart: metrics.rowHeight, observeElementOffset: observeRenderedOffset });
  const columnVirtualizer = useVirtualizer({ enabled: observing, horizontal: true, count: columns.length, getScrollElement: () => scroll.current, estimateSize: (index) => drawn[index], overscan: 2, paddingStart: metrics.gutterWidth, scrollPaddingStart: metrics.gutterWidth, observeElementOffset: observeRenderedOffset });
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

  // A célula ativa fica à vista quando muda: a linha nova entra depois das lidas, e "Adicionar linha" a ativa lá no fim. RN-GRADE-021 e 022: o gesto no nome
  // da coluna leva a ativa para ela, na linha em que estava (na primeira, sem ativa), e a grade não rola na vertical por isso: a pessoa escolhe a coluna pelo
  // cabeçalho preso, rolada até onde lia. `heldRow` é a linha da ativa no gesto do cabeçalho; o teclado e o clique numa célula ou no número a soltam, e o
  // campo que abre traz a ativa à vista (`followsActiveRow`).
  const activeRow = editing?.active?.row ?? null;
  const activeColumn = editing?.active?.column ?? null;
  const editorOpen = editing?.editor != null;
  const heldRow = useRef<number | null>(null);
  useEffect(() => {
    if (activeRow === null || activeColumn === null) {
      heldRow.current = null;
      return;
    }
    if (followsActiveRow(activeRow, heldRow.current, editorOpen)) rowVirtualizer.scrollToIndex(activeRow);
    columnVirtualizer.scrollToIndex(activeColumn);
  }, [activeRow, activeColumn, editorOpen, rowVirtualizer, columnVirtualizer]);

  // Fechar o campo de edição devolve o foco à grade, para as setas e o F2 seguirem dali; não o rouba de quem o levou para outro lugar.
  const wasOpen = useRef(editorOpen);
  useEffect(() => {
    const element = scroll.current;
    const page = element?.ownerDocument;
    if (wasOpen.current && !editorOpen && element != null && page != null && (page.activeElement === page.body || element.contains(page.activeElement))) element.focus({ preventScroll: true });
    wasOpen.current = editorOpen;
  }, [editorOpen]);

  /** A célula do evento, pela posição que ela leva (`data-row`, `data-col`), ou nula fora de uma. */
  function cellOf(target: EventTarget): GridCell | null {
    const element = isElement(target) ? target.closest<HTMLElement>("[data-col]") : null;
    if (element === null || scroll.current?.contains(element) !== true) return null;
    return { row: Number(element.dataset.row), column: Number(element.dataset.col) };
  }

  const editingAt = (cell: GridCell) => editing?.editor?.row === cell.row && editing.editor.column === cell.column;

  /** O número da linha do evento (`data-rowheader`, RN-GRADE-001), ou nulo fora de um. */
  function rowHeaderOf(target: EventTarget): number | null {
    const element = isElement(target) ? target.closest<HTMLElement>("[data-rowheader]") : null;
    if (element === null || scroll.current?.contains(element) !== true) return null;
    return Number(element.dataset.rowheader);
  }

  // O que o arraste lê a cada passo, da renderização de agora, e não da do clique: com "buscar mais linhas ao rolar", a rolagem sozinha passa do fim e traz a
  // página seguinte no meio dele, e a célula sob o ponteiro entra nas linhas novas; o zoom e as larguras também podem mudar.
  const starts = useMemo(() => columnStarts(drawn), [drawn]);
  const geometry = useRef({ count: rows.length, drawn, starts, metrics });
  useLayoutEffect(() => {
    geometry.current = { count: rows.length, drawn, starts, metrics };
  });

  /** A caixa que rola, na janela, com a rolagem e as medidas do zoom: o arraste acha a célula sob o ponteiro por ela (`cellAtPoint`). */
  function boxOf(element: HTMLDivElement): GridBox {
    const rect = element.getBoundingClientRect();
    const { metrics: now } = geometry.current;
    return { left: rect.left, top: rect.top, width: element.clientWidth, height: element.clientHeight, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop, rowHeight: now.rowHeight, gutterWidth: now.gutterWidth };
  }

  // RN-GRADE-001: o arraste com o botão esquerdo, a partir de uma célula ou do número da linha. O ponteiro é seguido na janela, também fora da grade, até o
  // botão soltar; passado da borda, a grade rola sozinha, e a célula da borda entra. A contagem da barra espera o botão soltar (`onSelecting`).
  const drag = useRef<(() => void) | null>(null);
  useEffect(() => () => drag.current?.(), []);
  // `mode`: o arraste numa célula (o retângulo), no número da linha (as linhas: só a vertical conta e rola) ou no nome da coluna (as colunas inteiras,
  // RN-GRADE-022: só a horizontal conta e rola, também na grade sem linhas).
  function startDrag(onCell: (cell: GridCell) => void, mode: "cells" | "rows" | "columns", from: GridCell) {
    const element = scroll.current;
    if (element === null || editing === undefined) return;
    drag.current?.();
    const keyOf = (cell: GridCell) => (mode === "rows" ? `${cell.row}` : mode === "columns" ? `${cell.column}` : `${cell.row}:${cell.column}`);
    let last = keyOf(from);
    let pointer: { x: number; y: number } | null = null;
    const follow = () => {
      const now = geometry.current;
      const cell = pointer === null ? null : cellAtPoint(pointer, boxOf(element), now.starts, now.drawn, mode === "columns" ? Math.max(now.count, 1) : now.count);
      if (cell === null || keyOf(cell) === last) return;
      last = keyOf(cell);
      onCell(cell);
    };
    const move = (event: globalThis.MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      follow();
    };
    const timer = setInterval(() => {
      if (pointer === null) return;
      const { dx, dy } = edgeScroll(pointer, boxOf(element), mode !== "columns", mode !== "rows");
      if (dx === 0 && dy === 0) return;
      element.scrollTop += dy;
      element.scrollLeft += dx;
      follow();
    }, 50);
    const settled = editing.onSelecting;
    // RN-ABAS-017: o ponteiro é seguido na janela do elemento (a da aba ou a do resultado), e não na da tela que desenha.
    const view = element.ownerDocument.defaultView ?? window;
    const stop = () => {
      clearInterval(timer);
      view.removeEventListener("mousemove", move);
      view.removeEventListener("mouseup", stop);
      if (drag.current === stop) drag.current = null;
      settled(false);
    };
    view.addEventListener("mousemove", move);
    view.addEventListener("mouseup", stop);
    drag.current = stop;
    settled(true);
  }

  /** O nome da coluna do evento (`data-colheader`, RN-GRADE-021), ou nulo fora de um. */
  function columnHeaderOf(target: EventTarget): number | null {
    const element = isElement(target) ? target.closest<HTMLElement>("[data-colheader]") : null;
    if (element === null || scroll.current?.contains(element) !== true) return null;
    return Number(element.dataset.colheader);
  }

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (editing === undefined) return;
    const column = columnHeaderOf(event.target);
    // RN-GRADE-021: no nome da coluna, nenhum botão do mouse tira o foco da grade. O direito (e o do meio) também tem o `mousedown` cancelado: o nome é um
    // botão, e o menu devolve o foco a quem o tinha quando abriu. O foco vem para a grade, como no botão direito numa célula.
    if (column !== null && event.button !== 0) {
      event.preventDefault();
      scroll.current?.focus({ preventScroll: true });
      return;
    }
    if (event.button !== 0) return;
    // RN-GRADE-021: o botão de ordenar age no clique dele; o `mousedown` só é cancelado, e o foco fica na grade.
    if (isElement(event.target) && event.target.closest("[data-sort]") !== null) return void event.preventDefault();
    heldRow.current = column === null ? null : (editing.active?.row ?? 0);
    if (column !== null) {
      // RN-GRADE-022: o clique no nome escolhe a coluna inteira; Shift estende da coluna da âncora; Ctrl (Cmd no macOS) acrescenta ou tira, e o arraste com
      // ele junta. O `mousedown` é cancelado, como o do canto: o foco fica na grade, e o teclado dela age logo depois.
      event.preventDefault();
      scroll.current?.focus({ preventScroll: true });
      const base = editing.selection;
      const toggles = mac ? event.metaKey : event.ctrlKey;
      if (event.shiftKey) editing.onSelection((held, grid) => extendColumns(held, column, grid));
      else if (toggles) editing.onSelection((held, grid) => toggleColumn(held, column, grid));
      else editing.onSelection((held, grid) => selectColumn(held, column, grid));
      if (!event.shiftKey) startDrag((target) => editing.onSelection((_, grid) => dragColumns(base, column, target.column, grid, toggles)), "columns", { row: 0, column });
      return;
    }
    const header = rowHeaderOf(event.target);
    const cell = header === null ? cellOf(event.target) : null;
    if (header === null && (cell === null || editingAt(cell))) return;
    // O arraste não escolhe o texto da página; o foco vem para a grade, que o `preventDefault` tiraria.
    event.preventDefault();
    scroll.current?.focus({ preventScroll: true });

    if (header !== null) {
      // RN-GRADE-001: o clique no número escolhe a linha inteira; Shift estende da âncora; Ctrl (Cmd no macOS) acrescenta ou tira, e o arraste com ele junta.
      const base = editing.selection;
      const toggles = mac ? event.metaKey : event.ctrlKey;
      if (event.shiftKey) editing.onSelection((held, grid) => extendRows(held, header, grid));
      else if (toggles) editing.onSelection((held, grid) => toggleRow(held, header, grid));
      else editing.onSelection((held, grid) => selectRow(held, header, grid));
      if (!event.shiftKey) startDrag((target) => editing.onSelection((_, grid) => dragRows(base, header, target.row, grid, toggles)), "rows", { row: header, column: 0 });
      return;
    }

    // O clique escolhe a célula (o Ctrl+clique também: vários retângulos ficam para depois); Shift estende o retângulo da âncora até ela; arrastar estende até a
    // que está sob o ponteiro.
    if (event.shiftKey) editing.onSelection((held, grid) => extend(held, cell!, grid));
    else editing.onActivate(cell!);
    startDrag((target) => editing.onSelection((held, grid) => extend(held, target, grid)), "cells", cell!);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const cell = editing === undefined ? null : cellOf(event.target);
    if (cell !== null && !editingAt(cell)) editing!.onEdit(cell);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (editing === undefined) return;
    // O menu do sistema nunca abre sobre a grade editável; o da grade, só sobre uma célula ou o número da linha (a tecla de menu solta cai na grade, e é ignorada).
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const header = rowHeaderOf(event.target);
    const column = header === null ? columnHeaderOf(event.target) : null;
    heldRow.current = column === null ? null : (editing.active?.row ?? 0);
    if (header !== null) return editing.onRowMenu(header, point);
    // RN-GRADE-021: o botão direito no nome da coluna (e no espaço do botão de ordenar) escolhe antes a coluna inteira, quando ela não está entre as escolhidas.
    if (column !== null) return editing.onColumnMenu(column, point);
    const cell = cellOf(event.target);
    if (cell === null || editingAt(cell)) return;
    // Fora da seleção, a célula é escolhida antes; dentro dela, a seleção fica (RN-GRADE-004).
    editing.onMenu(cell, point, false);
  }

  /** O pé da célula, onde o menu aberto pelo teclado aparece; sem ela na página, o canto da grade. */
  function pointOf(cell: GridCell): { x: number; y: number } {
    const rect = ((scroll.current?.ownerDocument ?? document).getElementById(cellIdOf(cell.row, cell.column)) ?? scroll.current)?.getBoundingClientRect();
    return rect === undefined ? { x: 0, y: 0 } : { x: rect.left, y: rect.bottom };
  }

  /** RN-GRADE-001: o clique no canto da grade escolhe todas as linhas, como o Ctrl+A; o foco fica na grade, que tem uma parada só do Tab. */
  function chooseAll() {
    if (editing === undefined) return;
    editing.onSelection((held, grid) => selectAll(held, grid));
    scroll.current?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    heldRow.current = null;
    if (editing === undefined || editing.editor !== null || event.target !== event.currentTarget) return;

    if (savesEdits(event, editing.pending)) {
      event.preventDefault();
      editing.onSave();
      return;
    }
    // RN-EDIT-015: Alt+Insert adiciona, Ctrl+Alt+Insert duplica e Alt+Delete exclui as linhas da seleção, com os modificadores exatos.
    const row = rowShortcut(event, platform);
    if (row !== null) {
      event.preventDefault();
      if (row === "newRow") editing.onNewRow();
      else if (row === "duplicateRow") editing.onDuplicateRow();
      else editing.onDeleteRow();
      return;
    }
    // RN-EDIT-015: o Delete sozinho exclui as linhas inteiras escolhidas, e só elas; com um retângulo, colunas inteiras ou só a célula ativa, a tecla não faz nada.
    if (deletesRows(event, platform)) {
      if (choseWholeRows(editing.selection, editing.layout)) {
        event.preventDefault();
        editing.onDeleteRows();
      }
      return;
    }

    // RN-GRADE-001: as setas, Home, End, PageUp e PageDown movem a célula ativa, e a seleção passa a ser ela; com Shift, estendem. O PageUp e o PageDown com
    // Ctrl, Alt ou Cmd não são da grade (`movementOf`), e seguem para a barra de abas.
    const movement = movementOf(event);
    if (movement !== null) {
      const element = scroll.current;
      const page = element === null ? 1 : pageRows({ height: element.clientHeight, rowHeight: metrics.rowHeight });
      const moved = moveCell(editing.active, movement.key, { rows: rows.length, columns: columns.length, page }, movement.ctrl);
      if (moved === null) return;
      event.preventDefault();
      if (movement.extend) {
        editing.onSelecting(true);
        editing.onSelection((held, grid) => extendByKey(held, moved, grid, movement.vertical));
      } else editing.onSelection((held, grid) => select(held, moved, grid));
      return;
    }
    if (selectsAll(event)) {
      event.preventDefault();
      editing.onSelection((held, grid) => selectAll(held, grid));
      return;
    }
    if (event.key === "Escape" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && escapeCollapses(editing.selection)) {
      event.preventDefault();
      editing.onSelection((held) => collapse(held));
      return;
    }
    // Shift+Espaço escolhe as linhas inteiras: não abre o campo com um espaço (RN-EDIT-001).
    if (selectsRows(event)) {
      event.preventDefault();
      editing.onSelection((held) => wholeRows(held));
      return;
    }
    // RN-GRADE-022: Ctrl+Espaço (Control+Espaço no macOS) escolhe as colunas inteiras das células escolhidas; também não abre o campo.
    if (selectsColumns(event)) {
      event.preventDefault();
      editing.onSelection((held, grid) => wholeColumns(held, grid));
      return;
    }

    const active = editing.active;
    if (active === null) return;
    if (copiesCell(event)) {
      // RN-GRADE-002 e RN-SQL-017: a seleção, com o valor completo das células cortadas, que a edição busca na API.
      event.preventDefault();
      editing.onCopy();
    } else if (copiesAdvanced(event)) {
      // RN-GRADE-003: o "Copiar avançado…", quando a grade o tem.
      if (editing.onCopyAdvanced === undefined) return;
      event.preventDefault();
      editing.onCopyAdvanced();
    } else if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault();
      editing.onEdit(active);
    } else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      editing.onMenu(active, pointOf(active), true);
    } else if (filterKey(event) !== null && editing.onFilter !== undefined) {
      // RN-GRADE-013: F11 abre o submenu na célula ativa, e Ctrl+F11 o "Filtrar por valor…".
      event.preventDefault();
      editing.onFilter(active, pointOf(active), filterKey(event)!);
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
        key={`${editor.row}:${editor.column}`}
        typed={editor.touched === true}
        label={editCopy.editorLabel(columns[editor.column]?.name ?? "", editor.row < read.length ? editCopy.rowLabel(editor.row + 1) : editCopy.newRowMark)}
        draft={editor.draft}
        hint={editor.hint ?? null}
        number={columns[editor.column]?.kind === "number"}
        onDraft={editing!.onDraft}
        onCommit={editing!.onCommit}
        onCancel={editing!.onCancel}
      />
    );
  const activeId = editing?.active == null ? undefined : cellIdOf(editing.active.row, editing.active.column);
  // RN-GRADE-022: as colunas inteiras escolhidas, um conjunto só para todas as linhas à vista enquanto a seleção não muda.
  const selection = editing?.selection;
  const layout = editing?.layout;
  const whole = useMemo(() => (selection === undefined || layout === undefined ? null : wholeColumnSet(selection, layout)), [selection, layout]);
  const wholeChosen = selection !== undefined && choseWholeColumns(selection);
  // RN-GRADE-021: o botão de ordenar de cada coluna, pela ordem aplicada e pelo motivo de agora; o clique segue o ciclo dela (quem decide é a edição).
  const sorting = editing?.sort;
  const sortOf = (name: string) =>
    sorting === undefined ? undefined : { direction: sorting.applied?.column === name ? sorting.applied.direction : null, reason: sorting.reason, onSort: () => sorting.onSort(name) };

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
      aria-multiselectable={editing === undefined ? undefined : true}
      tabIndex={0}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onKeyUp={editing === undefined ? undefined : () => editing.onSelecting(false)}
      className="min-h-0 flex-1 overflow-auto font-mono text-sm -outline-offset-2"
      style={zoomStyle}
    >
      <div className="relative min-w-full" style={{ height: rowVirtualizer.getTotalSize(), width: columnVirtualizer.getTotalSize() }}>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-20 h-(--grid-row) w-full border-b border-border bg-raised leading-(--grid-row) font-semibold">
          <div role="columnheader" className="sticky left-0 z-10 h-full w-(--grid-gutter) border-r border-border bg-raised text-right font-medium text-subtle">
            {editing === undefined ? (
              <span className="block px-2">{copy.rowNumber}</span>
            ) : (
              // RN-GRADE-001: o canto escolhe todas as linhas, como o Ctrl+A; fora do caminho do Tab, porque a grade tem uma parada só.
              <button type="button" tabIndex={-1} aria-label={gridSelectionCopy.selectAll} title={gridSelectionCopy.selectAll} onMouseDown={(event) => event.preventDefault()} onClick={chooseAll} className="h-full w-full cursor-pointer px-2 text-right hover:bg-selected">
                {copy.rowNumber}
              </button>
            )}
          </div>
          {virtualColumns.map((item) => (
            <GridHeaderCell
              key={item.index}
              column={columns[item.index]}
              item={item}
              sort={sortOf(columns[item.index].name)}
              choosable={editing !== undefined}
              onChoose={editing === undefined ? undefined : () => editing.onSelection((held, grid) => selectColumn(held, item.index, grid))}
              width={widths[item.index]}
              last={item.index === columns.length - 1}
              showType={showTypes}
              scale={metrics.factor}
              hint={editing?.columnHints?.[item.index] ?? null}
              readOnlyMark={editing?.columnReadOnly?.[item.index] === true}
              selected={editing !== undefined && headerChosen(editing.selection, editing.layout, item.index)}
              whole={wholeChosen && whole?.has(item.index) === true}
              mac={mac}
              pendingHint={editing?.columnPending?.get(item.index)?.hint ?? null}
              onResize={onResize === undefined ? undefined : (width) => onResize(item.index, width)}
              // O ajuste olha TODAS as linhas carregadas, e não só a primeira página (RN-GRADE-009), e reserva o espaço do botão de ordenar.
              onFit={onResize === undefined ? undefined : () => onResize(item.index, fitWidth(columns[item.index], item.index, rows, nullText, { sortable: sorting !== undefined, showType: showTypes, mark: marks?.[item.index] ?? null }))}
            />
          ))}
        </div>

        {rowVirtualizer.getVirtualItems().map((item) => {
          const span = editing === undefined ? null : rowSpan(editing.selection, editing.layout, item.index);
          return (
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
              selectedFrom={span?.[0] ?? -1}
              selectedTo={span?.[1] ?? -1}
              wholeColumns={whole}
              columnPending={editing?.columnPending ?? null}
            />
          );
        })}
      </div>
    </div>
  );
});
