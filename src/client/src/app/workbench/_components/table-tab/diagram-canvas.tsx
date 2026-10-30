import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { fontStack } from "@/app/settings/_lib/fonts";
import { defaultPreferences, type Preferences } from "@/app/settings/_lib/preferences";
import {
  AutoLayoutIcon,
  Button,
  CloseIcon,
  ConnectColumnsIcon,
  CursorIcon,
  DownloadIcon,
  FitIcon,
  KeyIcon,
  LinkIcon,
  MinimapIcon,
  MinusIcon,
  MoveIcon,
  PlusIcon,
  RefreshIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { exportDiagramMermaid, exportDiagramPng, resolveDiagramStyle, toMermaidErDiagram } from "../../_lib/diagram-export";
import { connectedToTable, filterDiagramLayout, type ColumnsMode } from "../../_lib/schema-diagram";
import {
  clampZoom,
  diagramMetrics,
  edgeBezierGeometry,
  fitTitle,
  fitZoom,
  maxZoom,
  minZoom,
  opensNeighbor,
  rowCenter,
  settleActions,
  stripToneForSchema,
  zoomIn,
  zoomLabel,
  zoomOut,
  type DiagramBox,
  type DiagramColumn,
  type DiagramEdge,
  type DiagramLayout,
  type DiagramStripTone,
  type TableRef,
} from "../../_lib/table-diagram";
import type { DiagramMemory } from "../../_lib/tab-memory";
import { workbenchCopy } from "../../_lib/workbench.copy";

const copy = workbenchCopy.tableTab.diagram;

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

const iconButton =
  "flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

function stripBorderClass(box: DiagramBox): string {
  if (box.dropped || box.warning === "error") return "border-t-danger";
  if (box.variant === "new") return "border-t-success";
  if (box.warning === "warning" || box.badge === "alterada") return "border-t-warning";
  const tone: DiagramStripTone = box.stripTone ?? stripToneForSchema(box.ref.schema);
  switch (tone) {
    case "postgres":
      return "border-t-postgres";
    case "success":
      return "border-t-success";
    case "informix":
      return "border-t-informix";
    case "db2":
      return "border-t-db2";
    default:
      return "border-t-accent";
  }
}

/** Uma linha de coluna dentro do cartão HTML da tabela: ícone PK/FK, nome, selo UQ opcional e tipo alinhado à direita. */
function TableColumnRow({
  column,
  activeConnect = false,
  connectMode = false,
  highlighted = false,
  onStartConnect,
}: {
  column: DiagramColumn;
  activeConnect?: boolean;
  connectMode?: boolean;
  highlighted?: boolean;
  onStartConnect?: (columnName: string, event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const isAdded = column.state === "added";
  const isRemoved = column.state === "removed";
  const isChanged = column.state === "changed";

  return (
    <div
      onMouseDown={onStartConnect ? (event) => event.stopPropagation() : undefined}
      onPointerDown={onStartConnect ? (event) => onStartConnect(column.name, event) : undefined}
      className={cn(
        "group/row relative flex h-6 items-center gap-2 px-3 font-mono text-xs transition-colors",
        isAdded && "bg-success/10",
        isRemoved && "bg-danger/5 opacity-65",
        activeConnect && "bg-accent/15 ring-1 ring-accent",
        !isAdded && !isRemoved && !activeConnect && highlighted && "bg-postgres/10",
        !isAdded && !isRemoved && !activeConnect && !highlighted && "hover:bg-selected/50",
        onStartConnect && "cursor-crosshair",
      )}
    >
      {onStartConnect ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -left-1.5 top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-accent bg-background transition-opacity",
            activeConnect || connectMode ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
        />
      ) : null}

      <span className="flex size-3.5 flex-none items-center justify-center">
        {column.primaryKey ? (
          <span className="inline-flex items-center text-accent">
            <KeyIcon />
            <span className="sr-only">PK</span>
            {column.foreignKey ? <span className="sr-only">FK</span> : null}
          </span>
        ) : column.foreignKey ? (
          <span className="inline-flex items-center text-postgres">
            <LinkIcon />
            <span className="sr-only">FK</span>
          </span>
        ) : isAdded ? (
          <span className="font-semibold text-success">+</span>
        ) : null}
      </span>

      <span
        title={`${column.name} ${column.type}`}
        className={cn(
          "min-w-0 flex-1 truncate",
          isAdded ? "text-success" : isRemoved ? "line-through text-danger" : column.primaryKey ? "font-medium text-ink" : "text-body",
        )}
      >
        {column.name}
      </span>

      {column.unique ? (
        <span className="flex-none rounded border border-border px-1 font-sans text-[9px] font-semibold leading-[14px] text-subtle">
          UQ
        </span>
      ) : null}

      <span
        title={column.previousType ? `${column.previousType} → ${column.type}` : column.type}
        className={cn(
          "flex-none text-[11px]",
          isChanged ? "font-medium text-warning" : isRemoved ? "line-through text-danger" : "text-subtle",
        )}
      >
        {column.type}
      </span>

      {onStartConnect ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -right-1.5 top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-accent bg-background transition-opacity",
            activeConnect || connectMode ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
        />
      ) : null}
    </div>
  );
}

type TableCardProps = {
  box: DiagramBox;
  maxChars: number;
  dimmed?: boolean;
  selected?: boolean;
  connectMode?: boolean;
  activeConnectColumn?: string | null;
  connectedColumns?: ReadonlySet<string>;
  onSelect?: (key: string) => void;
  onStartMove?: (box: DiagramBox, event: ReactPointerEvent<HTMLElement>) => void;
  onStartConnect?: (box: DiagramBox, columnName: string, event: ReactPointerEvent<HTMLElement>) => void;
  onDropConnect?: (targetKey: string) => void;
  onAddColumn?: (key: string) => void;
  onApplyProblemFix?: (problemId: string) => void;
  onIgnoreProblem?: (problemId: string) => void;
  onNudgeTable?: (key: string, dx: number, dy: number) => void;
  onOpen: (ref: TableRef) => void;
};

/**
 * Cartão HTML de uma tabela do diagrama: cabeçalho com faixa de 3px na cor do grupo/estado, linhas de coluna com
 * ícones PK/FK e tipos alinhados à direita, rodapé opcional de adicionar coluna e balão de problema no Construir.
 */
function TableCard({
  box,
  maxChars,
  dimmed = false,
  selected = false,
  connectMode = false,
  activeConnectColumn = null,
  connectedColumns,
  onSelect,
  onStartMove,
  onStartConnect,
  onDropConnect,
  onAddColumn,
  onApplyProblemFix,
  onIgnoreProblem,
  onNudgeTable,
  onOpen,
}: TableCardProps) {
  const title = box.title ?? box.ref.name;
  const highlighted = box.center || selected;
  const boxMaxChars = box.width === 264 ? maxChars : Math.max(maxChars, Math.floor((maxChars * (box.width - 40)) / (264 - 32)));
  const fittedTitle = fitTitle(title, boxMaxChars - 1);
  const dashed = box.external || box.variant === "existing";

  const cardContent = (
    <>
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-raised shadow-sm transition-colors",
          box.dropped
            ? "border-dashed border-danger/60 opacity-55"
            : highlighted
              ? "border-accent ring-3 ring-accent/15"
              : box.warning === "error"
                ? "border-danger/60"
                : box.variant === "new"
                  ? "border-success/60"
                  : box.warning === "warning"
                    ? "border-warning/50"
                    : "border-border-strong group-hover:border-subtle group-focus-visible:border-accent",
          dashed && !highlighted && "border-dashed",
        )}
      >
        <div
          onPointerDown={onStartMove ? (event) => onStartMove(box, event) : undefined}
          className={cn(
            "flex h-9 items-center gap-1.5 border-t-[3px] border-b border-border bg-panel px-3",
            stripBorderClass(box),
            onStartMove && "cursor-move",
          )}
        >
          {fittedTitle.cut ? (
            <svg width="0" height="0" className="sr-only" aria-hidden="true">
              <title>{title}</title>
            </svg>
          ) : null}
          <span
            title={title}
            className={cn(
              "min-w-0 flex-1 truncate font-sans text-[13px] font-semibold text-ink",
              box.dropped && "line-through text-danger",
            )}
          >
            {fittedTitle.text}
          </span>

          {box.badge ? (
            <span
              className={cn(
                "flex-none rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold",
                box.badge === "nova"
                  ? "bg-success/15 text-success"
                  : box.badge === "excluir"
                    ? "bg-danger/15 text-danger"
                    : "bg-warning/15 text-warning",
              )}
            >
              {box.badge}
            </span>
          ) : null}

          {box.problems && box.problems.length > 0 ? (
            <span
              className={cn(
                "flex-none rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                box.warning === "error" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
              )}
            >
              ! {box.problems.length}
            </span>
          ) : box.warning ? (
            <span
              className={cn("size-2 flex-none rounded-full", box.warning === "error" ? "bg-danger" : "bg-warning")}
            />
          ) : null}

          {box.columns ? (
            <span className="flex-none font-mono text-[11px] font-normal text-subtle">{box.columns.length}</span>
          ) : null}
        </div>

        {box.columns && box.columns.length > 0 ? (
          <div className="pb-3">
            {box.columns.map((column) => (
              <TableColumnRow
                key={column.name}
                column={column}
                activeConnect={activeConnectColumn === column.name}
                connectMode={connectMode}
                highlighted={connectedColumns?.has(column.name) ?? false}
                onStartConnect={onStartConnect ? (colName, event) => onStartConnect(box, colName, event) : undefined}
              />
            ))}
          </div>
        ) : null}

        {selected && onAddColumn && !box.dropped ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddColumn(box.key);
            }}
            className="flex h-7 w-full cursor-pointer items-center justify-between border-t border-dashed border-border px-3 font-sans text-[11px] text-muted transition-colors hover:bg-selected/60 hover:text-ink"
          >
            <span>+ Adicionar coluna</span>
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px] text-subtle">Enter</kbd>
          </button>
        ) : null}
      </div>
    </>
  );

  const positionStyle = {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
  };

  if (box.center) {
    return (
      <div
        role="group"
        aria-label={title}
        style={positionStyle}
        onClick={
          onSelect
            ? (event) => {
                event.stopPropagation();
                onSelect(box.key);
              }
            : undefined
        }
        onPointerUp={onDropConnect ? () => onDropConnect(box.key) : undefined}
        className={cn("pointer-events-auto absolute", dimmed && "opacity-30 transition-opacity")}
      >
        {cardContent}
      </div>
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (onNudgeTable && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 4 : 16;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      onNudgeTable(box.key, dx, dy);
      return;
    }
    if (event.key === "Enter" && selected && onAddColumn) {
      event.preventDefault();
      onAddColumn(box.key);
      return;
    }
    if (!opensNeighbor(event.key)) return;
    // O Espaço também rolaria a área do diagrama.
    event.preventDefault();
    onOpen(box.ref);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={copy.open(title)}
      title={copy.openHint}
      style={positionStyle}
      onMouseDown={(event) => event.preventDefault()}
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(box.key);
            }
          : undefined
      }
      onPointerUp={onDropConnect ? () => onDropConnect(box.key) : undefined}
      onDoubleClick={() => onOpen(box.ref)}
      onKeyDown={handleKeyDown}
      className={cn(
        "group pointer-events-auto absolute cursor-pointer rounded-lg",
        dimmed && "opacity-30 transition-opacity",
      )}
    >
      {cardContent}
    </div>
  );
}

/** A relação entre duas colunas, em curva Bézier cúbica com pé-de-galinha no lado da FK. */
function Edge({
  edge,
  boxesByKey,
  highlighted = false,
  dimmed = false,
}: {
  edge: DiagramEdge;
  boxesByKey: ReadonlyMap<string, DiagramBox>;
  highlighted?: boolean;
  dimmed?: boolean;
}) {
  const geom = edgeBezierGeometry(edge, boxesByKey);
  const isNew = edge.variant === "new";
  const strokeClass = isNew ? "stroke-success" : highlighted ? "stroke-postgres" : "stroke-diagram-edge";
  const strokeWidth = isNew || highlighted ? 2 : 1.5;
  const dashArray = isNew ? "5 3" : edge.optional ? "4 3" : undefined;

  return (
    <g className={dimmed ? "opacity-25 transition-opacity" : undefined}>
      <title>{edge.label}</title>
      <path
        d={geom.d}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        className={strokeClass}
      />
      <path
        data-edge-marker={edge.cardinality ?? "1:N"}
        d={geom.markerPath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClass}
      />
      {geom.circle ? (
        <circle
          cx={geom.circle.cx}
          cy={geom.circle.cy}
          r={geom.circle.r}
          strokeWidth={1.5}
          className={cn("fill-background", strokeClass)}
        />
      ) : null}
      {/* Faixa larga e invisível para facilitar acertar a linha e ler a dica. */}
      <path d={geom.d} fill="none" stroke="transparent" strokeWidth="12" />
    </g>
  );
}

export type DiagramCanvasProps = {
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
  /** Pedido de foco/centralização numa tabela específica do diagrama. */
  focusRequest?: { key: string; seq: number } | null;
  /** Callback ao selecionar (ou desmarcar com `null`) uma caixa no diagrama. */
  onSelect?: (key: string | null) => void;
  /** Callback ao arrastar uma caixa para uma nova posição `(x, y)`. */
  onMoveTable?: (key: string, x: number, y: number) => void;
  /** Callback ao arrastar uma coluna de `fromKey` e soltar sobre a caixa `toKey`. */
  onConnect?: (fromKey: string, column: string, toKey: string) => void;
  /** Callback para adicionar uma nova tabela (Construir). */
  onAddTable?: () => void;
  /** Callback para adicionar uma coluna à tabela selecionada (Construir). */
  onAddColumn?: (tableKey: string) => void;
  /** Callback para reorganizar o layout das tabelas automaticamente. */
  onOrganize?: () => void;
  /** Callback para aplicar a ação corretiva de um aviso/erro no cartão (Construir). */
  onApplyProblemFix?: (problemId: string) => void;
  /** Callback para ignorar um aviso no cartão (Construir). */
  onIgnoreProblem?: (problemId: string) => void;
  /** Abre explicitamente o card flutuante de problemas no canto superior direito do diagrama (Construir). */
  problemsOpen?: boolean;
  /** Callback ao fechar o card flutuante de problemas no diagrama (Construir). */
  onCloseProblems?: () => void;
  /** Callbacks opcionais do painel flutuante da tabela selecionada na área de trabalho. */
  onOpenData?: (ref: TableRef) => void;
  onOpenStructure?: (ref: TableRef) => void;
  onGenerateSelect?: (ref: TableRef) => void;
};

/**
 * O desenho do diagrama (RN-TABELA-004): as relações em curvas Bézier cúbicas com pé-de-galinha num `<svg>`
 * e as tabelas como cartões em HTML sobre o mesmo plano. Amplia e reduz pelos botões da barra flutuante, por `+`, `-`
 * e `0` com o foco na área e por Ctrl+roda (em torno do ponteiro); "Ajustar à tela" põe o desenho inteiro na janela.
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
  focusRequest = null,
  onSelect: onSelectBox,
  onMoveTable,
  onConnect,
  onAddTable,
  onAddColumn,
  onOrganize,
  onApplyProblemFix,
  onIgnoreProblem,
  problemsOpen = false,
  onCloseProblems,
  onOpenData,
  onOpenStructure,
  onGenerateSelect,
}: DiagramCanvasProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  // O que estava lembrado ao abrir: lido uma vez, porque quem lembra grava a cada rolada e a propriedade mudaria o tempo todo.
  const [start] = useState(initial);
  const [zoom, setZoom] = useState(start?.zoom ?? 1);
  const [tableFilter, setTableFilter] = useState("");
  const [internalSelectedKey, setInternalSelectedKey] = useState<string | null>(null);
  const rawSelectedKey = controlledSelectedKey !== undefined ? controlledSelectedKey : internalSelectedKey;
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [connectMode, setConnectMode] = useState(false);
  const [panLocked, setPanLocked] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dismissedProblemKey, setDismissedProblemKey] = useState<string | null>(null);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<{ key: string; x: number; y: number } | null>(null);
  const dragStateRef = useRef<{ key: string; x: number; y: number } | null>(null);
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const connectSession = useRef<{
    fromKey: string;
    column: string;
    x1: number;
    y1: number;
    sticky: boolean;
  } | null>(null);
  const [connectingLine, setConnectingLine] = useState<{
    fromKey: string;
    column: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
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

  const displayBoxes = useMemo(
    () =>
      dragState === null
        ? activeLayout.boxes
        : activeLayout.boxes.map((box) => (box.key === dragState.key ? { ...box, x: dragState.x, y: dragState.y } : box)),
    [activeLayout.boxes, dragState],
  );
  const boxesByKey = useMemo(() => new Map(displayBoxes.map((box) => [box.key, box])), [displayBoxes]);

  const selectedBox = useMemo(() => {
    if (rawSelectedKey === null) return null;
    return (
      displayBoxes.find(
        (b) => b.key === rawSelectedKey || `${b.ref.schema}.${b.ref.name}` === rawSelectedKey || b.ref.name === rawSelectedKey,
      ) ?? null
    );
  }, [displayBoxes, rawSelectedKey]);
  const selectedKey = selectedBox?.key ?? rawSelectedKey;

  const neighborhood = useMemo(
    () => (selectedKey !== null ? connectedToTable(activeLayout, selectedKey) : null),
    [activeLayout, selectedKey],
  );

  /** Colunas conectadas por FK quando uma tabela está selecionada, para destacar os pares de colunas ligados. */
  const connectedColumnsByTable = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (selectedKey === null) return map;
    const add = (tableKey: string, colName?: string) => {
      if (!colName) return;
      let set = map.get(tableKey);
      if (!set) {
        set = new Set();
        map.set(tableKey, set);
      }
      set.add(colName);
    };
    for (const edge of activeLayout.edges) {
      if ((edge.fromTable === selectedKey || edge.toTable === selectedKey) && edge.fromTable && edge.toTable) {
        add(edge.fromTable, edge.fromColumn);
        add(edge.toTable, edge.toColumn);
      }
    }
    return map;
  }, [activeLayout.edges, selectedKey]);

  const finishConnect = useCallback(
    (targetKey: string): boolean => {
      const session = connectSession.current;
      if (!session || !onConnect) return false;
      if (session.fromKey !== targetKey) {
        connectSession.current = null;
        setConnectingLine(null);
        suppressClick.current = true;
        onConnect(session.fromKey, session.column, targetKey);
        return true;
      }
      if (!session.sticky) {
        session.sticky = true;
        return true;
      }
      return false;
    },
    [onConnect],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const lastFocusedSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || lastFocusedSeq.current === focusRequest.seq) return;
    const element = scroller.current;
    const targetLower = focusRequest.key.toLowerCase();
    const targetBox = displayBoxes.find(
      (b) =>
        b.key === focusRequest.key ||
        b.key.toLowerCase() === targetLower ||
        `${b.ref.schema}.${b.ref.name}`.toLowerCase() === targetLower ||
        b.ref.name.toLowerCase() === targetLower,
    );
    if (!element || !targetBox) return;
    lastFocusedSeq.current = focusRequest.seq;
    setPanOffset({ x: 0, y: 0 });
    const currentZoom = zoomRef.current;
    const centerX = (targetBox.x + targetBox.width / 2) * currentZoom;
    const centerY = (targetBox.y + targetBox.height / 2) * currentZoom;
    const nextLeft = Math.max(0, Math.round(centerX - element.clientWidth / 2));
    const nextTop = Math.max(0, Math.round(centerY - element.clientHeight / 2));
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    } else {
      element.scrollLeft = nextLeft;
      element.scrollTop = nextTop;
    }
  }, [displayBoxes, focusRequest]);

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

  useLayoutEffect(() => {
    const element = scroller.current;
    const held = anchor.current;
    if (element === null || held === null) return;

    anchor.current = null;
    const ratio = zoom / held.from;
    element.scrollLeft = (element.scrollLeft + held.x) * ratio - held.x;
    element.scrollTop = (element.scrollTop + held.y) * ratio - held.y;
  }, [zoom]);

  useEffect(() => report(), [zoom, report]);

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
      const connecting = connectSession.current;
      if (connecting && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const x2 = (event.clientX - rect.left) / zoomRef.current;
        const y2 = (event.clientY - rect.top) / zoomRef.current;
        setConnectingLine({
          fromKey: connecting.fromKey,
          column: connecting.column,
          x1: connecting.x1,
          y1: connecting.y1,
          x2,
          y2,
        });
        return;
      }

      const moving = moveSession.current;
      if (!moving || !onMoveTable) return;
      const dx = (event.clientX - moving.startX) / zoomRef.current;
      const dy = (event.clientY - moving.startY) / zoomRef.current;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        suppressClick.current = true;
        const nextPos = {
          key: moving.key,
          x: Math.max(16, Math.round(moving.originX + dx)),
          y: Math.max(16, Math.round(moving.originY + dy)),
        };
        dragStateRef.current = nextPos;
        setDragState(nextPos);
      }
    }

    function handlePointerUp(event: PointerEvent) {
      const finalDrag = dragStateRef.current;
      moveSession.current = null;
      dragStateRef.current = null;
      if (finalDrag !== null) {
        setDragState(null);
        onMoveTable?.(finalDrag.key, finalDrag.x, finalDrag.y);
      }

      const connecting = connectSession.current;
      if (!connecting) return;

      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const svgX = (event.clientX - rect.left) / zoomRef.current;
        const svgY = (event.clientY - rect.top) / zoomRef.current;
        const hitBox = activeLayout.boxes.find(
          (b) =>
            svgX >= b.x &&
            svgX <= b.x + b.width &&
            svgY >= b.y &&
            svgY <= b.y + b.height,
        );
        if (hitBox && finishConnect(hitBox.key)) {
          return;
        }
      }

      connectSession.current = null;
      setConnectingLine(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onMoveTable, onConnect, activeLayout.boxes, finishConnect]);

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (moveSession.current !== null || connectSession.current !== null) return;
    if (!shouldStartDiagramPan(event.button, panLocked)) return;
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
    if (event.key === "Escape") {
      if (connectSession.current !== null || connectingLine !== null || connectMode) {
        connectSession.current = null;
        setConnectingLine(null);
        setConnectMode(false);
        event.preventDefault();
        return;
      }
      if (selectedKey !== null) {
        setInternalSelectedKey(null);
        onSelectBox?.(null);
        event.preventDefault();
        return;
      }
    }
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") zoomTo(zoomIn(zoom));
    else if (event.key === "-") zoomTo(zoomOut(zoom));
    else if (event.key === "0") fit();
    else if (event.key === "v" || event.key === "V") {
      setPanLocked(false);
      setConnectMode(false);
    } else if ((event.key === "l" || event.key === "L") && onConnect) setConnectMode((current) => !current);
    else if (
      onMoveTable &&
      selectedKey !== null &&
      (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const target = activeLayout.boxes.find((b) => b.key === selectedKey);
      if (!target) return;
      const step = event.shiftKey ? 4 : 16;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      onMoveTable(target.key, Math.max(16, target.x + dx), Math.max(16, target.y + dy));
    } else return;
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
  const outgoingEdges = useMemo(
    () => (selectedBox !== null ? activeLayout.edges.filter((edge) => edge.fromTable === selectedBox.key) : []),
    [activeLayout.edges, selectedBox],
  );
  const incomingEdges = useMemo(
    () => (selectedBox !== null ? activeLayout.edges.filter((edge) => edge.toTable === selectedBox.key) : []),
    [activeLayout.edges, selectedBox],
  );

  const connectingPreviewPath = useMemo(() => {
    if (connectingLine === null) return null;
    const dx = connectingLine.x2 - connectingLine.x1;
    const ctrl = Math.max(36, Math.abs(dx) * 0.5);
    const dir = dx >= 0 ? 1 : -1;
    return `M ${connectingLine.x1} ${connectingLine.y1} C ${connectingLine.x1 + dir * ctrl} ${connectingLine.y1}, ${connectingLine.x2 - dir * ctrl} ${connectingLine.y2}, ${connectingLine.x2} ${connectingLine.y2}`;
  }, [connectingLine]);

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

        {onOrganize ? (
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onOrganize}>
            <AutoLayoutIcon />
            Organizar
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              className="h-7 px-2.5 text-xs"
              onClick={() => setExportMenuOpen((current) => !current)}
            >
              <DownloadIcon />
              Exportar
            </Button>
            <div
              role="menu"
              aria-label="Exportar diagrama"
              hidden={!exportMenuOpen}
              className={cn(
                "absolute right-0 top-full z-30 mt-1 flex w-48 flex-col rounded-md border border-border-strong bg-overlay p-1 shadow-lg",
                !exportMenuOpen && "hidden",
              )}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false);
                  void exportDiagramPng(exportSubject, activeLayout, visualStyle);
                }}
                className="flex w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-left text-xs text-ink hover:bg-selected"
              >
                {copy.exportPng}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false);
                  void exportDiagramMermaid(exportSubject, activeLayout, visualStyle);
                }}
                className="flex w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-left text-xs text-ink hover:bg-selected"
              >
                {copy.exportMermaid}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false);
                  void handleCopyMermaid();
                }}
                className="flex w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-left text-xs text-ink hover:bg-selected"
              >
                {copiedMermaid ? copy.copiedMermaid : copy.copyMermaid}
              </button>
            </div>
          </div>

          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" disabled={fetching} onClick={onRefresh}>
            <RefreshIcon />
            {workbenchCopy.tableTab.refresh}
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (exportMenuOpen) setExportMenuOpen(false);
            setInternalSelectedKey(null);
            onSelectBox?.(null);
            onCloseProblems?.();
          }}
          className={cn(
            "min-h-0 flex-1 overflow-auto bg-background bg-[radial-gradient(var(--color-selected)_1px,transparent_1px)] bg-[length:24px_24px] -outline-offset-2 select-none",
            panning
              ? "cursor-grabbing [&_*]:cursor-grabbing"
              : panLocked
                ? "cursor-grab [&_*]:cursor-grab"
                : "cursor-default",
          )}
        >
          <div
            style={{
              width: `${activeLayout.width * zoom}px`,
              height: `${activeLayout.height * zoom}px`,
              transform: panOffset.x !== 0 || panOffset.y !== 0 ? `translate(${panOffset.x}px, ${panOffset.y}px)` : undefined,
            }}
            className="relative"
          >
            <svg
              ref={svgRef}
              width={activeLayout.width * zoom}
              height={activeLayout.height * zoom}
              viewBox={`0 0 ${activeLayout.width} ${activeLayout.height}`}
              style={{
                fontFamily: editorFont,
                fontSize: `${metrics.fontSize}px`,
              }}
              className="block max-w-none"
            >
              {activeLayout.edges.map((edge) => {
                const isEdgeHighlighted = neighborhood !== null && neighborhood.edges.has(edge.key);
                const isEdgeDimmed = neighborhood !== null && !neighborhood.edges.has(edge.key);
                return (
                  <Edge
                    key={edge.key}
                    edge={edge}
                    boxesByKey={boxesByKey}
                    highlighted={isEdgeHighlighted}
                    dimmed={isEdgeDimmed}
                  />
                );
              })}

              {connectingLine !== null && connectingPreviewPath !== null ? (
                <g className="pointer-events-none">
                  <path
                    d={connectingPreviewPath}
                    fill="none"
                    strokeDasharray="5 5"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="stroke-accent"
                  />
                  <circle cx={connectingLine.x1} cy={connectingLine.y1} r={4} className="fill-background stroke-accent" strokeWidth={2} />
                  <circle cx={connectingLine.x2} cy={connectingLine.y2} r={4} className="fill-accent" />
                </g>
              ) : null}
            </svg>

            <div
              style={{
                width: `${activeLayout.width}px`,
                height: `${activeLayout.height}px`,
                transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                transformOrigin: "0 0",
                fontFamily: editorFont,
                fontSize: `${metrics.fontSize}px`,
              }}
              className="pointer-events-none absolute inset-0"
            >
              {displayBoxes.map((box) => (
                <TableCard
                  key={box.key}
                  box={box}
                  maxChars={metrics.rowChars}
                  dimmed={neighborhood !== null && !neighborhood.tables.has(box.key)}
                  selected={selectedKey === box.key}
                  connectMode={connectMode}
                  activeConnectColumn={connectingLine?.fromKey === box.key ? connectingLine.column : null}
                  connectedColumns={connectedColumnsByTable.get(box.key)}
                  onSelect={(key) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    setDismissedProblemKey(null);
                    if (onSelectBox) {
                      onSelectBox(key);
                    } else {
                      setInternalSelectedKey((current) => (current === key ? null : key));
                    }
                  }}
                  onStartMove={
                    onMoveTable
                      ? (targetBox, event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          if (connectSession.current?.sticky && finishConnect(targetBox.key)) {
                            return;
                          }
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
                          const activeConn = connectSession.current;
                          if (activeConn && activeConn.sticky) {
                            if (activeConn.fromKey !== targetBox.key && finishConnect(targetBox.key)) {
                              return;
                            }
                            if (activeConn.column === columnName) {
                              connectSession.current = null;
                              setConnectingLine(null);
                              return;
                            }
                          }
                          const colIndex = Math.max(
                            0,
                            targetBox.columns?.findIndex((c) => c.name === columnName) ?? 0,
                          );
                          const x1 = targetBox.x + targetBox.width;
                          const y1 = rowCenter(targetBox, colIndex);
                          connectSession.current = {
                            fromKey: targetBox.key,
                            column: columnName,
                            x1,
                            y1,
                            sticky: false,
                          };
                          setConnectingLine({
                            fromKey: targetBox.key,
                            column: columnName,
                            x1,
                            y1,
                            x2: x1,
                            y2: y1,
                          });
                          onSelectBox?.(targetBox.key);
                        }
                      : undefined
                  }
                  onDropConnect={onConnect ? (targetKey) => void finishConnect(targetKey) : undefined}
                  onAddColumn={onAddColumn}
                  onApplyProblemFix={onApplyProblemFix}
                  onIgnoreProblem={onIgnoreProblem}
                  onNudgeTable={
                    onMoveTable
                      ? (key, dx, dy) => {
                          const target = displayBoxes.find((b) => b.key === key);
                          if (!target) return;
                          onMoveTable(key, Math.max(16, target.x + dx), Math.max(16, target.y + dy));
                        }
                      : undefined
                  }
                  onOpen={onOpenTable}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Mini-mapa no canto inferior esquerdo */}
        {showMinimap && displayBoxes.length > 0 ? (
          <div
            aria-label="Mini-mapa do diagrama"
            role="img"
            className="pointer-events-none absolute bottom-3 left-3 z-10 hidden h-28 w-46 rounded-lg border border-border-strong bg-panel/90 p-1.5 shadow-md backdrop-blur-xs sm:block"
          >
            <svg viewBox={`0 0 ${activeLayout.width} ${activeLayout.height}`} className="h-full w-full">
              {displayBoxes.map((box) => (
                <rect
                  key={box.key}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={6}
                  strokeWidth={2}
                  className={cn(
                    box.center || selectedKey === box.key
                      ? "fill-accent/35 stroke-accent"
                      : box.variant === "new"
                        ? "fill-success/30 stroke-success"
                        : box.warning
                          ? "fill-warning/30 stroke-warning"
                          : "fill-raised stroke-border-strong",
                  )}
                />
              ))}
            </svg>
          </div>
        ) : null}

        {/* Barra flutuante inferior de ferramentas e zoom */}
        <div
          role="toolbar"
          aria-label={copy.zoom}
          className=" absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border-strong bg-panel/95 px-2 py-1 shadow-lg backdrop-blur-xs"
        >
          <button
            type="button"
            aria-label="Selecionar"
            title="Selecionar (V)"
            aria-pressed={!panLocked && !connectMode}
            onClick={() => {
              setPanLocked(false);
              setConnectMode(false);
            }}
            className={cn(iconButton, !panLocked && !connectMode && "bg-selected text-accent ring-1 ring-accent/50")}
          >
            <CursorIcon />
          </button>
          <button
            type="button"
            aria-label={copy.panMode}
            title={copy.panMode}
            aria-pressed={panLocked}
            onClick={() => {
              setPanLocked((current) => !current);
              setConnectMode(false);
            }}
            className={cn(iconButton, panLocked && "bg-selected text-accent ring-1 ring-accent/50")}
          >
            <MoveIcon />
          </button>

          {onAddTable || onConnect ? (
            <>
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
              {onAddTable ? (
                <Button type="button" variant="ghost" size="compact" className="h-7 px-2 text-xs" onClick={onAddTable}>
                  <PlusIcon />
                  Tabela
                </Button>
              ) : null}
              {onConnect ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  aria-pressed={connectMode}
                  onClick={() => {
                    setConnectMode((current) => !current);
                    setPanLocked(false);
                  }}
                  className={cn("h-7 px-2 text-xs", connectMode && "bg-selected text-accent ring-1 ring-accent/50")}
                >
                  <ConnectColumnsIcon />
                  Ligar colunas
                </Button>
              ) : null}
            </>
          ) : null}

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />

          <button
            type="button"
            aria-label={copy.zoomOut}
            title={copy.zoomOut}
            disabled={zoom <= minZoom}
            onClick={() => zoomTo(zoomOut(zoom))}
            className={iconButton}
          >
            <MinusIcon />
          </button>
          <output aria-label={copy.zoom} className="w-11 text-center font-mono text-xs text-muted tabular-nums">
            {zoomLabel(zoom)}
          </output>
          <button
            type="button"
            aria-label={copy.zoomIn}
            title={copy.zoomIn}
            disabled={zoom >= maxZoom}
            onClick={() => zoomTo(zoomIn(zoom))}
            className={iconButton}
          >
            <PlusIcon />
          </button>
          <Button type="button" variant="secondary" size="compact" className="ml-0.5 h-7 px-2 text-xs" onClick={fit}>
            <FitIcon />
            {copy.fit}
          </Button>
          <button
            type="button"
            aria-label="Mini-mapa"
            title="Mostrar ou ocultar mini-mapa"
            aria-pressed={showMinimap}
            onClick={() => setShowMinimap((current) => !current)}
            className={cn(iconButton, showMinimap && "bg-selected text-accent")}
          >
            <MinimapIcon />
          </button>
        </div>

        {/* Painel flutuante lateral da tabela selecionada na área de trabalho */}
        {selectedBox !== null && !onConnect ? (
          <aside
            aria-label="Tabela selecionada"
            className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-4rem)] w-68 flex-col overflow-hidden rounded-lg border border-border-strong bg-panel/95 shadow-lg backdrop-blur-xs"
          >
            <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate font-sans text-sm font-semibold text-ink">{selectedBox.ref.name}</h3>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-subtle">
                  {selectedBox.columns?.length ?? 0} colunas
                  {selectedBox.columns?.some((c) => c.primaryKey)
                    ? ` · PK ${selectedBox.columns
                        .filter((c) => c.primaryKey)
                        .map((c) => c.name)
                        .join(", ")}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar painel"
                onClick={() => setInternalSelectedKey(null)}
                className={iconButton}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="h-6 px-2 text-[11px]"
                onClick={() => (onOpenData ? onOpenData(selectedBox.ref) : onOpenTable(selectedBox.ref))}
              >
                Abrir dados
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="h-6 px-2 text-[11px]"
                onClick={() => (onOpenStructure ? onOpenStructure(selectedBox.ref) : onOpenTable(selectedBox.ref))}
              >
                Estrutura
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  if (onGenerateSelect) {
                    onGenerateSelect(selectedBox.ref);
                    return;
                  }
                  const cols = selectedBox.columns?.map((c) => c.name).join(", ") || "*";
                  const sql = `SELECT ${cols}\nFROM ${selectedBox.ref.schema}.${selectedBox.ref.name}\nLIMIT 100;`;
                  void navigator.clipboard?.writeText(sql);
                }}
              >
                Gerar SELECT
              </Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-xs">
              <div>
                <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                  Referencia ({outgoingEdges.length})
                </h4>
                {outgoingEdges.length === 0 ? (
                  <p className="text-[11px] text-muted">Nenhuma tabela referenciada.</p>
                ) : (
                  <ul className="space-y-1">
                    {outgoingEdges.map((edge) => {
                      const target = edge.toTable ? boxesByKey.get(edge.toTable) : undefined;
                      return (
                        <li key={edge.key}>
                          <button
                            type="button"
                            onClick={() => edge.toTable && setInternalSelectedKey(edge.toTable)}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-selected"
                          >
                            <span className="truncate text-body">{edge.fromColumn ?? "fk"}</span>
                            <span className="truncate text-postgres">
                              → {target?.ref.name ?? edge.toTable ?? "tabela"}.{edge.toColumn ?? "id"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                  Referenciada por ({incomingEdges.length})
                </h4>
                {incomingEdges.length === 0 ? (
                  <p className="text-[11px] text-muted">Nenhuma referência recebida no desenho.</p>
                ) : (
                  <ul className="space-y-1">
                    {incomingEdges.map((edge) => {
                      const source = edge.fromTable ? boxesByKey.get(edge.fromTable) : undefined;
                      return (
                        <li key={edge.key}>
                          <button
                            type="button"
                            onClick={() => edge.fromTable && setInternalSelectedKey(edge.fromTable)}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-selected"
                          >
                            <span className="truncate text-postgres">
                              {source?.ref.name ?? edge.fromTable ?? "tabela"}.{edge.fromColumn ?? "fk"}
                            </span>
                            <span className="truncate text-body">→ {edge.toColumn ?? "id"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        ) : null}

        {/* Card flutuante de problemas/avisos no canto superior direito do diagrama (Construir) */}
        {(() => {
          if (!onConnect) return null;
          const allProblemBoxes = displayBoxes.filter((b) => (b.problems?.length ?? 0) > 0);
          if (allProblemBoxes.length === 0) return null;

          const selectedHasProblems =
            selectedBox !== null &&
            (selectedBox.problems?.length ?? 0) > 0 &&
            (problemsOpen || dismissedProblemKey !== selectedBox.key);

          if (!problemsOpen && !selectedHasProblems) return null;

          const boxesToShow = problemsOpen
            ? selectedBox && (selectedBox.problems?.length ?? 0) > 0
              ? [selectedBox, ...allProblemBoxes.filter((b) => b.key !== selectedBox.key)]
              : allProblemBoxes
            : selectedBox
              ? [selectedBox]
              : [];

          if (boxesToShow.length === 0) return null;

          const singleTable = boxesToShow.length === 1 ? boxesToShow[0]! : null;
          const totalCount = boxesToShow.reduce((acc, b) => acc + (b.problems?.length ?? 0), 0);

          return (
            <aside
              aria-label="Problemas no diagrama"
              className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-4rem)] w-80 flex-col overflow-hidden rounded-lg border border-border-strong bg-panel/95 shadow-lg backdrop-blur-xs"
            >
              <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-sans text-sm font-semibold text-ink">
                      {singleTable ? singleTable.ref.name : "Problemas no modelo"}
                    </h3>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-subtle">
                    {totalCount} {totalCount === 1 ? "aviso ou problema encontrado" : "avisos ou problemas encontrados"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Fechar problemas"
                  onClick={() => {
                    if (selectedBox) setDismissedProblemKey(selectedBox.key);
                    onCloseProblems?.();
                  }}
                  className={iconButton}
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto px-3 py-2.5 text-xs">
                {boxesToShow.map((pBox) => (
                  <div key={pBox.key} className="min-w-0 space-y-1.5">
                    {!singleTable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDismissedProblemKey(null);
                          if (onSelectBox) onSelectBox(pBox.key);
                          else setInternalSelectedKey(pBox.key);
                        }}
                        className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] font-semibold text-ink hover:bg-selected"
                      >
                        <span className="min-w-0 truncate">{pBox.ref.name}</span>
                        <span className="shrink-0 text-[10px] text-subtle">! {pBox.problems?.length ?? 0}</span>
                      </button>
                    ) : null}

                    {pBox.problems?.map((problem) => {
                      const isError = problem.code.startsWith("E") || pBox.warning === "error";
                      return (
                        <div
                          key={problem.key}
                          role="note"
                          className={cn(
                            "flex min-w-0 items-start gap-2 rounded-md border bg-overlay p-2.5 font-sans text-[11px] leading-relaxed text-body",
                            isError ? "border-danger/50" : "border-warning/50",
                          )}
                        >
                          <span className={cn("shrink-0 font-mono font-bold", isError ? "text-danger" : "text-warning")}>
                            {problem.code}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 break-words [overflow-wrap:anywhere] text-ink">{problem.message}</p>
                            {(problem.fixLabel && onApplyProblemFix) || (!isError && onIgnoreProblem) ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {problem.fixLabel && onApplyProblemFix ? (
                                  <button
                                    type="button"
                                    onClick={() => onApplyProblemFix(problem.key)}
                                    className={cn(
                                      "cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                                      isError
                                        ? "border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
                                        : "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25",
                                    )}
                                  >
                                    {problem.fixLabel}
                                  </button>
                                ) : null}
                                {!isError && onIgnoreProblem ? (
                                  <button
                                    type="button"
                                    onClick={() => onIgnoreProblem(problem.key)}
                                    className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-selected hover:text-ink"
                                  >
                                    Ignorar
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </aside>
          );
        })()}
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-panel px-3 py-1.5 text-xs text-muted">
        <span>
          <b className="font-mono font-semibold text-accent">PK</b> {copy.legend.primaryKey} ·{" "}
          <b className="font-mono font-semibold text-postgres">FK</b> {copy.legend.foreignKey} · {copy.legend.arrow}
        </span>
        {showIncomingNotice ? <span>{copy.incoming}</span> : null}
        {foreignKeyCount === 0 ? <span className="text-ink">{copy.noForeignKeys}</span> : null}
        {omitted > 0 ? <span className="text-ink">{copy.omitted(layout.boxes.length - 1, layout.boxes.length - 1 + omitted)}</span> : null}
      </div>
    </div>
  );
}
