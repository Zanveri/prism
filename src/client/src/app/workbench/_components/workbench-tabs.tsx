import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { ConfirmDialog, useToast } from "@/components/ui";
import { currentWindowId, endTabDrag, onTabWanted, onWindowCloseRequested, sendTabAway, tellWindows } from "@/lib/api/bridge";
import { vaultLock } from "@/lib/api/vault-lock";

import type { TabMoveTarget } from "../../../../electron/window-messages";

import { createDisconnectLog } from "../_lib/connection-intent";
import { exportTracker } from "../_lib/data-export/data-exports";
import { loadTracker, windowTransfers } from "../_lib/data-import/data-imports";
import { exitQuestion, totalOf, type ExitQuestion } from "../_lib/data-import/transfer-exits";
import { windowCloseStep } from "../_lib/data-export/export-exits";
import { liveEditors } from "../_lib/live-editors";
import { recall, recallForTransfer } from "../_lib/tab-memory";
import { afterPlaceChange, f6Action, isF6, placeAnnouncement, placeMenu, placeOf, resultOnView, resultPanelElementId, type PlaceVia } from "../_lib/result-place";
import { resultPlaceCopy } from "../_lib/result-place.copy";
import { resultWindows } from "../_lib/result-windows";
import { resultFocus, resultSlots } from "../_lib/result-slots";
import { createTabDragSession, dragEndRequest, isOnlyTab, type DragEndEvent } from "../_lib/tab-drag";
import { focusAfterChange, isLost, popupTakesFocus, stillWithRequester, tabEntries, tabFocus } from "../_lib/tab-focus";
import { tabMoveShortcut } from "../_lib/tab-order";
import { stripTitles } from "../_lib/tab-titles";
import { closeAsks, closeConfirmation, closeConfirmationText, isCloseShortcut, mergeCloseQueue, nextToClose, tabsToClose, type CloseAsks, type CloseScope } from "../_lib/tab-strip";
import { scriptsToAsk } from "../_lib/saved-scripts";
import { scriptsQuery } from "../_lib/scripts.service";
import { handOffTab } from "../_lib/tab-handoff";
import { serializeTab } from "../_lib/tab-transfer";
import type { TableRef } from "../_lib/table-diagram";
import { unsavedEdits, unsavedQuestion } from "../_lib/unsaved-edits";
import { isBusyState } from "../_lib/use-query-runner";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import { useWorkbench } from "../_lib/workbench-state";
import { isTableTab, type ResultPlace, type TableView } from "../_lib/workbench-model";
import { workbenchCopy } from "../_lib/workbench.copy";
import { QueryTabPanel } from "./query-tab";
import { focusResultIn, releaseFocusIn, resultHostOf } from "./result-host";
import { ResultTabMark } from "./result-tab-mark";
import { UnsavedScriptsDialog } from "./script-dialogs";
import { ScriptWaitingMark } from "./script-tabs";
import { TabDragVeil } from "./tab-drag-veil";
import { panelElementId, tabElementId, TabStrip } from "./tab-strip";
import { TableTabPanel } from "./table-tab/table-tab";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";
import { useScriptSaving, type SaveMode } from "./use-script-saving";

const copy = workbenchCopy.tabs;

/** Fechar abas, ou uma janela que não é a última, pergunta tudo (RN-ABAS-007). */
const askEverything = closeAsks({ closesTheApp: false });

/**
 * RN-ABAS-012: o painel da aba do resultado, logo depois do da aba dela: o lugar onde a área de resultado da aba se põe (`resultSlots`), com o nome
 * "Resultado de consulta-2.sql" (e não o da aba, que leva o ponto no nome). O conteúdo é da aba de consulta, que o desenha por portal (`ResultHost`).
 */
function ResultTabPanel({ tabId, label, hidden }: { tabId: string; label: string; hidden: boolean }) {
  const register = useCallback((element: HTMLDivElement | null) => resultSlots.set(tabId, "tab", element), [tabId]);
  return <div ref={register} role="tabpanel" id={resultPanelElementId(tabId)} aria-label={label} hidden={hidden} className={hidden ? undefined : "flex min-h-0 min-w-0 flex-1 flex-col"} />;
}

/**
 * A faixa de abas e o painel de cada uma. Cada aba é uma consulta (`QueryTab`) de uma conexão, com
 * a etiqueta do ambiente (RN-CONN-015); a que tem `table` é a de uma tabela (RN-TABELA-001), com o
 * ícone de tabela e o painel dela. Os painéis ficam todos montados e só o da aba ativa aparece:
 * trocar de aba não desfaz o editor da outra. O que cada aba executa e mostra fica no estado da
 * área de trabalho (`runnerOf`), que sobrevive a sair desta tela.
 *
 * Ctrl+W fecha a aba ativa quando o foco está aqui (a faixa, o editor, a vista da tabela). O app empacotado não tem menu no Windows e no
 * Linux, então nada mais responde a esse atalho; no macOS o menu do app não tem "Fechar janela". Os diálogos e o menu de contexto ficam
 * fora desta árvore de teclado (o menu para a propagação), e a tela de bloqueio é um diálogo por cima de tudo: nenhum fecha aba por engano.
 *
 * As abas mudam de lugar (RN-ABAS-001: arrastando, ou Ctrl+Shift+PageUp e PageDown na ativa) e passam para outra janela (RN-ABAS-002, 003 e 010: pelo
 * menu da aba; soltando-a em qualquer lugar que não seja uma faixa, dentro ou fora da janela, numa janela nova; ou soltando-a sobre outra janela, que a
 * recebe). A aba com comando em andamento não muda de janela, e a dos Registros com alterações não salvas pergunta antes se salva ou descarta. Fechar a
 * janela fecha as abas dela, com as perguntas de "Fechar todas" (RN-ABAS-004).
 */
export function WorkbenchTabs() {
  const { tabs, activeTabId, resultActive, showEntry, setResultPlace, setActiveTab, closeTab, updateTab, setTableView, openTableTab, openQueryTab, runnerOf, reorderTab, shiftTab, detachTab, releaseWindow, markScriptEdited, switchConnection, switchDatabase, restoredTableConnections, holdForWindowClose, releaseWindowClose } = useWorkbench();
  const toast = useToast();
  // RN-ABAS-008: o nome curto das abas (o do painel da aba do resultado também).
  const shortTitles = useMemo(() => stripTitles(tabs), [tabs]);
  const windowId = currentWindowId();
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  // RN-PASTA-005: o ambiente que a conexão de cada aba mostra, o próprio ou o herdado da pasta; o mesmo objeto enquanto as pastas não mudam.
  const environments = useMemo(() => environmentLookup(folders.data ?? []), [folders.data]);
  // RN-SCRIPT-006: o ícone e a cor da aba de um script vêm da lista dos scripts, que se atualiza depois do "Editar script…".
  const scripts = useQuery(scriptsQuery);
  const queryClient = useQueryClient();

  // RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S da aba de consulta, e o diálogo do nome. A função é estável: o painel memorizado de cada aba a recebe.
  const { save: saveScript, dialog: saveDialog } = useScriptSaving();
  const requestSave = useCallback((tabId: string, mode: SaveMode) => void saveScript(tabId, mode), [saveScript]);

  // Uma aba só está À VISTA se for a ativa e a área de trabalho for a tela mostrada (RN-SEG-001): a escondida não fala com o banco.
  const onScreen = useWorkbenchOnScreen();

  // RN-ABAS-010: o arraste da aba desta janela, que a faixa começa e marca, o véu marca, e o fim do arraste lê. A área das abas é onde o véu põe a frase.
  const [drag] = useState(() => createTabDragSession());
  const area = useRef<HTMLElement>(null);

  // Quem a pessoa desconectou: as vistas das tabelas dessas conexões esperam o clique, em vez de reabrir a sessão (`connection-intent.ts`).
  const [disconnectLog] = useState(() => createDisconnectLog(queryClient));
  const disconnected = useSyncExternalStore(disconnectLog.subscribe, disconnectLog.getSnapshot);
  // Uma aba com sessão é uma conexão conectada de novo: o "Atualizar" dos registros abre a sessão da aba, sem passar pela da árvore.
  useEffect(() => {
    for (const tab of tabs) if (tab.sessionId !== null && tab.connectionId !== null) disconnectLog.forget(tab.connectionId);
  }, [tabs, disconnectLog]);
  // RN-ABAS-006: as abas de tabela que voltaram na entrada voltam desconectadas, e nada conecta sozinho: as vistas delas esperam o clique, como as de uma
  // conexão que a pessoa desconectou.
  useEffect(() => {
    for (const connectionId of restoredTableConnections) disconnectLog.mark(connectionId);
  }, [restoredTableConnections, disconnectLog]);

  // `openTableTab` muda de identidade a cada mudança da lista de abas (ele a consulta), e o painel memorizado de cada tabela perderia o
  // `memo`. Ele recebe sempre esta mesma função, que chama a versão mais recente.
  // O mesmo com a troca do banco (RN-ARVORE-007) e da conexão (RN-ARVORE-008) da aba de consulta, que também consultam a lista de abas.
  const latestOpenTable = useRef(openTableTab);
  const latestOpenQuery = useRef(openQueryTab);
  const latestSwitchDatabase = useRef(switchDatabase);
  const latestSwitchConnection = useRef(switchConnection);
  // A lista de abas da última renderização, para o que roda depois de uma espera (a ida para outra janela, o fechamento da janela).
  const latestTabs = useRef(tabs);
  useEffect(() => {
    latestOpenTable.current = openTableTab;
    latestOpenQuery.current = openQueryTab;
    latestSwitchDatabase.current = switchDatabase;
    latestSwitchConnection.current = switchConnection;
    latestTabs.current = tabs;
  });
  const handleOpenTable = useCallback((connectionId: string, table: TableRef & { view?: TableView; database?: string }) => latestOpenTable.current(connectionId, table), []);
  // RN-GRADE-018: o "Abrir numa aba de consulta" do "Gerar SQL", nos Registros e no resultado.
  const handleOpenQuery = useCallback((connectionId: string, sql: string, database?: string) => latestOpenQuery.current(connectionId, sql, database), []);
  const handleSwitchDatabase = useCallback((tabId: string, database: string | undefined) => latestSwitchDatabase.current(tabId, database), []);
  const handleSwitchConnection = useCallback((tabId: string, connectionId: string) => latestSwitchConnection.current(tabId, connectionId), []);

  // RN-ABAS-014: as abas que estão indo para outra janela ("Numa janela" fica desabilitado nelas), e o anúncio da troca de lugar, para o leitor de tela.
  const [moving, setMoving] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  useEffect(() => resultFocus.forgetExcept(new Set(tabs.map((tab) => tab.id))), [tabs]);
  useEffect(() => tabFocus.forgetExcept(new Set(tabs.map((tab) => tab.id))), [tabs]);
  // RN-ABAS-015: as abas cuja janela do resultado está aberta e não minimizada: o resultado delas está à vista, qualquer que seja a aba ativa.
  const shownWindows = useSyncExternalStore(resultWindows.subscribe, resultWindows.shownTabs, resultWindows.shownTabs);
  const locked = useSyncExternalStore(vaultLock.subscribe, vaultLock.isLocked, vaultLock.isLocked);

  /**
   * Seção 39 (RN-ABAS-011, 012 e 014): troca o lugar do resultado da aba, sem executar nada (a área é a mesma, e só muda de lugar). Antes, o campo de edição
   * de uma célula aberto é confirmado (o foco sai da área). Depois, o que fica ativo e onde fica o foco (`afterPlaceChange`), e o anúncio, numa região
   * `role="status"`, sem toast.
   */
  function changePlace(tabId: string, to: ResultPlace, via: PlaceVia, at: { x: number; y: number } | null = null) {
    const tab = latestTabs.current.find((candidate) => candidate.id === tabId);
    const from = tab === undefined ? null : placeOf(tab);
    if (from === null || from === to) return;

    const after = afterPlaceChange({ to, via, resultWasActive: resultActive && activeTabId === tabId });
    releaseFocusIn(tabId);
    setResultPlace(tabId, to);
    if (after.show !== "keep") showEntry(tabId, after.show);
    if (after.focus !== null) resultFocus.request(tabId, after.focus);
    setAnnouncement((current) => ({ text: placeAnnouncement(to), seq: current.seq + 1 }));
    resultWindows.forgetFailure(tabId);

    // RN-ABAS-013 e 017: a janela do resultado abre a pedido da pessoa, agora (o botão, o menu), e nunca por um efeito. O lugar já vale; se a janela não abrir, o
    // resultado volta para onde estava, com o aviso. A janela que deixa de ser o lugar fecha pelo Prism, e "Voltar para o painel" e o botão de lugar da janela do resultado trazem a janela da aba à frente.
    if (to === "window") {
      void resultWindows.open(tabId, { mode: "focus", ...(at === null ? {} : { at }), title: shortTitles.get(tabId) ?? tab?.title ?? "" }).then((opened) => {
        if (opened) return;
        setResultPlace(tabId, from);
        toast.warning(resultPlaceCopy.windowFailed);
      });
    } else if (from === "window" && via !== "windowClosed") {
      // Quem trocou de dentro da janela do resultado (o botão dela, "Voltar para o painel") a vê fechar: o foco prometido (RN-ABAS-014) é da janela da aba, e o
      // sistema não escolheria ela. O menu das abas é da própria janela da aba, que já está à frente.
      void resultWindows.close(tabId).then(() => (via === "back" || via === "bar" ? void resultWindows.focus(tabId, "opener") : undefined));
    }
  }
  const latestChangePlace = useRef(changePlace);
  useEffect(() => {
    latestChangePlace.current = changePlace;
  });
  // O botão da barra do resultado (no painel memorizado de cada aba): a função é estável e chama a versão mais recente.
  const handlePlace = useCallback((tabId: string, place: ResultPlace) => latestChangePlace.current(tabId, place, "bar"), []);
  // RN-ABAS-013: "Voltar para o painel" da janela do resultado (e o Ctrl+W nela): a aba da consulta fica ativa, com o foco no resultado, e a janela da aba vem à frente.
  const handleBack = useCallback((tabId: string) => latestChangePlace.current(tabId, "panel", "back"), []);
  // RN-ABAS-014: o F6 com o resultado numa janela. Do editor, a janela do resultado vem à frente (com o foco no resultado); do resultado, a janela da aba, com a
  // consulta ativa e o foco no editor.
  // `link`: um link da área de resultado abriu outra tela na janela da aba (o "Instalar driver"), e a janela da aba vem à frente.
  function focusWindow(tabId: string, target: "result" | "opener" | "link") {
    if (target === "opener") {
      // O pedido de foco do editor só vale se a troca vai redesenhar a aba (a consulta não estava à frente): o editor que já está à vista é focado por quem pediu.
      const switching = activeTabId !== tabId || resultActive;
      showEntry(tabId, "query");
      if (switching) resultFocus.request(tabId, "editor");
    }
    void resultWindows.focus(tabId, target === "result" ? "result" : "opener");
  }
  const latestFocusWindow = useRef(focusWindow);
  useEffect(() => {
    latestFocusWindow.current = focusWindow;
  });
  const handleFocusWindow = useCallback((tabId: string, target: "result" | "opener" | "link") => latestFocusWindow.current(tabId, target), []);

  // RN-ABAS-013 e 017: o que o processo principal conta das janelas do resultado (o fechamento, com o motivo, e o estado), enquanto a área de trabalho está
  // montada; ao desmontar (o "Sair"), as janelas fecham pelo Prism. A pessoa que fecha a janela pelo sistema volta o resultado ao painel, sem perguntar nada.
  useEffect(() => resultWindows.connect(), []);
  useEffect(() => resultWindows.onUserClosed((tabId) => latestChangePlace.current(tabId, "panel", "windowClosed")), []);

  // RN-ABAS-016: as janelas que as abas pedem (a volta das abas na entrada e no desbloqueio, a aba que chegou de outra janela) abrem uma a uma, na ordem das
  // abas e a da aba ativa por último, sem tomar o foco; as que deixaram de ser pedidas fecham, pelo Prism. O bloqueio e o "Sair" as fecham (nada do que estava
  // aberto fica à vista), e o lugar das abas continua o que era. Quem abre por ação da pessoa é `changePlace`; isto não abre duas vezes (a abertura é idempotente).
  const windowTabs = tabs.filter((tab) => placeOf(tab) === "window" && !moving.has(tab.id));
  const windowKey = `${windowTabs.map((tab) => tab.id).join(",")}|${windowTabs.some((tab) => tab.id === activeTabId) ? activeTabId : ""}|${locked}`;
  useEffect(() => {
    if (locked) {
      void resultWindows.closeAll();
      return;
    }
    const ordered = [...windowTabs.filter((tab) => tab.id !== activeTabId), ...windowTabs.filter((tab) => tab.id === activeTabId)];
    resultWindows.reconcile(
      ordered.map((tab) => ({ tabId: tab.id, title: shortTitles.get(tab.id) ?? tab.title })),
      (tabId) => {
        // A janela não abriu: o resultado fica no painel (onde se vê), com o aviso, e o lugar guardado passa a ser o painel.
        toast.warning(resultPlaceCopy.windowFailed);
        latestChangePlace.current(tabId, "panel", "windowClosed");
      },
    );
    // `windowKey` resume as abas pedidas, a ativa e o bloqueio; o resto vem da renderização de agora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);
  // O título da janela acompanha o da aba (RN-ABAS-008 e 013).
  useEffect(() => {
    for (const tab of tabs) if (placeOf(tab) === "window") resultWindows.setTitle(tab.id, shortTitles.get(tab.id) ?? tab.title);
  }, [tabs, shortTitles, shownWindows]);

  // RN-ABAS-014: o F6 com o resultado numa aba troca a entrada ativa, com o foco no resultado ou no editor.
  const handleToggleEntry = useCallback(
    (tabId: string, view: "query" | "result") => {
      showEntry(tabId, view);
      resultFocus.request(tabId, view === "result" ? "result" : "editor");
    },
    [showEntry],
  );

  /**
   * Fechar várias de uma vez. `closeTab` parte da lista de abas que viu quando foi criado, então chamado várias vezes no mesmo instante
   * só a última remoção vale. A primeira fecha agora, e as demais esperam a lista mudar: cada mudança de `tabs` fecha a próxima da fila,
   * com o `closeTab` novo (cada uma pelo caminho de sempre: cancela o que roda e fecha a sessão dela, RN-SESSAO-004). Um segundo fechamento
   * no meio do primeiro se junta à fila (`mergeCloseQueue`), e o id que já saiu é pulado (`nextToClose`): a fila nunca fica parada.
   */
  const pendingClose = useRef<string[]>([]);
  // Esta rodada fechou uma da fila: ainda falta ver a lista mudar, e o foco só se decide no fim (RN-ABAS-019).
  const closingStep = useRef(false);
  useEffect(() => {
    const { next, rest } = nextToClose(pendingClose.current, new Set(tabs.map((tab) => tab.id)));
    pendingClose.current = rest;
    closingStep.current = next !== null;
    if (next !== null) closeTab(next);
  }, [tabs, closeTab]);

  /**
   * RN-ABAS-019: o foco depois de a aba aparecer. Um lugar só decide QUANDO (cada aba diz COMO, em `tabEntries`), num efeito passivo: ele roda depois dos efeitos dos
   * painéis e do campo de filtro, que cria o CodeMirror num efeito. Só age com a fila de fechar vazia. Atende o pedido de quem abriu a aba (`tabFocus`), e o
   * consome em qualquer caso; a `version` refaz o efeito quando a aba pedida já é a ativa e nada mais mudou. O pedido de uma aba que ainda não é a ativa espera:
   * a lista de abas e a aba ativa chegam num desenho só, mas quem pede depois de uma espera (o script que vem da API) pode ter a loja avisada antes.
   */
  const requestVersion = useSyncExternalStore(tabFocus.subscribe, tabFocus.version, tabFocus.version);
  useEffect(() => {
    if (activeTabId === null || closingStep.current || pendingClose.current.length > 0) return;
    const request = tabFocus.take(activeTabId);
    if (request === null) return;

    const active = document.activeElement;
    const decision = focusAfterChange({
      request: true,
      lastRegion: null,
      lost: isLost(active, document),
      atRequester: stillWithRequester(request, active),
      hasTabs: true,
      // Um diálogo, um menu ou uma lista que tomou o foco, o cofre bloqueado ou outra tela à mostra: o foco não é de ninguém aqui. A lista de sugestões do editor, que fica
      // aberta quando o Ctrl+clique no nome de uma tabela esconde o painel dele, não toma o foco (`popupTakesFocus`).
      blocked: !onScreen || vaultLock.isLocked() || popupTakesFocus(document),
      // O F6 e a troca do lugar do resultado já prometeram o foco (RN-ABAS-014): quem os pediu o leva quando puder.
      promised: resultFocus.pending(activeTabId),
    });
    if (decision === "entry") tabEntries.focus(activeTabId);
  }, [requestVersion, activeTabId, resultActive, tabs, onScreen]);

  const closeNow = useCallback(
    (scope: CloseScope, tabId: string) => {
      const ids = tabsToClose(scope, tabs, tabId);
      if (ids.length === 0) return;

      pendingClose.current = mergeCloseQueue(pendingClose.current, ids.slice(1));
      closeTab(ids[0]);
      // As outras e as da direita deixam a aba do menu: é ela que fica à vista, e não a vizinha da última que fechou.
      if (scope === "others" || scope === "right") setActiveTab(tabId);
    },
    [tabs, closeTab, setActiveTab],
  );

  // Fechar várias abas pergunta UMA vez quando alguma das que fecham é consulta com SQL digitado (o texto não volta na próxima entrada); fechar uma só, não.
  // Fechar o app não pergunta (RN-ABAS-007: as abas voltam).
  const [confirm, setConfirm] = useState<{ scope: CloseScope; tabId: string; total: number; withSql: number } | null>(null);
  const askAboutSql = useCallback(
    (scope: CloseScope, tabId: string, asks: CloseAsks = askEverything) => {
      if (!asks.sql) return closeNow(scope, tabId);
      const question = closeConfirmation(scope, tabs, tabId);
      if (question === null) closeNow(scope, tabId);
      else setConfirm({ scope, tabId, ...question });
    },
    [tabs, closeNow],
  );

  // RN-SCRIPT-001: depois dos Registros e antes da pergunta do SQL, a dos scripts com mudança não salva entre as abas que fecham. Fechar o app não pergunta
  // (RN-ABAS-007: o script volta com a marca de mudança não salva).
  const [scriptQuestion, setScriptQuestion] = useState<{ scope: CloseScope; tabId: string; dirty: { id: string; name: string }[]; saving: boolean } | null>(null);
  const askAboutScripts = useCallback(
    (scope: CloseScope, tabId: string, asks: CloseAsks = askEverything) => {
      if (!asks.scripts) return askAboutSql(scope, tabId, asks);
      const dirty = scriptsToAsk(tabsToClose(scope, tabs, tabId), tabs).map((tab) => ({ id: tab.id, name: tab.script?.name ?? tab.title }));
      if (dirty.length === 0) askAboutSql(scope, tabId);
      else setScriptQuestion({ scope, tabId, dirty, saving: false });
    },
    [tabs, askAboutSql],
  );
  // Depois de salvar (que espera a API e, num script que sumiu, o diálogo do nome) a pergunta do SQL usa a lista de abas daquele instante.
  const latestAskAboutSql = useRef(askAboutSql);
  useEffect(() => {
    latestAskAboutSql.current = askAboutSql;
  });

  async function saveScriptsAndClose(question: { scope: CloseScope; tabId: string; dirty: { id: string }[] }) {
    setScriptQuestion((current) => (current === null ? null : { ...current, saving: true }));
    for (const { id } of question.dirty) {
      if (await saveScript(id, "save")) continue;
      // Não gravou (cancelou o nome, a API recusou ou caiu): nada fecha, e a janela fica aberta.
      setScriptQuestion(null);
      setWindowClosing(false);
      releaseWindowClose();
      return;
    }
    setScriptQuestion(null);
    latestAskAboutSql.current(question.scope, question.tabId);
  }

  // RN-EDIT-007: antes, as alterações não salvas dos Registros das abas que fecham: uma aba oferece Salvar; várias, só Descartar e Cancelar. Levar a aba
  // para outra janela pergunta o mesmo (as alterações não salvas não mudam de janela): Salvar e levar, ou Descartar e levar.
  // Elas não voltam na próxima entrada, e perguntam também ao fechar o app (RN-ABAS-007); `asks` diz o que vem depois.
  type Intent = { kind: "close"; scope: CloseScope; asks: CloseAsks } | { kind: "move"; target: TabMoveTarget };
  const [unsaved, setUnsaved] = useState<{ intent: Intent; tabId: string; count: number; canSave: boolean; saving: boolean } | null>(null);
  const handleClose = useCallback(
    (scope: CloseScope, tabId: string, asks: CloseAsks = askEverything) => {
      const question = unsavedQuestion(tabsToClose(scope, tabs, tabId), unsavedEdits.countOf, unsavedEdits.saveOf);
      if (question === null) askAboutScripts(scope, tabId, asks);
      else setUnsaved({ intent: { kind: "close", scope, asks }, tabId, ...question, saving: false });
    },
    [tabs, askAboutScripts, setUnsaved],
  );

  /**
   * Manda a aba para outra janela (RN-ABAS-002 e 003): o texto e a seleção do editor DESTE instante, o resultado, a sessão e o que a tela lembrava.
   * Só quando o processo principal a levou ela sai daqui, sem fechar a sessão (que agora é da outra janela). Com comando em andamento não vai: a
   * resposta chegaria aqui, à aba que já saiu. A atualização automática fica suspensa durante a ida, e a execução automática em andamento termina antes
   * de a aba ser lida (`handOffTab`, RN-GRADE-014). Por essa espera, a aba que vai é a da lista DE AGORA (`latestTabs`), e não a da renderização em que a
   * pessoa pediu: o título, o banco e o script dela podem ter mudado, e a aba que fechou nesse meio-tempo não vai, sem aviso.
   *
   * `saved`: a aba acabou de salvar as alterações para poder ir (RN-EDIT-007). Nos Registros, as linhas na tela são as de antes de salvar, e o Salvar
   * lê os registros de novo (RN-EDIT-005): a aba vai sem elas, e a janela que a recebe lê os registros na mesma sessão, já com o que foi gravado. A aba
   * de consulta já está com a grade salva (RN-EDIT-009), e vai com ela, sem executar nada.
   */
  async function sendTab(tabId: string, target: TabMoveTarget, saved = false) {
    const tabNow = () => latestTabs.current.find((candidate) => candidate.id === tabId);
    const asked = tabNow();
    if (asked === undefined) return;

    setMoving((current) => new Set([...current, tabId]));
    try {
      await sendNow(tabId, target, tabNow, asked, saved);
    } finally {
      setMoving((current) => new Set([...current].filter((id) => id !== tabId)));
    }
  }

  async function sendNow(tabId: string, target: TabMoveTarget, tabNow: () => (typeof tabs)[number] | undefined, asked: (typeof tabs)[number], saved: boolean) {
    const runner = runnerOf(tabId);
    const outcome = await handOffTab(runner, {
      // Enquanto a execução automática terminava, a aba pode ter fechado (ela saiu da lista, e o executor também: `runnerOf` lança) ou trocado de executor
      // (outro banco, outra conexão): nada vai.
      alive: () => {
        try {
          return tabNow() !== undefined && runnerOf(tabId) === runner;
        } catch {
          return false;
        }
      },
      prepare: (current) => {
        // `alive` acabou de achá-la na lista de agora.
        const tab = tabNow() ?? asked;
        const state = saved && isTableTab(tab) && !isBusyState(current) ? { status: "idle" as const } : current;
        return isBusyState(state) ? null : serializeTab({ tab, sessionId: runner.sessionOf(), editor: liveEditors.snapshot(tabId), state, memory: recallForTransfer(tabId), values: runner.values.snapshot() });
      },
      send: async (transfer) => {
        // RN-ABAS-016: a janela do resultado da aba fecha (pelo Prism) e reabre a partir da outra janela; a aba só vai depois de o processo principal confirmar.
        // Sem a confirmação em 3 segundos, ela vai assim mesmo, com o resultado no painel, e a janela que a recebe avisa.
        const closed = resultWindows.isOpen(tabId) ? await resultWindows.close(tabId) : true;
        const outgoing = closed || transfer.tab.resultPlace !== "window" ? transfer : { ...transfer, tab: { ...transfer.tab, resultPlace: "panel" as const }, resultWindowLost: true };
        const reply = await sendTabAway({ target, transfer: outgoing });
        // O elemento da aba arrastada fica na página até o fim do arraste (a outra janela pode recebê-la antes do `dragend` daqui, RN-ABAS-010).
        if (reply.ok) drag.whenIdle(tabId, () => detachTab(tabId));
        else toast.error(copy.moveFailed);
        return reply.ok;
      },
    });
    if (outcome === "busy") toast.warning(copy.moveBusy);
  }

  function handleMove(tabId: string, target: TabMoveTarget) {
    const count = unsavedEdits.countOf(tabId);
    if (count === 0) void sendTab(tabId, target);
    else setUnsaved({ intent: { kind: "move", target }, tabId, count, canSave: unsavedEdits.saveOf(tabId) !== null, saving: false });
  }

  // Depois da pergunta: fecha (com a pergunta do SQL, se for o caso) ou leva a aba. Levar depois de "Descartar" é levá-la sem as alterações: elas
  // ficam na memória desta janela, que a aba deixa, e não vão.
  function proceed(intent: Intent, tabId: string, saved = false) {
    if (intent.kind === "close") askAboutScripts(intent.scope, tabId, intent.asks);
    else void sendTab(tabId, intent.target, saved);
  }

  async function saveAndProceed(intent: Intent, tabId: string) {
    const save = unsavedEdits.saveOf(tabId);
    if (save === null) return;
    setUnsaved((current) => (current === null ? null : { ...current, saving: true }));
    const saved = await save();
    setUnsaved(null);
    if (saved) proceed(intent, tabId, true);
    else if (intent.kind === "close") {
      setWindowClosing(false);
      releaseWindowClose();
    }
  }

  // RN-ABAS-003: a aba desta janela foi solta na faixa de outra, e o processo principal pede que ela vá para lá, pelo caminho de sempre.
  const latestMove = useRef(handleMove);
  useEffect(() => {
    latestMove.current = handleMove;
  });
  useEffect(() => onTabWanted(({ tabId, target }) => latestMove.current(tabId, target)), []);

  /**
   * RN-ABAS-004: a pessoa fechou a janela. As abas fecham pelo caminho de "Fechar todas", com as perguntas dele; quando a última fechou, as sessões
   * a caminho terminam de fechar, as da árvore desta janela também, e a janela fecha de verdade. Cancelar uma pergunta deixa a janela aberta. Com o
   * cofre bloqueado não há o que perguntar: a API já fechou as sessões, e a janela fecha.
   */
  // RN-ABAS-006: a janela que fecha segura as abas dela no que volta (`holdForWindowClose`: fechar a última janela é o app saindo, e as abas voltam na
  // próxima entrada); a pergunta cancelada deixa a janela aberta e solta (`releaseWindowClose`), e o que fechou até ali sai do que volta.
  const [windowClosing, setWindowClosing] = useState(false);
  // RN-EXPORT-023 e RN-IMPORT-021: a pergunta das transferências começadas nesta janela, que vem antes das outras; `last`: a janela é a última, e fechá-la
  // fecha o Prism.
  const [transferQuestion, setTransferQuestion] = useState<{ last: boolean; question: ExitQuestion } | null>(null);
  const finishWindow = useCallback(() => {
    setWindowClosing(false);
    // RN-EXPORT-023 e RN-IMPORT-021: as transferências desta janela são canceladas só aqui, depois da última resposta (nada se cancela antes), e os destinos
    // das exportações soltos; só então a janela fecha. Sem nenhuma, não há o que esperar.
    void Promise.all([exportTracker.cancelAll(), loadTracker.cancelAll()])
      .then(() => releaseWindow())
      .finally(() => tellWindows((windows) => windows.close()));
  }, [releaseWindow]);
  const latestHandleClose = useRef(handleClose);
  useEffect(() => {
    latestHandleClose.current = handleClose;
  });
  /** As abas fecham pelo caminho de "Fechar todas"; sem nenhuma, a janela fecha. */
  const closeWindowTabs = useCallback(
    (last: boolean) => {
      const open = latestTabs.current;
      if (open.length === 0) return finishWindow();

      holdForWindowClose();
      setWindowClosing(true);
      // RN-ABAS-007: a última janela fecha o app, e só pergunta pelo que não volta na próxima entrada (as alterações não salvas da grade).
      latestHandleClose.current("all", open[0].id, closeAsks({ closesTheApp: last }));
    },
    [finishWindow, holdForWindowClose],
  );
  useEffect(
    () =>
      onWindowCloseRequested(({ last }) => {
        const counts = windowTransfers();
        const step = windowCloseStep({ locked: vaultLock.isLocked(), transfers: totalOf(counts), tabs: latestTabs.current.length });
        if (step === "finish") finishWindow();
        else if (step === "askTransfers") setTransferQuestion({ last, question: exitQuestion(counts, last ? "app" : "window") });
        else closeWindowTabs(last);
      }),
    [finishWindow, closeWindowTabs],
  );
  useEffect(() => {
    if (windowClosing && tabs.length === 0) finishWindow();
  }, [windowClosing, tabs, finishWindow]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || activeTabId === null) return;

    // RN-ABAS-001: Ctrl+Shift+PageUp e PageDown levam a aba ativa uma posição para o lado; o foco fica onde estava.
    const delta = tabMoveShortcut(event);
    if (delta !== null) {
      event.preventDefault();
      shiftTab(activeTabId, delta);
      return;
    }

    // RN-ABAS-014: o F6 na faixa vale o lado da entrada ativa (o editor e o resultado tratam o deles e não deixam a tecla chegar aqui).
    if (isF6(event)) {
      const tab = tabs.find((candidate) => candidate.id === activeTabId);
      const place = tab === undefined ? null : placeOf(tab);
      if (place === null || (event.target as Element).closest?.('[role="tablist"]') == null) return;
      event.preventDefault();
      const action = f6Action({ place, from: "strip", mode: recall(activeTabId, "layout")?.mode ?? "split", resultActive });
      const host = resultHostOf(activeTabId);
      if (action === "focusResult" && host !== null) focusResultIn(host);
      else if (action === "showResult" || action === "showQuery") handleToggleEntry(activeTabId, action === "showResult" ? "result" : "query");
      else if (action === "focusWindow" || action === "focusOpener") handleFocusWindow(activeTabId, action === "focusWindow" ? "result" : "opener");
      return;
    }

    if (!isCloseShortcut(event)) return;
    event.preventDefault();
    // RN-ABAS-012: com a aba do resultado ativa, o Ctrl+W volta o resultado ao painel, sem perguntar nada.
    if (resultActive) changePlace(activeTabId, "panel", "close");
    else handleClose("one", activeTabId);
  }

  // RN-ABAS-003: a aba de outra janela, solta na faixa desta (no lugar da soltura) ou no véu dela (no fim da faixa; também na janela sem abas).
  function receive(fromWindowId: number, tabId: string, index: number) {
    tellWindows((windows) => windows.requestTab({ fromWindowId, tabId, index }));
  }

  /**
   * RN-ABAS-010: o arraste de uma aba desta janela terminou. Quem decide é quem recebeu a soltura: a faixa daqui (a aba já mudou de lugar), o véu daqui (a
   * janela nova), outra janela (que a pede, RN-ABAS-003) ou ninguém (fora das janelas do Prism, a janela nova; o Esc e a barra de título, nada). O processo
   * principal lê o ponteiro e responde; a janela nova vem pelo caminho de sempre, com as perguntas de antes (RN-ABAS-002). A aba só sai quando ele
   * responde que a janela nova a recebeu.
   */
  async function handleDragEnd(tabId: string, event: DragEndEvent) {
    const request = dragEndRequest(drag.finish(), event, { windowId, onlyTab: isOnlyTab(latestTabs.current) });
    if (request === null) return;
    const reply = await endTabDrag(request);
    if (reply.action !== "newWindow") return;
    // A aba do resultado não vai para outra janela de abas: o resultado dela abre na janela do resultado, no ponto da soltura (RN-ABAS-010 e 013).
    if (request.kind === "result") latestChangePlace.current(tabId, "window", "drag", reply.at);
    else latestMove.current(tabId, reply.at === null ? { kind: "new" } : { kind: "new", at: reply.at });
  }

  const connectionOf = (connectionId: string | null) => (connectionId === null ? undefined : connections.data?.find((connection) => connection.id === connectionId));
  const environmentOf = (connectionId: string | null) => {
    const connection = connectionOf(connectionId);
    return connection === undefined ? null : environments.connection(connection);
  };
  const scriptOf = (scriptId: string) => scripts.data?.find((script) => script.id === scriptId);

  const question = confirm === null ? null : closeConfirmationText(confirm.total, confirm.withSql);

  return (
    <>
      <section ref={area} onKeyDown={handleKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabs.length === 0 ? null : (
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            connectionOf={connectionOf}
            environmentOf={environmentOf}
            scriptOf={scriptOf}
            onSelect={setActiveTab}
            onClose={handleClose}
            windowId={windowId}
            onReorder={reorderTab}
            onMove={handleMove}
            onReceive={receive}
            drag={drag}
            onDragEnd={(tabId, event) => void handleDragEnd(tabId, event)}
            // RN-SQL-021: a aba cujo script espera a resposta da pergunta de erro, que só aparece na aba à vista.
            markOf={(tabId) => <ScriptWaitingMark runner={runnerOf(tabId)} />}
            resultActive={resultActive}
            onShowEntry={showEntry}
            onPlace={(tabId, place, via) => changePlace(tabId, place, via)}
            placeItemsOf={(tabId) => {
              const tab = tabs.find((candidate) => candidate.id === tabId);
              return placeMenu((tab === undefined ? null : placeOf(tab)) ?? "panel", { moving: moving.has(tabId) });
            }}
            resultMarkOf={(tabId, active) => <ResultTabMark tabId={tabId} runner={runnerOf(tabId)} active={active} />}
          />
        )}

        {tabs.length === 0 ? (
          // RN-ABAS-003: a janela sem abas recebe a aba de outra janela pelo véu, como a que tem abas recebe fora da faixa.
          <div className="flex flex-1 flex-col justify-center gap-1.5 px-10">
            <h2 className="text-lg font-semibold">{copy.emptyTitle}</h2>
            <p className="max-w-[420px] text-muted">{copy.emptyHint}</p>
          </div>
        ) : (
          tabs.map((tab) => {
            const selected = tab.id === activeTabId;
            // RN-ABAS-012: com a aba do resultado ativa, o painel dela aparece, e o da aba da consulta fica escondido (montado, como o das outras abas).
            const place = placeOf(tab);
            const queryShown = selected && !resultActive;

            return (
              <Fragment key={tab.id}>
                <div role="tabpanel" id={panelElementId(tab.id)} aria-labelledby={tabElementId(tab.id)} hidden={!queryShown} className={queryShown ? "flex min-h-0 flex-1 flex-col" : undefined}>
                  {isTableTab(tab) ? (
                    <TableTabPanel tab={tab} table={tab.table} runner={runnerOf(tab.id)} connection={connectionOf(tab.connectionId)} environment={environmentOf(tab.connectionId)} visible={selected && onScreen} disconnected={disconnected.has(tab.connectionId)} onView={setTableView} onOpenTable={handleOpenTable} onOpenQuery={handleOpenQuery} />
                  ) : (
                    <QueryTabPanel
                      tab={tab}
                      runner={runnerOf(tab.id)}
                      engine={connectionOf(tab.connectionId)?.engine}
                      active={selected}
                      place={place ?? "panel"}
                      editorShown={queryShown}
                      resultShown={resultOnView({ place: place ?? "panel", selected, resultActive, windowShown: shownWindows.has(tab.id) })}
                      moving={moving.has(tab.id)}
                      onPlace={handlePlace}
                      onToggleEntry={handleToggleEntry}
                      onBackToPanel={handleBack}
                      onFocusWindow={handleFocusWindow}
                      onSqlChange={updateTab}
                      onEdited={markScriptEdited}
                      onSave={requestSave}
                      onSwitchConnection={handleSwitchConnection}
                      onOpenTable={handleOpenTable}
                      onOpenQuery={handleOpenQuery}
                      onSwitchDatabase={handleSwitchDatabase}
                    />
                  )}
                </div>
                {place === "tab" ? <ResultTabPanel tabId={tab.id} label={resultPlaceCopy.tab.panelLabel(shortTitles.get(tab.id) ?? tab.title)} hidden={!(selected && resultActive)} /> : null}
              </Fragment>
            );
          })
        )}

        {/* RN-ABAS-010: o véu do arraste da aba, sobre a janela inteira menos a faixa; a aba de outra janela solta nele entra no fim da faixa (RN-ABAS-003). */}
        <TabDragVeil session={drag} windowId={windowId} onlyTab={isOnlyTab(tabs)} area={area} onReceive={(fromWindowId, tabId) => receive(fromWindowId, tabId, latestTabs.current.length)} />
      </section>

      {unsaved === null ? null : (
        <UnsavedEditsDialog
          count={unsaved.count}
          canSave={unsaved.canSave}
          saving={unsaved.saving}
          onSave={() => void saveAndProceed(unsaved.intent, unsaved.tabId)}
          onDiscard={() => {
            setUnsaved(null);
            proceed(unsaved.intent, unsaved.tabId);
          }}
          onCancel={() => {
            setUnsaved(null);
            setWindowClosing(false);
            releaseWindowClose();
          }}
        />
      )}

      {scriptQuestion === null ? null : (
        <UnsavedScriptsDialog
          names={scriptQuestion.dirty.map((script) => script.name)}
          saving={scriptQuestion.saving}
          onSave={() => void saveScriptsAndClose(scriptQuestion)}
          onDiscard={() => {
            setScriptQuestion(null);
            askAboutSql(scriptQuestion.scope, scriptQuestion.tabId);
          }}
          onCancel={() => {
            setScriptQuestion(null);
            setWindowClosing(false);
            releaseWindowClose();
          }}
        />
      )}

      {saveDialog}

      {/* RN-ABAS-014: a troca do lugar do resultado, para o leitor de tela, sem toast. */}
      <div role="status" className="sr-only">
        {announcement.text === "" ? null : <span key={announcement.seq}>{announcement.text}</span>}
      </div>

      {/* RN-EXPORT-023: "Continuar exportando" tem o foco e o Esc, e deixa a janela aberta; confirmado, seguem as perguntas das abas. */}
      {transferQuestion === null ? null : (
        <ConfirmDialog
          open
          tone="danger"
          title={transferQuestion.question.title}
          description={transferQuestion.question.description}
          confirmLabel={transferQuestion.question.confirm}
          cancelLabel={transferQuestion.question.keep}
          onConfirm={() => {
            setTransferQuestion(null);
            closeWindowTabs(transferQuestion.last);
          }}
          onCancel={() => setTransferQuestion(null)}
        />
      )}

      {/* Fora do `section`: o teclado do diálogo não passa pelo Ctrl+W da faixa. */}
      {confirm === null || question === null ? null : (
        <ConfirmDialog
          open
          tone="danger"
          title={question.title}
          description={question.description}
          confirmLabel={question.confirm}
          onConfirm={() => {
            setConfirm(null);
            closeNow(confirm.scope, confirm.tabId);
          }}
          onCancel={() => {
            setConfirm(null);
            setWindowClosing(false);
            releaseWindowClose();
          }}
        />
      )}
    </>
  );
}
