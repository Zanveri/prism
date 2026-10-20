import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { CheckIcon, ChevronIcon, CloseIcon, ContextMenu, DocumentIcon, TableIcon, type ContextMenuItem } from "@/components/ui";
import { listOtherWindows } from "@/lib/api/bridge";
import { cn } from "@/lib/utils/cn";

import type { TabMoveTarget, WindowEntry } from "../../../../electron/window-messages";

import { ignoresContextMenu } from "../_lib/navigator-menu";
import { isOnlyTab, type DragEndEvent, type TabDragSession } from "../_lib/tab-drag";
import { dropIndex, readTabDrag, resultTabDragType, tabDragType, writeTabDrag } from "../_lib/tab-order";
import { dropMarks, placeOf, resultEntryKey, resultPanelElementId, resultTabElementId, resultTabTitle, stripEntries, unitRects, type PlaceMenuItem, type PlaceVia, type StripEntry } from "../_lib/result-place";
import { resultPlaceCopy } from "../_lib/result-place.copy";
import { scriptIconOf } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { ScriptSummary } from "../_lib/scripts.schema";
import { closeShortcutLabel, moveMenu, overflowOf, revealOffset, scrollStep, stripKeyTarget, tabListLabels, tabMenu, tabTitleOf, wheelScroll, type CloseScope } from "../_lib/tab-strip";
import { stripTitles } from "../_lib/tab-titles";
import type { QueryTab, ResultPlace } from "../_lib/workbench-model";
import { workbenchCopy } from "../_lib/workbench.copy";
import { ResultTabIcon } from "./result-place-button";
import { ScriptIconView } from "./script-icon";

const copy = workbenchCopy.tabs;

export const tabElementId = (id: string) => `workbench-tab-${id}`;
export const panelElementId = (id: string) => `workbench-panel-${id}`;

type Opening = "first" | "menu";
type Point = { x: number; y: number };
type StripMenu = { kind: "tab" | "windows" | "result"; tabId: string; point: Point; initialFocus: Opening } | { kind: "list"; point: Point; initialFocus: Opening };

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
  /** RN-ABAS-002 e 003: levar a aba para uma janela nova (pelo menu) ou para outra janela aberta. */
  onMove: (tabId: string, target: TabMoveTarget) => void;
  /**
   * RN-ABAS-010: o arraste desta janela (`createTabDragSession`), que a faixa começa no `dragstart` e marca quando a soltura cai nela; o véu marca a dele.
   * Sem ele (os testes), a faixa só arrasta.
   */
  drag?: TabDragSession;
  /** RN-ABAS-010: o arraste de uma aba terminou (`dragend`): quem a desenha decide, pelo que a soltura marcou, se pede a janela nova. */
  onDragEnd?: (tabId: string, event: DragEndEvent) => void;
  /** RN-ABAS-003: uma aba de outra janela foi solta nesta faixa. */
  onReceive: (fromWindowId: number, tabId: string, insertAt: number) => void;
  /** RN-SQL-021: o que a aba mostra do estado dela, depois do nome: a marca do script que parou num erro e espera a resposta (`ScriptWaitingMark`). */
  markOf?: (tabId: string) => ReactNode;
  /** RN-ABAS-012: a aba do resultado da aba ativa é a entrada ativa da faixa. */
  resultActive?: boolean;
  /** RN-ABAS-012: escolher a entrada (o clique, as setas, a lista): a aba da consulta ou a do resultado dela. Sem isto, só a da consulta, por `onSelect`. */
  onShowEntry?: (tabId: string, view: "query" | "result") => void;
  /** RN-ABAS-012 e 014: trocar o lugar do resultado pelo menu de uma das abas, ou fechando a aba do resultado (volta ao painel). */
  onPlace?: (tabId: string, place: ResultPlace, via: Exclude<PlaceVia, "bar">) => void;
  /** RN-ABAS-014: os itens de "Onde mostrar o resultado" da aba (`placeMenu`, com "Numa janela" desabilitado enquanto ela vai para outra janela). */
  placeItemsOf?: (tabId: string) => PlaceMenuItem[];
  /** RN-ABAS-012: o ponto da aba do resultado (`ResultTabMark`), que sabe se ela é a ativa. */
  resultMarkOf?: (tabId: string, active: boolean) => ReactNode;
};

/**
 * RN-ABAS-009 (seção 39): as medidas da faixa, menores que as do canvas a pedido do dono. A faixa tem 28 px de altura (mais a borda de baixo), e cada aba
 * também, contando a borda de 2 px: 10 px antes do ícone (de 14 px), 6 px entre os itens e 4 px depois do X. O X tem 20 px desenhados, com o ícone de 12 px,
 * numa área de clique de 24 px centrada nele (o alvo mínimo da WCAG 2.2, 2.5.8). Os botões das pontas e o da lista: 24 px de largura, a altura da faixa e
 * o ícone de 14 px.
 */
const stripButton = "flex h-7 w-6 flex-none cursor-pointer items-center justify-center text-subtle transition-colors hover:bg-selected hover:text-ink";
const stripIcon = "size-3.5";

/**
 * A faixa de abas: uma linha só, que rola na horizontal. A roda comum rola as abas; com excedente, aparecem os botões de rolar nas
 * pontas; a aba ativa é sempre trazida à vista; e um botão no fim abre a lista de todas as abas. Botão direito (ou Shift+F10, ou a
 * tecla de menu) numa aba abre o menu com Fechar, Fechar as outras, Fechar as da direita e Fechar todas, e o botão do meio fecha a aba.
 * As setas movem entre as abas (dão a volta), Home e End vão à primeira e à última, e só a ativa entra na ordem do Tab.
 *
 * Os botões das pontas acendem por atributos (`data-left` e `data-right` da moldura) e não por estado: rolar não redesenha a faixa.
 * Os botões de rolar e o da lista são para o mouse; o teclado tem as setas, que trazem a aba à vista, e a tecla de menu.
 */
export function TabStrip({ tabs, activeTabId, connectionOf, environmentOf, scriptOf, onSelect, onClose, windowId, onReorder, onMove, onReceive, markOf, drag, onDragEnd, resultActive = false, onShowEntry, onPlace, placeItemsOf, resultMarkOf }: TabStripProps) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<StripMenu | null>(null);
  // RN-ABAS-008: o nome curto na barra; o inteiro fica na dica.
  const titles = stripTitles(tabs);
  // RN-ABAS-012: as entradas da faixa, a aba do resultado logo depois da dela. As setas, Home, End, a lista e o arraste andam por elas.
  const entries = stripEntries(tabs);
  const isActive = (entry: StripEntry) => entry.tab.id === activeTabId && entry.result === resultActive;
  const elementIdOf = (entry: StripEntry) => (entry.result ? resultTabElementId(entry.tab.id) : tabElementId(entry.tab.id));
  const show = (entry: StripEntry) => (onShowEntry === undefined ? onSelect(entry.tab.id) : onShowEntry(entry.tab.id, entry.result ? "result" : "query"));
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

  /**
   * As caixas das abas na tela, na ordem da faixa: é por elas que se acha onde a aba solta entra. A aba e a do resultado dela são uma caixa só (RN-ABAS-012),
   * e a posição é a da lista de abas.
   */
  function tabRects() {
    const children = scroller.current === null ? [] : [...scroller.current.querySelectorAll<HTMLElement>("[data-strip-entry]")];
    return unitRects(
      entries,
      children.map((child) => {
        const { left, width } = child.getBoundingClientRect();
        return { left, width };
      }),
    );
  }

  const carriesTab = (event: DragEvent) => event.dataTransfer.types.includes(tabDragType);
  // O marcador de soltar de cada entrada: nunca entre a aba da consulta e a do resultado dela (RN-ABAS-012).
  const marks = dropMarks(entries, dropAt);

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
    const dropped = readTabDrag(event.dataTransfer.getData(tabDragType));
    if (dropped === null) return;

    const index = dropIndex(tabRects(), event.clientX);
    if (dropped.windowId === windowId) {
      // A soltura caiu na faixa da própria janela: o fim do arraste não pede janela nova (RN-ABAS-010).
      drag?.mark("strip");
      onReorder(dropped.tabId, index);
    } else if (dropped.windowId !== null) onReceive(dropped.windowId, dropped.tabId, index);
  }

  /**
   * RN-ABAS-010: o fim do arraste. Quem decide é quem recebeu a soltura (a faixa ou o véu, que marcaram), e não o `dropEffect`: a faixa só entrega o que
   * o `dragend` traz (o efeito, o ponto na tela e na página) a quem a desenha.
   */
  function handleDragEnd(event: DragEvent, tab: QueryTab) {
    setDropAt(null);
    const view = event.currentTarget.ownerDocument.defaultView;
    onDragEnd?.(tab.id, {
      effect: event.dataTransfer.dropEffect,
      screen: { x: event.screenX, y: event.screenY },
      client: { x: event.clientX, y: event.clientY },
      viewport: { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, entry: StripEntry, index: number) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      // Abre no pé da aba, com o foco no primeiro item.
      event.preventDefault();
      const { left, bottom } = event.currentTarget.getBoundingClientRect();
      open({ kind: entry.result ? "result" : "tab", tabId: entry.tab.id, point: { x: left + 28, y: bottom }, initialFocus: "first" });
      return;
    }

    const target = stripKeyTarget(event.key, index, entries.length);
    if (target === null) return;

    event.preventDefault();
    show(entries[target]);
    document.getElementById(elementIdOf(entries[target]))?.focus();
  }

  function handleContextMenu(event: MouseEvent, entry: StripEntry) {
    event.preventDefault();
    open({ kind: entry.result ? "result" : "tab", tabId: entry.tab.id, point: { x: event.clientX, y: event.clientY }, initialFocus: "menu" });
  }

  /** RN-ABAS-014: o submenu "Onde mostrar o resultado" da aba de consulta, no menu dela e no da aba do resultado. */
  function placeSubmenu(tabId: string): ContextMenuItem | null {
    if (onPlace === undefined || placeItemsOf === undefined) return null;
    const items = placeItemsOf(tabId).map((item): ContextMenuItem => ({ id: `place:${item.place}`, label: item.label, checked: item.checked, disabled: item.disabled, hint: item.hint, onSelect: () => onPlace(tabId, item.place, "menu") }));
    return { id: "place", label: resultPlaceCopy.button.label, submenu: { label: resultPlaceCopy.button.menuLabel, groups: [items] } };
  }

  /**
   * RN-ABAS-012: a aba do resultado, logo depois da dela: "Resultado · <título da aba>", com o ícone do resultado, o selo do ambiente da conexão da aba e o
   * ponto (`resultMarkOf`). Ela não muda de lugar sozinha (arrastada pela faixa, não há marcador, e soltá-la nela não faz nada) nem vai sozinha para outra
   * janela; o tipo do arraste é o dela (`application/x-prism-result-tab`), que as faixas não aceitam. Fechá-la (o X, o clique do meio, o Ctrl+W, "Voltar para o
   * painel") volta o resultado ao painel, sem perguntar nada.
   */
  function renderResultEntry(tab: QueryTab, index: number, selected: boolean) {
    const title = resultTabTitle(titles.get(tab.id) ?? tab.title);
    const name = titles.get(tab.id) ?? tab.title;
    const entry: StripEntry = { key: resultEntryKey(tab.id), tab, result: true };
    const back = () => onPlace?.(tab.id, "panel", "close");

    return (
      <div
        key={entry.key}
        data-result-tab-id={tab.id}
        data-strip-entry=""
        draggable
        data-drop={marks[index]}
        onDragStart={(event) => {
          event.dataTransfer.setData(resultTabDragType, writeTabDrag({ windowId, tabId: tab.id }));
          event.dataTransfer.effectAllowed = "move";
          drag?.begin(tab.id, "result");
        }}
        onDragEnd={(event) => handleDragEnd(event, tab)}
        onContextMenu={(event) => handleContextMenu(event, entry)}
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          back();
        }}
        className={cn(
          "flex h-7 flex-none items-stretch border-b-2 data-[drop=after]:shadow-[inset_-2px_0_0_var(--color-accent)]",
          selected ? "border-accent bg-panel text-ink" : "border-transparent text-muted hover:bg-panel/60 hover:text-ink",
        )}
      >
        <button
          type="button"
          role="tab"
          id={resultTabElementId(tab.id)}
          aria-selected={selected}
          aria-controls={resultPanelElementId(tab.id)}
          tabIndex={selected ? 0 : -1}
          title={resultPlaceCopy.tab.hint(name)}
          onClick={() => show(entry)}
          onKeyDown={(event) => handleKeyDown(event, entry, index)}
          className="flex cursor-pointer items-center gap-1.5 pr-1 pl-2.5"
        >
          <ResultTabIcon className={stripIcon} />
          <span className="max-w-[200px] truncate">{title}</span>
          {resultMarkOf?.(tab.id, selected) ?? null}
          <ShownEnvironmentPill environment={environmentOf(tab.connectionId)} className="h-4 px-1.5 leading-4" />
        </button>
        <button type="button" aria-label={resultPlaceCopy.tab.close(name)} title={resultPlaceCopy.tab.closeHint(shortcut)} onClick={back} className="group/close mr-0.5 flex size-6 flex-none cursor-pointer items-center justify-center self-center rounded-sm text-subtle">
          <span className="flex size-5 items-center justify-center rounded-sm transition-colors group-hover/close:bg-selected group-hover/close:text-ink">
            <CloseIcon className="size-3" />
          </span>
        </button>
      </div>
    );
  }

  // A lista distingue as abas de mesmo título de conexões diferentes (mostra a conexão delas).
  const listLabels = tabListLabels(tabs, (connectionId) => connectionOf(connectionId)?.name);
  const labelOf = (tab: QueryTab) => listLabels[tabs.indexOf(tab)] ?? tab.title;
  function menuGroupsOf(current: StripMenu): ContextMenuItem[][] {
    // RN-ABAS-012: na lista, a aba do resultado vem logo depois da dela, com o mesmo título que tem na faixa.
    if (current.kind === "list")
      return [entries.map((entry) => ({ id: entry.key, label: entry.result ? resultTabTitle(titles.get(entry.tab.id) ?? entry.tab.title) : labelOf(entry.tab), icon: isActive(entry) ? <CheckIcon /> : undefined, onSelect: () => show(entry) }))];

    const { tabId, point } = current;
    // RN-ABAS-012: o menu da aba do resultado: "Ir para a consulta" (F6), "Onde mostrar o resultado" e "Voltar para o painel" (Ctrl+W).
    if (current.kind === "result") {
      const place = placeSubmenu(tabId);
      return [
        [{ id: "goToQuery", label: resultPlaceCopy.tab.goToQuery, shortcut: resultPlaceCopy.tab.f6, onSelect: () => (onShowEntry === undefined ? onSelect(tabId) : onShowEntry(tabId, "query")) }],
        ...(place === null ? [] : [[place]]),
        [{ id: "backToPanel", label: resultPlaceCopy.tab.backToPanel, shortcut, onSelect: () => onPlace?.(tabId, "panel", "close") }],
      ];
    }
    if (current.kind === "windows") return [otherWindows.map((entry) => ({ id: `window-${entry.id}`, label: copy.windowName(entry.number, entry.activeTitle, entry.tabCount), onSelect: () => onMove(tabId, { kind: "window", windowId: entry.id }) }))];

    const closing = tabMenu(tabs, tabId, activeTabId, shortcut).map((group) => group.map((item): ContextMenuItem => ({ id: item.scope, label: item.label, shortcut: item.shortcut, disabled: item.disabled, onSelect: () => onClose(item.scope, tabId) })));
    const moving = moveMenu(otherWindows.length, windowId !== null, isOnlyTab(tabs)).map(
      (item): ContextMenuItem => ({
        id: item.action,
        label: item.label,
        disabled: item.disabled,
        hint: item.hint,
        // "Mover para a janela…" abre, no mesmo lugar, a lista das outras janelas.
        onSelect: () => (item.action === "newWindow" ? onMove(tabId, { kind: "new" }) : open({ kind: "windows", tabId, point, initialFocus: "first" })),
      }),
    );
    // RN-ABAS-014: depois dos itens de mover, o submenu "Onde mostrar o resultado", só na aba de consulta.
    const tab = tabs.find((candidate) => candidate.id === tabId);
    const place = tab === undefined || placeOf(tab) === null ? null : placeSubmenu(tabId);
    return [...closing, ...(moving.length === 0 ? [] : [moving]), ...(place === null ? [] : [[place]])];
  }

  const menuGroups = menu === null ? [] : menuGroupsOf(menu);
  const menuTab = menu !== null && menu.kind !== "list" ? tabs.find((tab) => tab.id === menu.tabId) : undefined;
  const menuTitle = menuTab?.title;

  return (
    <div
      ref={frame}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropAt(null);
      }}
      onDrop={handleDrop}
      // RN-ABAS-010: a faixa fica por cima do véu do arraste, e o que cai nela é dela (`isInTabStrip`).
      data-tab-strip=""
      className="group/strip relative z-50 flex items-stretch border-b border-border bg-background px-2"
    >
      <button type="button" tabIndex={-1} aria-label={copy.scrollLeft} title={copy.scrollLeft} onClick={() => scrollBy(-1)} className={cn(stripButton, "hidden group-data-[left]/strip:flex")}>
        <ChevronIcon className={cn(stripIcon, "rotate-90")} />
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
        {entries.map((entry, index) => {
          const tab = entry.tab;
          const selected = isActive(entry);
          if (entry.result) return renderResultEntry(tab, index, selected);
          const label = tabTitleOf(tab);
          const script = tab.script === undefined ? undefined : scriptOf?.(tab.script.id);

          return (
            <div
              key={entry.key}
              data-tab-id={tab.id}
              data-strip-entry=""
              // RN-ABAS-001 a 003: a aba se arrasta pela faixa, para fora da janela e até a faixa de outra janela.
              draggable
              data-drop={marks[index]}
              onDragStart={(event) => {
                event.dataTransfer.setData(tabDragType, writeTabDrag({ windowId, tabId: tab.id }));
                event.dataTransfer.effectAllowed = "move";
                // Nada muda na página aqui dentro: a sessão guarda o arraste e só avisa depois (RN-ABAS-010).
                drag?.begin(tab.id, "tab");
              }}
              onDragEnd={(event) => handleDragEnd(event, tab)}
              onContextMenu={(event) => handleContextMenu(event, entry)}
              // O botão do meio fecha a aba. O `mousedown` dele, no Windows, liga a rolagem automática: sem o `preventDefault` ela atrapalharia.
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose("one", tab.id);
              }}
              className={cn(
                "flex h-7 flex-none items-stretch border-b-2 data-[drop=after]:shadow-[inset_-2px_0_0_var(--color-accent)] data-[drop=before]:shadow-[inset_2px_0_0_var(--color-accent)]",
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
                onClick={() => show(entry)}
                onKeyDown={(event) => handleKeyDown(event, entry, index)}
                className="flex cursor-pointer items-center gap-1.5 pr-1 pl-2.5"
              >
                {tab.table ? <TableIcon className={stripIcon} /> : script !== undefined ? <ScriptIconView icon={scriptIconOf(script)} color={script.color} className={stripIcon} /> : <DocumentIcon className={stripIcon} />}
                <span className="max-w-[200px] truncate">{titles.get(tab.id) ?? tab.title}</span>
                {/* RN-SCRIPT-001: o ponto da mudança não salva é desenho; o leitor de tela ouve o texto. */}
                {label.unsaved ? (
                  <>
                    <span aria-hidden data-unsaved className="size-1.5 flex-none rounded-full bg-accent" />
                    <span className="sr-only">{scriptsCopy.tab.unsaved}</span>
                  </>
                ) : null}
                {markOf?.(tab.id) ?? null}
                {/* Na faixa, o selo tem 16 px de altura, o texto de 11 px e 6 px de cada lado; no navegador e na barra do editor ele não muda. */}
                <ShownEnvironmentPill environment={environmentOf(tab.connectionId)} className="h-4 px-1.5 leading-4" />
              </button>
              {/* A área de clique (24 px) é o botão; o desenho (20 px, o fundo no hover) é o miolo, centrado nela. */}
              <button type="button" aria-label={copy.close(tab.title)} title={copy.close(tab.title)} onClick={() => onClose("one", tab.id)} className="group/close mr-0.5 flex size-6 flex-none cursor-pointer items-center justify-center self-center rounded-sm text-subtle">
                <span className="flex size-5 items-center justify-center rounded-sm transition-colors group-hover/close:bg-selected group-hover/close:text-ink">
                  <CloseIcon className="size-3" />
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" tabIndex={-1} aria-label={copy.scrollRight} title={copy.scrollRight} onClick={() => scrollBy(1)} className={cn(stripButton, "hidden group-data-[right]/strip:flex")}>
        <ChevronIcon className={cn(stripIcon, "-rotate-90")} />
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
          <ChevronIcon className={stripIcon} />
        </button>
      ) : null}

      {menu === null ? null : (
        <ContextMenu
          key={`${menu.kind}@${menu.point.x},${menu.point.y}`}
          label={menu.kind === "tab" ? copy.menuLabel(menuTitle ?? "") : menu.kind === "result" ? resultPlaceCopy.tab.menuLabel(titles.get(menuTab?.id ?? "") ?? menuTitle ?? "") : menu.kind === "windows" ? copy.windowsLabel : copy.listLabel}
          point={menu.point}
          initialFocus={menu.initialFocus}
          groups={menuGroups}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
