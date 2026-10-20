import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { CheckIcon, ChevronIcon, CloseIcon, ContextMenu, DocumentIcon, TableIcon, type ContextMenuItem } from "@/components/ui";
import { listOtherWindows } from "@/lib/api/bridge";
import { cn } from "@/lib/utils/cn";

import type { TabMoveTarget, WindowEntry } from "../../../../electron/window-messages";

import { ignoresContextMenu } from "../_lib/navigator-menu";
import { dropIndex, isOutsideWindow, readTabDrag, tabDragType, writeTabDrag } from "../_lib/tab-order";
import { scriptIconOf } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { ScriptSummary } from "../_lib/scripts.schema";
import { closeShortcutLabel, moveMenu, overflowOf, revealOffset, scrollStep, stripKeyTarget, tabListLabels, tabMenu, tabTitleOf, wheelScroll, type CloseScope } from "../_lib/tab-strip";
import { stripTitles } from "../_lib/tab-titles";
import type { QueryTab } from "../_lib/workbench-model";
import { workbenchCopy } from "../_lib/workbench.copy";
import { ScriptIconView } from "./script-icon";

const copy = workbenchCopy.tabs;

export const tabElementId = (id: string) => `workbench-tab-${id}`;
export const panelElementId = (id: string) => `workbench-panel-${id}`;

type Opening = "first" | "menu";
type Point = { x: number; y: number };
type StripMenu = { kind: "tab" | "windows"; tabId: string; point: Point; initialFocus: Opening } | { kind: "list"; point: Point; initialFocus: Opening };

type TabStripProps = {
  tabs: QueryTab[];
  activeTabId: string | null;
  connectionOf: (connectionId: string | null) => Connection | undefined;
  /** O ambiente que a conexão da aba mostra (RN-CONN-015 e RN-PASTA-005): o próprio, ou o herdado da pasta. */
  environmentOf: (connectionId: string | null) => ShownEnvironment | null;
  /** RN-SCRIPT-006: o script da aba, como a lista o tem, para o ícone e a cor dele. Sem ele (a lista por chegar, o script excluído), o ícone de documento. */
  scriptOf?: (scriptId: string) => Pick<ScriptSummary, "icon" | "color"> | undefined;
  onSelect: (tabId: string) => void;
  /** Fecha o que o fechamento pede a partir da aba dada (`tabsToClose`). */
  onClose: (scope: CloseScope, tabId: string) => void;
  /** O número desta janela (`null` fora do Electron): diz se a aba solta aqui veio daqui mesmo. */
  windowId: number | null;
  /** RN-ABAS-001: a aba desta janela foi solta nesta faixa, antes da posição dada. */
  onReorder: (tabId: string, insertAt: number) => void;
  /** RN-ABAS-002 e 003: levar a aba para uma janela nova (do menu, ou solta fora da janela) ou para outra janela aberta. */
  onMove: (tabId: string, target: TabMoveTarget) => void;
  /** RN-ABAS-003: uma aba de outra janela foi solta nesta faixa. */
  onReceive: (fromWindowId: number, tabId: string, insertAt: number) => void;
  /** RN-SQL-021: o que a aba mostra do estado dela, depois do nome: a marca do script que parou num erro e espera a resposta (`ScriptWaitingMark`). */
  markOf?: (tabId: string) => ReactNode;
};

/** Os botões das pontas e o da lista: 28 px de largura e a altura da faixa. */
const stripButton = "flex h-10 w-7 flex-none cursor-pointer items-center justify-center text-subtle transition-colors hover:bg-selected hover:text-ink";

/**
 * A faixa de abas: uma linha só, que rola na horizontal. A roda comum rola as abas; com excedente, aparecem os botões de rolar nas
 * pontas; a aba ativa é sempre trazida à vista; e um botão no fim abre a lista de todas as abas. Botão direito (ou Shift+F10, ou a
 * tecla de menu) numa aba abre o menu com Fechar, Fechar as outras, Fechar as da direita e Fechar todas, e o botão do meio fecha a aba.
 * As setas movem entre as abas (dão a volta), Home e End vão à primeira e à última, e só a ativa entra na ordem do Tab.
 *
 * Os botões das pontas acendem por atributos (`data-left` e `data-right` da moldura) e não por estado: rolar não redesenha a faixa.
 * Os botões de rolar e o da lista são para o mouse; o teclado tem as setas, que trazem a aba à vista, e a tecla de menu.
 */
export function TabStrip({ tabs, activeTabId, connectionOf, environmentOf, scriptOf, onSelect, onClose, windowId, onReorder, onMove, onReceive, markOf }: TabStripProps) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<StripMenu | null>(null);
  // RN-ABAS-008: o nome curto na barra; o inteiro fica na dica.
  const titles = stripTitles(tabs);
  // As outras janelas, pedidas ao abrir o menu de uma aba ("Mover para a janela…", RN-ABAS-003).
  const [otherWindows, setOtherWindows] = useState<WindowEntry[]>([]);
  // Onde a aba arrastada entraria, enquanto ela passa por cima da faixa (RN-ABAS-001): a marca de soltar.
  const [dropAt, setDropAt] = useState<number | null>(null);
  // A faixa estava sem largura (a área de trabalho escondida) quando a aba ativa pediu para aparecer: aparece ao ter largura.
  const revealPending = useRef(false);
  // O botão da lista estava com o menu da lista aberto quando o ponteiro desceu nele: o `pointerdown` de fora já fechou o menu, e o clique do mesmo gesto não o reabre.
  const listButton = useRef<HTMLButtonElement>(null);
  const listWasOpen = useRef(false);
  const openKind = useRef<StripMenu["kind"] | null>(null);
  // O atalho que o menu escreve segue a plataforma: Cmd+W no macOS.
  const shortcut = closeShortcutLabel(typeof navigator === "undefined" ? "" : navigator.platform);

  useLayoutEffect(() => {
    openKind.current = menu?.kind ?? null;
  });

  useEffect(() => {
    // Registrado antes de qualquer menu existir, então roda ANTES do `pointerdown` de fora que o fecha (na mesma fase, quem se registrou primeiro é chamado primeiro) e ainda vê o
    // menu aberto. Nem o `onPointerDown` do React serviria: o fechamento já teria desenhado a faixa de novo quando ele rodasse.
    const onPointerDown = (event: PointerEvent) => {
      listWasOpen.current = openKind.current === "list" && event.target instanceof Node && listButton.current?.contains(event.target) === true;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const measure = useCallback(() => {
    const element = scroller.current;
    const frameElement = frame.current;
    if (element === null || frameElement === null) return;

    const { left, right } = overflowOf(element);
    frameElement.toggleAttribute("data-left", left);
    frameElement.toggleAttribute("data-right", right);
  }, []);

  const reveal = useCallback(() => {
    const element = scroller.current;
    const active = element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.parentElement;
    if (element == null || active == null) return;

    revealPending.current = element.clientWidth <= 0;
    const offset = revealOffset(element, { left: active.offsetLeft, width: active.offsetWidth });
    if (offset !== null) element.scrollLeft = offset;
  }, []);

  // Uma aba nova, ou outra ativa, ou uma fechada: traz a ativa à vista e acende ou apaga os botões das pontas.
  useLayoutEffect(() => {
    reveal();
    measure();
  }, [activeTabId, tabs.length, reveal, measure]);

  // A faixa muda de largura (a janela, o navegador lateral) ou volta a ter largura: mede de novo, e mostra a ativa que esperava.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    const observer = new ResizeObserver(() => {
      measure();
      if (revealPending.current) reveal();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, reveal]);

  function scrollBy(direction: -1 | 1) {
    const element = scroller.current;
    if (element === null) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * scrollStep(element.clientWidth), behavior: reduced ? "auto" : "smooth" });
  }

  /** Abre um menu; o `contextmenu` que a tecla de menu gera no keyup, em cima do menu que ela abriu, é ignorado (como no navegador). */
  function open(next: StripMenu) {
    if (ignoresContextMenu(menu?.initialFocus ?? null, next.initialFocus)) return;
    setMenu(next);
    if (next.kind === "tab" && windowId !== null) void listOtherWindows().then(setOtherWindows);
  }

  /** As caixas das abas na tela, na ordem da faixa: é por elas que se acha onde a aba solta entra. */
  function tabRects() {
    const children = scroller.current === null ? [] : [...scroller.current.querySelectorAll<HTMLElement>("[data-tab-id]")];
    return children.map((child) => {
      const { left, width } = child.getBoundingClientRect();
      return { left, width };
    });
  }

  const carriesTab = (event: DragEvent) => event.dataTransfer.types.includes(tabDragType);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!carriesTab(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = dropIndex(tabRects(), event.clientX);
    setDropAt((current) => (current === index ? current : index));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!carriesTab(event)) return;

    event.preventDefault();
    setDropAt(null);
    const drag = readTabDrag(event.dataTransfer.getData(tabDragType));
    if (drag === null) return;

    const index = dropIndex(tabRects(), event.clientX);
    if (drag.windowId === windowId) onReorder(drag.tabId, index);
    else if (drag.windowId !== null) onReceive(drag.windowId, drag.tabId, index);
  }

  /** A aba arrastada caiu fora de qualquer faixa: fora da janela, ela abre uma janela nova ali (RN-ABAS-002); dentro, ou com Esc, fica onde estava. */
  function handleDragEnd(event: DragEvent, tab: QueryTab) {
    setDropAt(null);
    if (event.dataTransfer.dropEffect !== "none" || windowId === null) return;

    const point = { x: Math.round(event.screenX), y: Math.round(event.screenY) };
    if (isOutsideWindow(point, { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })) onMove(tab.id, { kind: "new", at: point });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: QueryTab, index: number) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      // Abre no pé da aba, com o foco no primeiro item.
      event.preventDefault();
      const { left, bottom } = event.currentTarget.getBoundingClientRect();
      open({ kind: "tab", tabId: tab.id, point: { x: left + 28, y: bottom }, initialFocus: "first" });
      return;
    }

    const target = stripKeyTarget(event.key, index, tabs.length);
    if (target === null) return;

    event.preventDefault();
    onSelect(tabs[target].id);
    document.getElementById(tabElementId(tabs[target].id))?.focus();
  }

  function handleContextMenu(event: MouseEvent, tab: QueryTab) {
    event.preventDefault();
    open({ kind: "tab", tabId: tab.id, point: { x: event.clientX, y: event.clientY }, initialFocus: "menu" });
  }

  // A lista distingue as abas de mesmo título de conexões diferentes (mostra a conexão delas).
  const listLabels = tabListLabels(tabs, (connectionId) => connectionOf(connectionId)?.name);
  function menuGroupsOf(current: StripMenu): ContextMenuItem[][] {
    if (current.kind === "list") return [tabs.map((tab, position) => ({ id: tab.id, label: listLabels[position], icon: tab.id === activeTabId ? <CheckIcon /> : undefined, onSelect: () => onSelect(tab.id) }))];

    const { tabId, point } = current;
    if (current.kind === "windows") return [otherWindows.map((entry) => ({ id: `window-${entry.id}`, label: copy.windowName(entry.number, entry.activeTitle, entry.tabCount), onSelect: () => onMove(tabId, { kind: "window", windowId: entry.id }) }))];

    const closing = tabMenu(tabs, tabId, activeTabId, shortcut).map((group) => group.map((item): ContextMenuItem => ({ id: item.scope, label: item.label, shortcut: item.shortcut, disabled: item.disabled, onSelect: () => onClose(item.scope, tabId) })));
    const moving = moveMenu(otherWindows.length, windowId !== null).map(
      (item): ContextMenuItem => ({
        id: item.action,
        label: item.label,
        disabled: item.disabled,
        // "Mover para a janela…" abre, no mesmo lugar, a lista das outras janelas.
        onSelect: () => (item.action === "newWindow" ? onMove(tabId, { kind: "new" }) : open({ kind: "windows", tabId, point, initialFocus: "first" })),
      }),
    );
    return moving.length === 0 ? closing : [...closing, moving];
  }

  const menuGroups = menu === null ? [] : menuGroupsOf(menu);
  const menuTitle = menu !== null && menu.kind !== "list" ? tabs.find((tab) => tab.id === menu.tabId)?.title : undefined;

  return (
    <div
      ref={frame}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropAt(null);
      }}
      onDrop={handleDrop}
      className="group/strip flex items-stretch border-b border-border bg-background px-2"
    >
      <button type="button" tabIndex={-1} aria-label={copy.scrollLeft} title={copy.scrollLeft} onClick={() => scrollBy(-1)} className={cn(stripButton, "hidden group-data-[left]/strip:flex")}>
        <ChevronIcon className="rotate-90" />
      </button>

      <div
        ref={scroller}
        role="tablist"
        aria-label={copy.label}
        onScroll={measure}
        onWheel={(event) => {
          // O gesto que já é horizontal o navegador rola sozinho; só a roda vertical entra aqui.
          const delta = wheelScroll(event);
          if (delta !== 0) event.currentTarget.scrollLeft += delta;
        }}
        className="relative flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTabId;
          const label = tabTitleOf(tab);
          const script = tab.script === undefined ? undefined : scriptOf?.(tab.script.id);

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              // RN-ABAS-001 a 003: a aba se arrasta pela faixa, para fora da janela e até a faixa de outra janela.
              draggable
              data-drop={dropAt === index ? "before" : dropAt === tabs.length && index === tabs.length - 1 ? "after" : undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData(tabDragType, writeTabDrag({ windowId, tabId: tab.id }));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={(event) => handleDragEnd(event, tab)}
              onContextMenu={(event) => handleContextMenu(event, tab)}
              // O botão do meio fecha a aba. O `mousedown` dele, no Windows, liga a rolagem automática: sem o `preventDefault` ela atrapalharia.
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose("one", tab.id);
              }}
              className={cn(
                "flex flex-none items-center border-b-2 data-[drop=after]:shadow-[inset_-2px_0_0_var(--color-accent)] data-[drop=before]:shadow-[inset_2px_0_0_var(--color-accent)]",
                selected ? "border-accent bg-panel text-ink" : "border-transparent text-muted hover:bg-panel/60 hover:text-ink",
              )}
            >
              <button
                type="button"
                role="tab"
                id={tabElementId(tab.id)}
                aria-selected={selected}
                aria-controls={panelElementId(tab.id)}
                tabIndex={selected ? 0 : -1}
                title={label.label}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tab, index)}
                className="flex h-10 cursor-pointer items-center gap-2 pr-1 pl-3.5"
              >
                {tab.table ? <TableIcon /> : script !== undefined ? <ScriptIconView icon={scriptIconOf(script)} color={script.color} /> : <DocumentIcon />}
                <span className="max-w-[240px] truncate">{titles.get(tab.id) ?? tab.title}</span>
                {/* RN-SCRIPT-001: o ponto da mudança não salva é desenho; o leitor de tela ouve o texto. */}
                {label.unsaved ? (
                  <>
                    <span aria-hidden data-unsaved className="size-2 flex-none rounded-full bg-accent" />
                    <span className="sr-only">{scriptsCopy.tab.unsaved}</span>
                  </>
                ) : null}
                {markOf?.(tab.id) ?? null}
                <ShownEnvironmentPill environment={environmentOf(tab.connectionId)} />
              </button>
              <button type="button" aria-label={copy.close(tab.title)} title={copy.close(tab.title)} onClick={() => onClose("one", tab.id)} className="mr-2 flex size-6 cursor-pointer items-center justify-center rounded-sm text-subtle transition-colors hover:bg-selected hover:text-ink">
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" tabIndex={-1} aria-label={copy.scrollRight} title={copy.scrollRight} onClick={() => scrollBy(1)} className={cn(stripButton, "hidden group-data-[right]/strip:flex")}>
        <ChevronIcon className="-rotate-90" />
      </button>

      {tabs.length > 1 ? (
        <button
          ref={listButton}
          type="button"
          aria-label={copy.list}
          title={copy.list}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "list"}
          onClick={(event) => {
            // O menu da lista estava aberto quando o ponteiro desceu aqui: o clique só o fecha, e não o abre de novo. O clique do teclado (`detail` 0) não vem de um ponteiro.
            const closesIt = listWasOpen.current && event.detail !== 0;
            listWasOpen.current = false;
            if (closesIt) return;

            // `detail` 0 é o clique que o teclado gera (Enter, Espaço): o foco vai ao primeiro item.
            const { right, bottom } = event.currentTarget.getBoundingClientRect();
            open({ kind: "list", point: { x: right, y: bottom }, initialFocus: event.detail === 0 ? "first" : "menu" });
          }}
          className={cn(stripButton, "ml-1 border-l border-border")}
        >
          <ChevronIcon />
        </button>
      ) : null}

      {menu === null ? null : (
        <ContextMenu
          key={`${menu.kind}@${menu.point.x},${menu.point.y}`}
          label={menu.kind === "tab" ? copy.menuLabel(menuTitle ?? "") : menu.kind === "windows" ? copy.windowsLabel : copy.listLabel}
          point={menu.point}
          initialFocus={menu.initialFocus}
          groups={menuGroups}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
