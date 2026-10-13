import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { ConfirmDialog, useToast } from "@/components/ui";
import { currentWindowId, onTabWanted, onWindowCloseRequested, sendTabAway, tellWindows } from "@/lib/api/bridge";
import { vaultLock } from "@/lib/api/vault-lock";

import type { TabMoveTarget } from "../../../../electron/window-messages";

import { createDisconnectLog } from "../_lib/connection-intent";
import { liveEditors } from "../_lib/live-editors";
import { recallForTransfer } from "../_lib/tab-memory";
import { readTabDrag, tabDragType, tabMoveShortcut } from "../_lib/tab-order";
import { closeConfirmation, closeConfirmationText, isCloseShortcut, mergeCloseQueue, nextToClose, tabsToClose, type CloseScope } from "../_lib/tab-strip";
import { scriptsToAsk } from "../_lib/saved-scripts";
import { serializeTab } from "../_lib/tab-transfer";
import type { TableRef } from "../_lib/table-diagram";
import { unsavedEdits, unsavedQuestion } from "../_lib/unsaved-edits";
import { isBusyState } from "../_lib/use-query-runner";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import { useWorkbench } from "../_lib/workbench-state";
import { isTableTab, type TableView } from "../_lib/workbench-model";
import { workbenchCopy } from "../_lib/workbench.copy";
import { QueryTabPanel } from "./query-tab";
import { UnsavedScriptsDialog } from "./script-dialogs";
import { panelElementId, tabElementId, TabStrip } from "./tab-strip";
import { TableTabPanel } from "./table-tab/table-tab";
import { UnsavedEditsDialog } from "./table-tab/unsaved-edits-dialog";
import { useScriptSaving, type SaveMode } from "./use-script-saving";

const copy = workbenchCopy.tabs;

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
 * As abas mudam de lugar (RN-ABAS-001: arrastando, ou Ctrl+Shift+PageUp e PageDown na ativa) e passam para outra janela (RN-ABAS-002 e 003: pelo menu
 * da aba, arrastando-a para fora da janela ou até a faixa de outra). A aba com comando em andamento não muda de janela, e a dos Registros com
 * alterações não salvas pergunta antes se salva ou descarta. Fechar a janela fecha as abas dela, com as perguntas de "Fechar todas" (RN-ABAS-004).
 */
export function WorkbenchTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, setTableView, openTableTab, runnerOf, reorderTab, shiftTab, detachTab, releaseWindow, markScriptEdited, assignConnection } = useWorkbench();
  const toast = useToast();
  const windowId = currentWindowId();
  const connections = useQuery(connectionsQuery);
  const queryClient = useQueryClient();

  // RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S da aba de consulta, e o diálogo do nome. A função é estável: o painel memorizado de cada aba a recebe.
  const { save: saveScript, dialog: saveDialog } = useScriptSaving();
  const requestSave = useCallback((tabId: string, mode: SaveMode) => void saveScript(tabId, mode), [saveScript]);

  // Uma aba só está À VISTA se for a ativa e a área de trabalho for a tela mostrada (RN-SEG-001): a escondida não fala com o banco.
  const onScreen = useWorkbenchOnScreen();

  // Quem a pessoa desconectou: as vistas das tabelas dessas conexões esperam o clique, em vez de reabrir a sessão (`connection-intent.ts`).
  const [disconnectLog] = useState(() => createDisconnectLog(queryClient));
  const disconnected = useSyncExternalStore(disconnectLog.subscribe, disconnectLog.getSnapshot);
  // Uma aba com sessão é uma conexão conectada de novo: o "Atualizar" dos registros abre a sessão da aba, sem passar pela da árvore.
  useEffect(() => {
    for (const tab of tabs) if (tab.sessionId !== null && tab.connectionId !== null) disconnectLog.forget(tab.connectionId);
  }, [tabs, disconnectLog]);

  // `openTableTab` muda de identidade a cada mudança da lista de abas (ele a consulta), e o painel memorizado de cada tabela perderia o
  // `memo`. Ele recebe sempre esta mesma função, que chama a versão mais recente.
  const latestOpenTable = useRef(openTableTab);
  useEffect(() => {
    latestOpenTable.current = openTableTab;
  });
  const handleOpenTable = useCallback((connectionId: string, table: TableRef & { view?: TableView; database?: string }) => latestOpenTable.current(connectionId, table), []);

  /**
   * Fechar várias de uma vez. `closeTab` parte da lista de abas que viu quando foi criado, então chamado várias vezes no mesmo instante
   * só a última remoção vale. A primeira fecha agora, e as demais esperam a lista mudar: cada mudança de `tabs` fecha a próxima da fila,
   * com o `closeTab` novo (cada uma pelo caminho de sempre: cancela o que roda e fecha a sessão dela, RN-SESSAO-004). Um segundo fechamento
   * no meio do primeiro se junta à fila (`mergeCloseQueue`), e o id que já saiu é pulado (`nextToClose`): a fila nunca fica parada.
   */
  const pendingClose = useRef<string[]>([]);
  useEffect(() => {
    const { next, rest } = nextToClose(pendingClose.current, new Set(tabs.map((tab) => tab.id)));
    pendingClose.current = rest;
    if (next !== null) closeTab(next);
  }, [tabs, closeTab]);

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

  // Fechar várias abas pergunta UMA vez quando alguma das que fecham é consulta com SQL digitado (o texto não é guardado); fechar uma só, não.
  const [confirm, setConfirm] = useState<{ scope: CloseScope; tabId: string; total: number; withSql: number } | null>(null);
  const askAboutSql = useCallback(
    (scope: CloseScope, tabId: string) => {
      const question = closeConfirmation(scope, tabs, tabId);
      if (question === null) closeNow(scope, tabId);
      else setConfirm({ scope, tabId, ...question });
    },
    [tabs, closeNow],
  );

  // RN-SCRIPT-001: depois dos Registros e antes da pergunta do SQL, a dos scripts com mudança não salva entre as abas que fecham.
  const [scriptQuestion, setScriptQuestion] = useState<{ scope: CloseScope; tabId: string; dirty: { id: string; name: string }[]; saving: boolean } | null>(null);
  const askAboutScripts = useCallback(
    (scope: CloseScope, tabId: string) => {
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
      return;
    }
    setScriptQuestion(null);
    latestAskAboutSql.current(question.scope, question.tabId);
  }

  // RN-EDIT-007: antes, as alterações não salvas dos Registros das abas que fecham: uma aba oferece Salvar; várias, só Descartar e Cancelar. Levar a aba
  // para outra janela pergunta o mesmo (as alterações não salvas não mudam de janela): Salvar e levar, ou Descartar e levar.
  type Intent = { kind: "close"; scope: CloseScope } | { kind: "move"; target: TabMoveTarget };
  const [unsaved, setUnsaved] = useState<{ intent: Intent; tabId: string; count: number; canSave: boolean; saving: boolean } | null>(null);
  const handleClose = useCallback(
    (scope: CloseScope, tabId: string) => {
      const question = unsavedQuestion(tabsToClose(scope, tabs, tabId), unsavedEdits.countOf, unsavedEdits.saveOf);
      if (question === null) askAboutScripts(scope, tabId);
      else setUnsaved({ intent: { kind: "close", scope }, tabId, ...question, saving: false });
    },
    [tabs, askAboutScripts, setUnsaved],
  );

  /**
   * Manda a aba para outra janela (RN-ABAS-002 e 003): o texto e a seleção do editor DESTE instante, o resultado, a sessão e o que a tela lembrava.
   * Só quando o processo principal a levou ela sai daqui, sem fechar a sessão (que agora é da outra janela). Com comando em andamento não vai: a
   * resposta chegaria aqui, à aba que já saiu.
   *
   * `saved`: a aba dos Registros acabou de salvar as alterações para poder ir (RN-EDIT-007). As linhas na tela são as de antes de salvar, e o Salvar
   * lê os registros de novo (RN-EDIT-005): a aba vai sem elas, e a janela que a recebe lê os registros na mesma sessão, já com o que foi gravado.
   */
  async function sendTab(tabId: string, target: TabMoveTarget, saved = false) {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (tab === undefined) return;

    const runner = runnerOf(tabId);
    const current = runner.getState();
    const state = saved && !isBusyState(current) ? { status: "idle" as const } : current;
    const transfer = isBusyState(state) ? null : serializeTab({ tab, sessionId: runner.sessionOf(), editor: liveEditors.snapshot(tabId), state, memory: recallForTransfer(tabId) });
    if (transfer === null) {
      toast.warning(copy.moveBusy);
      return;
    }

    const reply = await sendTabAway({ target, transfer });
    if (reply.ok) detachTab(tabId);
    // Solta em cima de outra janela, fora da faixa dela: a aba fica onde estava, sem aviso (na faixa, quem a leva é a outra janela).
    else if (reply.reason !== "overWindow") toast.error(copy.moveFailed);
  }

  function handleMove(tabId: string, target: TabMoveTarget) {
    const count = unsavedEdits.countOf(tabId);
    if (count === 0) void sendTab(tabId, target);
    else setUnsaved({ intent: { kind: "move", target }, tabId, count, canSave: unsavedEdits.saveOf(tabId) !== null, saving: false });
  }

  // Depois da pergunta: fecha (com a pergunta do SQL, se for o caso) ou leva a aba. Levar depois de "Descartar" é levá-la sem as alterações: elas
  // ficam na memória desta janela, que a aba deixa, e não vão.
  function proceed(intent: Intent, tabId: string, saved = false) {
    if (intent.kind === "close") askAboutScripts(intent.scope, tabId);
    else void sendTab(tabId, intent.target, saved);
  }

  async function saveAndProceed(intent: Intent, tabId: string) {
    const save = unsavedEdits.saveOf(tabId);
    if (save === null) return;
    setUnsaved((current) => (current === null ? null : { ...current, saving: true }));
    const saved = await save();
    setUnsaved(null);
    if (saved) proceed(intent, tabId, true);
    else if (intent.kind === "close") setWindowClosing(false);
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
  const [windowClosing, setWindowClosing] = useState(false);
  const finishWindow = useCallback(() => {
    setWindowClosing(false);
    void releaseWindow().finally(() => tellWindows((windows) => windows.close()));
  }, [releaseWindow]);
  const latestTabs = useRef(tabs);
  const latestHandleClose = useRef(handleClose);
  useEffect(() => {
    latestTabs.current = tabs;
    latestHandleClose.current = handleClose;
  });
  useEffect(
    () =>
      onWindowCloseRequested(() => {
        const open = latestTabs.current;
        if (vaultLock.isLocked() || open.length === 0) return finishWindow();

        setWindowClosing(true);
        latestHandleClose.current("all", open[0].id);
      }),
    [finishWindow],
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

    if (!isCloseShortcut(event)) return;
    event.preventDefault();
    handleClose("one", activeTabId);
  }

  // RN-ABAS-003: a janela sem abas também recebe a aba arrastada de outra janela, no lugar da faixa.
  function receive(fromWindowId: number, tabId: string, index: number) {
    tellWindows((windows) => windows.requestTab({ fromWindowId, tabId, index }));
  }

  const connectionOf = (connectionId: string | null) => (connectionId === null ? undefined : connections.data?.find((connection) => connection.id === connectionId));

  const question = confirm === null ? null : closeConfirmationText(confirm.total, confirm.withSql);

  return (
    <>
      <section onKeyDown={handleKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabs.length === 0 ? null : (
          <TabStrip tabs={tabs} activeTabId={activeTabId} connectionOf={connectionOf} onSelect={setActiveTab} onClose={handleClose} windowId={windowId} onReorder={reorderTab} onMove={handleMove} onReceive={receive} />
        )}

        {tabs.length === 0 ? (
          <div
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(tabDragType)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(tabDragType)) return;
              event.preventDefault();
              const drag = readTabDrag(event.dataTransfer.getData(tabDragType));
              if (drag !== null && drag.windowId !== null && drag.windowId !== windowId) receive(drag.windowId, drag.tabId, 0);
            }}
            className="flex flex-1 flex-col justify-center gap-1.5 px-10"
          >
            <h2 className="text-lg font-semibold">{copy.emptyTitle}</h2>
            <p className="max-w-[420px] text-muted">{copy.emptyHint}</p>
          </div>
        ) : (
          tabs.map((tab) => {
            const selected = tab.id === activeTabId;

            return (
              <div key={tab.id} role="tabpanel" id={panelElementId(tab.id)} aria-labelledby={tabElementId(tab.id)} hidden={!selected} className={selected ? "flex min-h-0 flex-1 flex-col" : undefined}>
                {isTableTab(tab) ? (
                  <TableTabPanel tab={tab} table={tab.table} runner={runnerOf(tab.id)} connection={connectionOf(tab.connectionId)} visible={selected && onScreen} disconnected={disconnected.has(tab.connectionId)} onView={setTableView} onOpenTable={handleOpenTable} />
                ) : (
                  <QueryTabPanel tab={tab} runner={runnerOf(tab.id)} engine={connectionOf(tab.connectionId)?.engine} active={selected} onSqlChange={updateTab} onEdited={markScriptEdited} onSave={requestSave} onAssignConnection={assignConnection} onOpenTable={handleOpenTable} />
                )}
              </div>
            );
          })
        )}
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
          }}
        />
      )}

      {saveDialog}

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
          }}
        />
      )}
    </>
  );
}
