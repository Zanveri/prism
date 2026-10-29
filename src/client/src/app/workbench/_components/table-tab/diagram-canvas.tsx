import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { fontStack } from "@/app/settings/_lib/fonts";
import { defaultPreferences, type Preferences } from "@/app/settings/_lib/preferences";
import { Button, PlusIcon, RefreshIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { exportDiagramMermaid, exportDiagramPng, resolveDiagramStyle, toMermaidErDiagram } from "../../_lib/diagram-export";
import { connectedToTable, filterDiagramLayout, type ColumnsMode } from "../../_lib/schema-diagram";
import {
  clampZoom,
  diagramMetrics,
  fitText,
  fitTitle,
  fitZoom,
  maxZoom,
  minZoom,
  opensNeighbor,
  settleActions,
  zoomIn,
  zoomLabel,
  zoomOut,
  type DiagramBox,
  type DiagramColumn,
  type DiagramEdge,
  type DiagramLayout,
  type TableRef,
} from "../../_lib/table-diagram";
import type { DiagramMemory } from "../../_lib/tab-memory";
import { workbenchCopy } from "../../_lib/workbench.copy";

const copy = workbenchCopy.tableTab.diagram;

/** O respiro de cima e de baixo da caixa, e o de dentro dos lados: o do canvas (`DiagramaER`). */
const boxPaddingY = 12;
const textX = 16;

/** O menos do zoom; o mais é o `PlusIcon` do conjunto. Mesmo traço dos outros ícones (16×16, 1,5). */
function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M3 8h10" />
    </svg>
  );
}

/** As quatro setas do modo de mover pelo diagrama com o botão esquerdo do mouse (estilo Mermaid no VS Code). */
function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M2 8h12" />
      <path d="M8 2v12" />
      <path d="M6 4l2-2 2 2" />
      <path d="M6 12l2 2 2-2" />
      <path d="M4 6l-2 2 2 2" />
      <path d="M12 6l2 2-2 2" />
    </svg>
  );
}

/** O botão direito (`2`) sempre arrasta o diagrama; o botão esquerdo (`0`) arrasta quando a trava das 4 setas está ativa. */
export function shouldStartDiagramPan(button: number, panLocked: boolean): boolean {
  return button === 2 || (button === 0 && panLocked);
}

/** Calcula a nova posição de rolagem ao arrastar o diagrama com o mouse. */
export function applyDiagramPan(
  origin: { scrollLeft: number; scrollTop: number; startX: number; startY: number },
  point: { clientX: number; clientY: number },
): { scrollLeft: number; scrollTop: number; moved: boolean } {
  const dx = point.clientX - origin.startX;
  const dy = point.clientY - origin.startY;
  return {
    scrollLeft: Math.max(0, origin.scrollLeft - dx),
    scrollTop: Math.max(0, origin.scrollTop - dy),
    moved: Math.abs(dx) > 2 || Math.abs(dy) > 2,
  };
}

const iconButton = "flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

/** Uma linha de coluna da caixa: nome, tipo e as marcas de chave. O que não cabe encurta, e a dica traz o texto inteiro. */
function ColumnRow({
  column,
  y,
  rowHeight,
  boxWidth,
  maxChars,
  onStartConnect,
}: {
  column: DiagramColumn;
  y: number;
  rowHeight?: number;
  boxWidth?: number;
  maxChars?: number;
  onStartConnect?: (columnName: string, event: ReactPointerEvent<SVGTextElement>) => void;
}) {
  const marks = [column.primaryKey ? "PK" : null, column.foreignKey ? "FK" : null].filter((mark) => mark !== null);
  const fitted = fitText(column.name, column.type, marks.length === 0 ? null : marks.join(" "), maxChars);
  const isAdded = column.state === "added";
  const isRemoved = column.state === "removed";

  return (
    <>
      {isAdded && boxWidth !== undefined && rowHeight !== undefined ? (
        <rect x={2} y={y - rowHeight / 2} width={boxWidth - 4} height={rowHeight} className="fill-success/10" />
      ) : null}
      <text
        x={textX}
        y={y}
        dominantBaseline="central"
        onPointerDown={onStartConnect ? (event) => onStartConnect(column.name, event) : undefined}
        className={cn("fill-body font-mono text-[13px]", isRemoved && "line-through opacity-60", onStartConnect && "cursor-crosshair")}
        style={{ fontSize: "inherit", fontFamily: "inherit" }}
      >
        {fitted.cut ? <title>{`${column.name} ${column.type}`}</title> : null}
        {isAdded ? <tspan className="fill-success font-semibold">+ </tspan> : null}
        <tspan>{fitted.name}</tspan>
        <tspan dx="8" className="fill-subtle">
          {fitted.type}
        </tspan>
        {column.primaryKey ? (
          <tspan dx="8" className="fill-accent font-semibold">
            PK
          </tspan>
        ) : null}
        {column.foreignKey ? (
          <tspan dx="8" className="fill-postgres font-semibold">
            FK
          </tspan>
        ) : null}
      </text>
    </>
  );
}

type TableBoxProps = {
  box: DiagramBox;
  rowHeight: number;
  maxChars: number;
  dimmed?: boolean;
  selected?: boolean;
  onSelect?: (key: string) => void;
  onStartMove?: (box: DiagramBox, event: ReactPointerEvent<SVGElement>) => void;
  onStartConnect?: (box: DiagramBox, columnName: string, event: ReactPointerEvent<SVGTextElement>) => void;
  onDropConnect?: (targetKey: string) => void;
  onOpen: (ref: TableRef) => void;
};

/**
 * Uma tabela do desenho: o contorno, o nome e as colunas. A do centro tem o contorno no acento. As
 * vizinhas abrem a aba delas com duplo clique, Enter ou Espaço (como um botão). O foco por teclado usa o anel do app
 * (`:focus-visible` em `globals.css`) e, além dele, o contorno da caixa no acento.
 */
function TableBox({ box, rowHeight, maxChars, dimmed = false, selected = false, onSelect, onStartMove, onStartConnect, onDropConnect, onOpen }: TableBoxProps) {
  const title = box.title ?? box.ref.name;
  const highlighted = box.center || selected;
  const boxMaxChars = box.width === 264 ? maxChars : Math.max(maxChars, Math.floor((maxChars * (box.width - 40)) / (264 - 32)));
  const fittedTitle = fitTitle(title, boxMaxChars - 1);
  const dashed = box.external || box.variant === "existing";
  const body = (
    <>
      <rect
        width={box.width}
        height={box.height}
        rx="6"
        strokeDasharray={dashed ? "4 3" : undefined}
        onPointerDown={onStartMove ? (event) => onStartMove(box, event) : undefined}
        className={cn(
          "fill-panel",
          highlighted ? "stroke-accent" : "stroke-border-strong group-hover:stroke-subtle group-focus-visible:stroke-accent",
          onStartMove && "cursor-move",
        )}
        strokeWidth="1"
      />
      <text
        x={textX}
        y={boxPaddingY + rowHeight / 2}
        dominantBaseline="central"
        onPointerDown={onStartMove ? (event) => onStartMove(box, event) : undefined}
        className={cn("fill-ink font-mono text-[13px] font-semibold", box.dropped && "line-through", onStartMove && "cursor-move")}
        style={{ fontSize: "inherit", fontFamily: "inherit" }}
      >
        {fittedTitle.cut ? <title>{title}</title> : null}
        {fittedTitle.text}
        {box.badge ? (
          <tspan dx="6" className="fill-warning text-[11px] font-normal">
            {box.badge}
          </tspan>
        ) : null}
      </text>
      {box.warning ? (
        <circle
          cx={box.width - 14}
          cy={boxPaddingY + rowHeight / 2}
          r="4"
          className={box.warning === "error" ? "fill-danger" : "fill-warning"}
        />
      ) : null}
      {box.columns?.map((column, index) => (
        <ColumnRow
          key={column.name}
          column={column}
          y={boxPaddingY + rowHeight * (index + 1) + rowHeight / 2}
          rowHeight={rowHeight}
          boxWidth={box.width}
          maxChars={boxMaxChars}
          onStartConnect={onStartConnect ? (colName, event) => onStartConnect(box, colName, event) : undefined}
        />
      ))}
    </>
  );

  if (box.center) {
    return (
      <g transform={`translate(${box.x} ${box.y})`} role="group" aria-label={title} className={dimmed ? "opacity-30 transition-opacity" : undefined}>
        {body}
      </g>
    );
  }

  function handleKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (!opensNeighbor(event.key)) return;
    // O Espaço também rolaria a área do diagrama.
    event.preventDefault();
    onOpen(box.ref);
  }

  return (
    <g
      transform={`translate(${box.x} ${box.y})`}
      role="button"
      tabIndex={0}
      aria-label={copy.open(title)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect ? () => onSelect(box.key) : undefined}
      onPointerUp={onDropConnect ? () => onDropConnect(box.key) : undefined}
      onDoubleClick={() => onOpen(box.ref)}
      onKeyDown={handleKeyDown}
      className={cn("group cursor-pointer", dimmed && "opacity-30 transition-opacity", box.dropped && "opacity-50")}
    >
      <title>{copy.openHint}</title>
      {body}
    </g>
  );
}

/** A linha de uma chave estrangeira, com a seta na ponta da tabela referenciada. A dica diz a chave e as colunas. */
function Edge({ edge, marker, dimmed = false }: { edge: DiagramEdge; marker: string; dimmed?: boolean }) {
  const points = edge.points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <g className={dimmed ? "opacity-25 transition-opacity" : undefined}>
      <title>{edge.label}</title>
      <polyline points={points} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${marker})`} className="stroke-postgres" />
      {/* Uma faixa larga e invisível: a linha de 2 px é difícil de acertar para ler a dica. */}
      <polyline points={points} fill="none" stroke="transparent" strokeWidth="12" />
    </g>
  );
}

type DiagramCanvasProps = {
  layout: DiagramLayout;
  /** O esquema (ou nome do banco) exibido no cabeçalho, e quantas tabelas e chaves estrangeiras o desenho tem. */
  schema: string;
  /** O assunto usado para dar nome ao arquivo exportado (`diagrama-<subject>.png` / `.md`); por padrão, `schema`. */
  subject?: string;
  /** O rótulo acessível da área do diagrama; por padrão, `Diagrama da tabela`. */
  diagramLabel?: string;
  tableCount: number;
  foreignKeyCount: number;
  /** Quantas tabelas referenciadas ficaram de fora do desenho (passou do teto). */
  omitted: number;
  fetching: boolean;
  onOpenTable: (ref: TableRef) => void;
  onRefresh: () => void;
  /** O zoom e a rolagem de quando a pessoa saiu daqui (`tab-memory.ts`): voltam como estavam, sem ajustar à tela de novo. */
  initial?: DiagramMemory;
  /** O zoom e a rolagem mudaram: quem guarda (a aba) os lembra para a próxima vez. */
  onViewChange?: (view: DiagramMemory) => void;
  /** As preferências de tema e fonte do usuário, aplicadas na tela e na exportação. */
  preferences?: Preferences;
  /** Modo de exibição das colunas em diagramas de esquema e de banco (`all` ou `keys`). */
  columnsMode?: ColumnsMode;
  onColumnsModeChange?: (mode: ColumnsMode) => void;
  /** Se exibe o aviso de que só aparecem as tabelas referenciadas (verdadeiro na aba de tabela, falso no esquema/banco). */
  showIncomingNotice?: boolean;
  /** Habilita o campo de filtro de tabelas e o destaque de vizinhança ao clicar numa tabela. */
  enableTableFilter?: boolean;
  /** Chave da caixa selecionada externamente (ex.: no Construir). */
  selectedKey?: string | null;
  /** Callback ao selecionar uma caixa no diagrama. */
  onSelect?: (key: string) => void;
  /** Callback ao arrastar uma caixa para uma nova posição `(x, y)`. */
  onMoveTable?: (key: string, x: number, y: number) => void;
  /** Callback ao arrastar uma coluna de `fromKey` e soltar sobre a caixa `toKey`. */
  onConnect?: (fromKey: string, column: string, toKey: string) => void;
};

/**
 * O desenho do diagrama (RN-TABELA-004), em SVG feito à mão: as caixas e as linhas de `layoutDiagram`,
 * dentro de uma área que rola. Amplia e reduz pelos botões, por `+`, `-` e `0` com o foco na área e
 * por Ctrl+roda (em torno do ponteiro); "Ajustar à tela" põe o desenho inteiro na janela, e a primeira
 * exibição já cabe nela, a não ser que haja um zoom e uma rolagem lembrados (`initial`). O texto é do
 * banco e entra sempre como texto do SVG (RN-SHELL-002).
 */
export function DiagramCanvas({
  layout,
  schema,
  subject,
  diagramLabel = copy.label,
  tableCount,
  foreignKeyCount,
  omitted,
  fetching,
  onOpenTable,
  onRefresh,
  initial,
  onViewChange,
  preferences = defaultPreferences,
  columnsMode,
  onColumnsModeChange,
  showIncomingNotice = true,
  enableTableFilter = false,
  selectedKey: controlledSelectedKey,
  onSelect: onSelectBox,
  onMoveTable,
  onConnect,
}: DiagramCanvasProps) {
  const marker = useId();
  const scroller = useRef<HTMLDivElement | null>(null);
  // O que estava lembrado ao abrir: lido uma vez, porque quem lembra grava a cada rolada e a propriedade mudaria o tempo todo.
  const [start] = useState(initial);
  const [zoom, setZoom] = useState(start?.zoom ?? 1);
  const [tableFilter, setTableFilter] = useState("");
  const [internalSelectedKey, setInternalSelectedKey] = useState<string | null>(null);
  const selectedKey = controlledSelectedKey !== undefined ? controlledSelectedKey : internalSelectedKey;
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [panLocked, setPanLocked] = useState(false);
  const [panning, setPanning] = useState(false);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panSession = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const moveSession = useRef<{ key: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const connectSession = useRef<{ fromKey: string; column: string } | null>(null);
  const suppressClick = useRef(false);
  const zoomRef = useRef(zoom);
  const fitted = useRef(start !== undefined);
  const restored = useRef(false);
  // O ponto da janela que deve ficar parado quando o zoom muda (o ponteiro, ou o centro), e o zoom de antes.
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null);

  const metrics = useMemo(() => diagramMetrics(preferences.editor.fontSize), [preferences.editor.fontSize]);
  const visualStyle = useMemo(() => resolveDiagramStyle(preferences), [preferences]);
  const editorFont = useMemo(() => fontStack("editor", preferences.editor.fontFamily), [preferences.editor.fontFamily]);
  const activeLayout = useMemo(() => (enableTableFilter ? filterDiagramLayout(layout, tableFilter) : layout), [enableTableFilter, layout, tableFilter]);
  const neighborhood = useMemo(() => (enableTableFilter && selectedKey !== null ? connectedToTable(activeLayout, selectedKey) : null), [enableTableFilter, activeLayout, selectedKey]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /**
   * A primeira vez que a área tem tamanho, o desenho já cabe nela (até 100%), ou volta à rolagem lembrada.
   * Devolve se já deu (`false`: a área está escondida e ainda não há o que medir).
   */
  const settle = useCallback(
    (element: HTMLDivElement) => {
      const size = { width: element.clientWidth, height: element.clientHeight };
      const todo = settleActions(size, { fitted: fitted.current, restored: restored.current, hasMemory: start !== undefined });
      if (todo.wait) return false;

      if (todo.restore && start !== undefined) {
        restored.current = true;
        element.scrollLeft = start.left;
        element.scrollTop = start.top;
      }
      if (todo.fit) {
        fitted.current = true;
        setZoom(fitZoom(activeLayout, size));
      }
      return true;
    },
    [activeLayout, start],
  );

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      if (element !== null) settle(element);
    },
    [settle],
  );

  // A área pode nascer escondida (a área de trabalho por baixo de outra tela): sem tamanho, nada se mede. Quando
  // ela aparece, mede o próprio tamanho e só então se ajusta ou volta à rolagem lembrada.
  useEffect(() => {
    const element = scroller.current;
    if (element === null || (fitted.current && (start === undefined || restored.current))) return;

    const observer = new ResizeObserver(() => {
      if (settle(element)) observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [settle, start]);

  /** Lembra o zoom e a rolagem de agora. */
  const report = useCallback(() => {
    const element = scroller.current;
    if (element !== null) onViewChange?.({ zoom: zoomRef.current, left: element.scrollLeft, top: element.scrollTop });
  }, [onViewChange]);

  const zoomTo = useCallback((next: number, point?: { x: number; y: number }) => {
    const element = scroller.current;
    const from = zoomRef.current;
    if (element === null || clampZoom(next) === from) return;

    anchor.current = { x: point?.x ?? element.clientWidth / 2, y: point?.y ?? element.clientHeight / 2, from };
    setZoom(clampZoom(next));
  }, []);

  // O desenho muda de tamanho na renderização do zoom novo; a rolagem acompanha para o ponto ancorado não andar.
  useLayoutEffect(() => {
    const element = scroller.current;
    const held = anchor.current;
    if (element === null || held === null) return;

    anchor.current = null;
    const ratio = zoom / held.from;
    element.scrollLeft = (element.scrollLeft + held.x) * ratio - held.x;
    element.scrollTop = (element.scrollTop + held.y) * ratio - held.y;
  }, [zoom]);

  // O zoom mudou (e a rolagem acompanhou, acima): é o que a aba lembra. A rolagem em si chega por `onScroll`.
  useEffect(() => report(), [zoom, report]);

  // Ctrl+roda precisa de `preventDefault` (senão o Chromium amplia a página inteira), e o React registra `wheel` como passivo.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey || element === null) return;
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      zoomTo((event.deltaY < 0 ? zoomIn : zoomOut)(zoomRef.current), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [zoomTo]);

  useEffect(() => {
    if (!panning) return;

    function handleMouseMove(event: MouseEvent) {
      const session = panSession.current;
      const element = scroller.current;
      if (session === null || element === null) return;

      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      const next = applyDiagramPan(session, { clientX: event.clientX, clientY: event.clientY });
      if (next.moved) session.moved = true;
      element.scrollLeft = next.scrollLeft;
      element.scrollTop = next.scrollTop;

      const actualDx = session.scrollLeft - element.scrollLeft;
      const actualDy = session.scrollTop - element.scrollTop;
      setPanOffset({
        x: session.offsetX + (dx - actualDx),
        y: session.offsetY + (dy - actualDy),
      });
    }

    function stopPanning() {
      if (panSession.current?.moved) {
        suppressClick.current = true;
      }
      panSession.current = null;
      setPanning(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("blur", stopPanning);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopPanning);
      window.removeEventListener("blur", stopPanning);
    };
  }, [panning]);

  useEffect(() => {
    if (!onMoveTable && !onConnect) return;

    function handlePointerMove(event: PointerEvent) {
      const moving = moveSession.current;
      if (!moving || !onMoveTable) return;
      const dx = (event.clientX - moving.startX) / zoomRef.current;
      const dy = (event.clientY - moving.startY) / zoomRef.current;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        suppressClick.current = true;
        onMoveTable(
          moving.key,
          Math.max(16, Math.round(moving.originX + dx)),
          Math.max(16, Math.round(moving.originY + dy)),
        );
      }
    }

    function handlePointerUp() {
      moveSession.current = null;
      connectSession.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onMoveTable, onConnect]);

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (moveSession.current !== null || connectSession.current !== null) return;
    const canLeftPan = event.button === 0;
    if (!shouldStartDiagramPan(event.button, panLocked) && !canLeftPan) return;
    const element = scroller.current;
    if (element === null) return;

    event.preventDefault();
    panSession.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      offsetX: panOffset.x,
      offsetY: panOffset.y,
      moved: false,
    };
    setPanning(true);
  }

  function fit() {
    const element = scroller.current;
    setPanOffset({ x: 0, y: 0 });
    if (element !== null) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
      setZoom(fitZoom(activeLayout, { width: element.clientWidth, height: element.clientHeight }));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Só com o foco na própria área: o Enter de uma vizinha e o Tab não passam por aqui.
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") zoomTo(zoomIn(zoom));
    else if (event.key === "-") zoomTo(zoomOut(zoom));
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  }

  async function handleCopyMermaid() {
    try {
      await navigator.clipboard?.writeText(toMermaidErDiagram(activeLayout, visualStyle));
      setCopiedMermaid(true);
      window.setTimeout(() => setCopiedMermaid(false), 2000);
    } catch {
      // Se a área de transferência recusar, a exportação em arquivo continua disponível.
    }
  }

  const exportSubject = subject ?? schema;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-panel px-3 py-1.5">
        <p className="text-sm text-muted">
          <span className="font-mono font-semibold text-ink">{schema}</span> · {copy.counts(tableCount, foreignKeyCount)}
        </p>

        {enableTableFilter ? (
          <input
            type="search"
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
            placeholder={copy.filterTablesPlaceholder}
            aria-label={copy.filterTablesPlaceholder}
            className="h-7 w-44 rounded-sm border border-border bg-background px-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        ) : null}

        {onColumnsModeChange ? (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            className="h-7 px-2.5 text-xs"
            aria-pressed={columnsMode === "keys"}
            onClick={() => onColumnsModeChange(columnsMode === "keys" ? "all" : "keys")}
          >
            {columnsMode === "keys" ? copy.allColumns : copy.keysOnly}
          </Button>
        ) : null}

        <div role="toolbar" aria-label={copy.zoom} className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-label={copy.panMode}
            title={copy.panMode}
            aria-pressed={panLocked}
            onClick={() => setPanLocked((current) => !current)}
            className={cn(iconButton, panLocked && "bg-selected text-accent ring-1 ring-accent/50")}
          >
            <MoveIcon />
          </button>
          <button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} disabled={zoom <= minZoom} onClick={() => zoomTo(zoomOut(zoom))} className={iconButton}>
            <MinusIcon />
          </button>
          <output aria-label={copy.zoom} className="w-11 text-center text-xs text-muted tabular-nums">
            {zoomLabel(zoom)}
          </output>
          <button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} disabled={zoom >= maxZoom} onClick={() => zoomTo(zoomIn(zoom))} className={iconButton}>
            <PlusIcon />
          </button>
          <Button type="button" variant="secondary" size="compact" className="ml-1 h-7 px-2.5 text-xs" onClick={fit}>
            {copy.fit}
          </Button>
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" disabled={fetching} onClick={onRefresh}>
            <RefreshIcon />
            {workbenchCopy.tableTab.refresh}
          </Button>
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void exportDiagramPng(exportSubject, activeLayout, visualStyle)}>
            {copy.exportPng}
          </Button>
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void exportDiagramMermaid(exportSubject, activeLayout, visualStyle)}>
            {copy.exportMermaid}
          </Button>
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void handleCopyMermaid()}>
            {copiedMermaid ? copy.copiedMermaid : copy.copyMermaid}
          </Button>
        </div>
      </div>

      <div
        ref={attach}
        tabIndex={0}
        role="group"
        aria-label={diagramLabel}
        aria-busy={fetching}
        onKeyDown={handleKeyDown}
        onScroll={report}
        onMouseDown={handleMouseDown}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (enableTableFilter && (event.target === event.currentTarget || (event.target instanceof SVGElement && event.target.tagName.toLowerCase() === "svg"))) {
            setInternalSelectedKey(null);
          }
        }}
        className={cn(
          "min-h-0 flex-1 cursor-grab overflow-auto bg-background bg-[radial-gradient(var(--color-selected)_1px,transparent_1px)] bg-[length:24px_24px] -outline-offset-2 select-none",
          panning ? "cursor-grabbing [&_*]:cursor-grabbing" : panLocked ? "cursor-grab [&_*]:cursor-grab" : undefined,
        )}
      >
        <svg
          width={activeLayout.width * zoom}
          height={activeLayout.height * zoom}
          viewBox={`0 0 ${activeLayout.width} ${activeLayout.height}`}
          style={{
            fontFamily: editorFont,
            fontSize: `${metrics.fontSize}px`,
            transform: panOffset.x !== 0 || panOffset.y !== 0 ? `translate(${panOffset.x}px, ${panOffset.y}px)` : undefined,
          }}
          className="block max-w-none"
        >
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" className="fill-postgres" />
            </marker>
          </defs>
          {activeLayout.edges.map((edge) => (
            <Edge key={edge.key} edge={edge} marker={marker} dimmed={neighborhood !== null && !neighborhood.edges.has(edge.key)} />
          ))}
          {activeLayout.boxes.map((box) => (
            <TableBox
              key={box.key}
              box={box}
              rowHeight={metrics.rowHeight}
              maxChars={metrics.rowChars}
              dimmed={neighborhood !== null && !neighborhood.tables.has(box.key)}
              selected={selectedKey === box.key}
              onSelect={
                onSelectBox
                  ? (key) => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      onSelectBox(key);
                    }
                  : enableTableFilter
                    ? (key) => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        setInternalSelectedKey((current) => (current === key ? null : key));
                      }
                    : undefined
              }
              onStartMove={
                onMoveTable
                  ? (targetBox, event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      moveSession.current = {
                        key: targetBox.key,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: targetBox.x,
                        originY: targetBox.y,
                      };
                    }
                  : undefined
              }
              onStartConnect={
                onConnect
                  ? (targetBox, columnName, event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      connectSession.current = {
                        fromKey: targetBox.key,
                        column: columnName,
                      };
                    }
                  : undefined
              }
              onDropConnect={
                onConnect
                  ? (targetKey) => {
                      const session = connectSession.current;
                      connectSession.current = null;
                      if (session && session.fromKey !== targetKey) {
                        onConnect(session.fromKey, session.column, targetKey);
                      }
                    }
                  : undefined
              }
              onOpen={onOpenTable}
            />
          ))}
        </svg>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-panel px-3 py-1.5 text-xs text-muted">
        <span>
          <b className="font-mono font-semibold text-accent">PK</b> {copy.legend.primaryKey} · <b className="font-mono font-semibold text-postgres">FK</b> {copy.legend.foreignKey} · {copy.legend.arrow}
        </span>
        {showIncomingNotice ? <span>{copy.incoming}</span> : null}
        {foreignKeyCount === 0 ? <span className="text-ink">{copy.noForeignKeys}</span> : null}
        {omitted > 0 ? <span className="text-ink">{copy.omitted(layout.boxes.length - 1, layout.boxes.length - 1 + omitted)}</span> : null}
      </div>
    </div>
  );
}
