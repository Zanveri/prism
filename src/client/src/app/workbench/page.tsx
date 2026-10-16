import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ConnectionDialog } from "@/app/connections/_components/connection-dialog";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { TopBar } from "@/components/layout/top-bar";
import { vaultLock } from "@/lib/api/vault-lock";

import { ConnectionCheckLabel } from "./_components/connection-check";
import { FirstUse } from "./_components/first-use";
import { Navigator } from "./_components/navigator";
import { NavigatorToggle } from "./_components/navigator-toggle";
import { ScriptsSection } from "./_components/scripts-section";
import { connectionReveal } from "./_lib/connection-intent";
import { keepsDialog, type ConnectionDialogOpen } from "./_lib/connection-dialog-state";
import { credentialsRequests, watchCredentialsMissing } from "./_lib/credentials-missing";
import { hideFocusTarget, navigatorShortcut, navigatorShortcutLabels } from "./_lib/navigator-layout";
import { useNavigatorHidden } from "./_lib/use-navigator-layout";
import { useWorkbenchOnScreen } from "./_lib/use-workbench-on-screen";
import { useWorkbench } from "./_lib/workbench-state";
import { StatusBar } from "./_components/status-bar";
import { WorkbenchTabs } from "./_components/workbench-tabs";
import { workbenchCopy } from "./_lib/workbench.copy";

const copy = workbenchCopy.navigator;

/** A largura do navegador: 300 px no canvas, 320 aqui para os nomes de coluna caberem inteiros; ajustável entre estes limites. */
const defaultWidth = 320;
const minWidth = 200;
const maxWidth = 640;
const keyStep = 16;

const clamp = (width: number) => Math.min(maxWidth, Math.max(minWidth, width));

/** A divisória entre o navegador e as abas: arrastar com o mouse, ou setas com o foco nela. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startX: event.clientX, startWidth: width });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag !== null) onResize(clamp(drag.startWidth + event.clientX - drag.startX));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(clamp(width + (event.key === "ArrowRight" ? keyStep : -keyStep)));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={copy.resize}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={handleKeyDown}
      className="-mx-0.5 z-10 w-1 flex-none cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 data-[dragging]:bg-accent"
      data-dragging={drag === null ? undefined : ""}
    />
  );
}

/**
 * A área de trabalho, a única tela principal (RN-NAV-001): a barra superior, o navegador à esquerda (largura ajustável), a faixa de abas
 * à direita e a barra de status embaixo. O que ela guarda — abas e nós abertos — está no `WorkbenchProvider`, acima das rotas, para ir às
 * Configurações e voltar não apagar nada.
 *
 * O formulário de conexão é um diálogo sobre ela (RN-NAV-004), aberto daqui: pelo navegador ("Nova conexão" da barra de ações, do menu de
 * uma pasta e do espaço vazio; "Editar conexão" do menu da conexão) e pelo primeiro uso. Salvar fecha o diálogo e pede à árvore que mostre a
 * conexão (`connectionReveal`). O diálogo some, com o que tinha, no bloqueio por inatividade e quando a área de trabalho sai da tela
 * (`keepsDialog`). Abre sozinho, na edição, quando conectar (pela árvore, por uma aba, pela barra do editor) é recusado por faltar o usuário ou a senha
 * da conexão (RN-TRANSF-016, `credentialsRequests`); com um diálogo de conexão já aberto, não abre outro.
 *
 * O navegador é retrátil (RN-NAV-008): o botão da barra de ações e o da barra superior (sempre à vista) o escondem e mostram, Ctrl+B também, e
 * Ctrl+Shift+E o mostra e leva o foco à busca. Escondido, ele fica MONTADO (`hidden` e `inert`: fora da tela, do teclado e do leitor de tela) e a
 * área das abas ocupa a largura toda; ao voltar, a árvore está como estava (nós abertos, rolagem, item escolhido, texto da busca), porque nada dela
 * saiu da memória, e a lista virtual se redesenha pelas regras de `row-measure.ts`. A escolha é lembrada por usuário (`useNavigatorHidden`).
 */
export function WorkbenchPage() {
  const [width, setWidth] = useState(defaultWidth);
  const { tabs, activeTabId } = useWorkbench();
  const folders = useQuery(foldersQuery);
  const connections = useQuery(connectionsQuery);
  // Sem nenhuma conexão cadastrada (RN-NAV-007), a área das abas é o primeiro uso, com "Nova conexão": aba nenhuma existe sem conexão.
  const firstUse = connections.data !== undefined && connections.data.length === 0;

  const onScreen = useWorkbenchOnScreen();
  const lockEpoch = useSyncExternalStore(vaultLock.subscribe, vaultLock.epoch, vaultLock.epoch);
  const connectionIds = useMemo(() => (connections.data === undefined ? null : new Set(connections.data.map((connection) => connection.id))), [connections.data]);
  const [dialog, setDialog] = useState<ConnectionDialogOpen | null>(null);
  // Ajuste durante a renderização (como no provedor): o diálogo que não deve continuar some antes de qualquer filho vê-lo.
  if (dialog !== null && !keepsDialog(dialog, { onScreen, lockEpoch, connectionIds })) setDialog(null);

  // RN-TRANSF-016: quem abre uma sessão e é recusado por faltar o usuário ou a senha pede o "Editar conexão" daquela conexão. As sessões da árvore são
  // observadas no cache; o executor de cada aba pede direto. Atende-se uma vez por pedido, com a área de trabalho na tela e a conexão na lista; com um
  // diálogo de conexão já aberto (o dela, ou outro com algo digitado), nada abre por cima.
  const queryClient = useQueryClient();
  useEffect(() => watchCredentialsMissing(queryClient), [queryClient]);
  useEffect(() => () => credentialsRequests.clear(), []);
  const credentialsRequest = useSyncExternalStore(credentialsRequests.subscribe, credentialsRequests.pending, credentialsRequests.pending);
  const [answeredCredentials, setAnsweredCredentials] = useState(0);
  if (credentialsRequest !== null && credentialsRequest.seq !== answeredCredentials && onScreen && connectionIds !== null) {
    setAnsweredCredentials(credentialsRequest.seq);
    if (dialog === null && connectionIds.has(credentialsRequest.connectionId)) setDialog({ request: { mode: "edit", connectionId: credentialsRequest.connectionId }, epoch: lockEpoch });
  }
  useEffect(() => {
    if (answeredCredentials !== 0) credentialsRequests.take(answeredCredentials);
  }, [answeredCredentials]);

  const openNew = (folderID: string | null) => setDialog({ request: { mode: "new", folderID }, epoch: lockEpoch });
  const openEdit = (connectionId: string) => setDialog({ request: { mode: "edit", connectionId }, epoch: lockEpoch });
  // O navegador retrátil (RN-NAV-008).
  const asideId = useId();
  const aside = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useNavigatorHidden();
  const shortcuts = navigatorShortcutLabels(typeof navigator === "undefined" ? "" : navigator.platform);
  // Para onde o foco vai depois de esconder ou mostrar: pedido no evento, feito depois de a tela mudar (um foco dentro de `display: none` se perde).
  const [focusRequest, setFocusRequest] = useState<{ target: "toggle" | "workArea" | "search"; seq: number } | null>(null);
  const requestFocus = (target: "toggle" | "workArea" | "search" | null) => {
    if (target !== null) setFocusRequest((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));
  };

  function hideNavigator(origin: "toolbar" | "toggle" | "shortcut") {
    requestFocus(hideFocusTarget(origin, { focusInside: aside.current?.contains(document.activeElement) ?? false, hasActiveTab: activeTabId !== null }));
    setHidden(true);
  }

  function showNavigator(focusSearch: boolean) {
    setHidden(false);
    if (focusSearch) requestFocus("search");
  }

  useLayoutEffect(() => {
    if (focusRequest === null) return;

    const target =
      focusRequest.target === "toggle"
        ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(asideId)}"]`)
        : focusRequest.target === "workArea"
          ? (document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) .cm-content') ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))
          : // Sem conexão nenhuma não há campo de busca: o foco vai à barra de ações, que é o que o navegador tem.
            (aside.current?.querySelector<HTMLElement>('input[type="search"]') ?? aside.current?.querySelector<HTMLElement>('[role="toolbar"] [tabindex="0"]') ?? null);
    target?.focus();
  }, [focusRequest, asideId]);

  // Ctrl+B e Ctrl+Shift+E valem com o foco em qualquer lugar da área de trabalho, e só com ela na tela, sem diálogo aberto e sem o bloqueio
  // (`navigatorShortcut`). O ouvinte é da janela, na fase de bolha: quem trata a tecla antes (um diálogo, que para a propagação; o editor, se um
  // dia usar uma delas) fica com ela.
  const latest = useRef({ hidden, hideNavigator, showNavigator });
  useEffect(() => {
    latest.current = { hidden, hideNavigator, showNavigator };
  });
  useEffect(() => {
    if (!onScreen) return;

    function onKeyDown(event: globalThis.KeyboardEvent) {
      const shortcut = navigatorShortcut(event, { onScreen: true, modalOpen: document.querySelector('[aria-modal="true"], dialog[open]') !== null, locked: vaultLock.isLocked() });
      if (shortcut === null) return;

      // O Ctrl+B de um campo editável faria negrito: a tecla é do atalho, e só dele.
      event.preventDefault();
      const { hidden: isHidden, hideNavigator: hide, showNavigator: show } = latest.current;
      if (shortcut === "reveal") show(true);
      else if (isHidden) show(false);
      else hide("shortcut");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onScreen]);

  const editingId = dialog?.request.mode === "edit" ? dialog.request.connectionId : null;
  const editing = editingId === null ? undefined : connections.data?.find((connection) => connection.id === editingId);
  const dialogRequest = dialog === null ? null : dialog.request.mode === "new" ? dialog.request : editing === undefined ? null : ({ mode: "edit", connection: editing } as const);

  return (
    // RN-CONFIG-009: a área de trabalho inteira na escala do canvas, 13/20 (`text-sm`), aqui e só aqui; quem tem tamanho próprio (o editor, a grade, as
    // etiquetas) fica com ele. Os diálogos abrem num portal no <body> e continuam no 14/22 dos formulários.
    <div className="flex h-full flex-col text-sm">
      <TopBar leading={<NavigatorToggle hidden={hidden} controls={asideId} shortcut={shortcuts.toggle} onToggle={() => (hidden ? showNavigator(false) : hideNavigator("toggle"))} />} />

      <div className="flex min-h-0 flex-1">
        {/* Escondido, fica montado: a árvore, a busca, a rolagem e o item escolhido continuam onde estavam (RN-NAV-008). */}
        <aside id={asideId} ref={aside} aria-label={copy.label} hidden={hidden} inert={hidden} style={{ width }} className="flex min-h-0 flex-none flex-col border-r border-border bg-panel">
          <h1 className="px-3 pt-2.5 pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{copy.title}</h1>
          <Navigator
            onNewConnection={openNew}
            onEditConnection={openEdit}
            onRevealed={() => {
              if (hidden) showNavigator(false);
            }}
            onHide={() => hideNavigator("toolbar")}
            hideShortcut={shortcuts.toggle}
          />
          {/* RN-SCRIPT-003: os scripts salvos, abaixo da árvore. */}
          <ScriptsSection />
        </aside>
        {hidden ? null : <ResizeHandle width={width} onResize={setWidth} />}
        {firstUse ? <FirstUse onNewConnection={() => openNew(null)} /> : <WorkbenchTabs />}
      </div>

      <StatusBar />

      {dialogRequest === null ? null : (
        <ConnectionDialog
          request={dialogRequest}
          folders={folders.data ?? []}
          openTabs={(connectionId) => tabs.filter((tab) => tab.connectionId === connectionId).length}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            connectionReveal.request(saved.id);
          }}
          checkIndicator={dialogRequest.mode === "edit" ? <ConnectionCheckLabel connectionId={dialogRequest.connection.id} /> : undefined}
        />
      )}
    </div>
  );
}
