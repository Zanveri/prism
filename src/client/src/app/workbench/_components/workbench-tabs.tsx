import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { ConfirmDialog } from "@/components/ui";

import { createDisconnectLog } from "../_lib/connection-intent";
import { closeConfirmation, closeConfirmationText, isCloseShortcut, mergeCloseQueue, nextToClose, tabsToClose, type CloseScope } from "../_lib/tab-strip";
import type { TableRef } from "../_lib/table-diagram";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import { useWorkbench } from "../_lib/workbench-state";
import type { TableView } from "../_lib/workbench-model";
import { workbenchCopy } from "../_lib/workbench.copy";
import { QueryTabPanel } from "./query-tab";
import { panelElementId, tabElementId, TabStrip } from "./tab-strip";
import { TableTabPanel } from "./table-tab/table-tab";

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
 */
export function WorkbenchTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, setTableView, openTableTab, runnerOf } = useWorkbench();
  const connections = useQuery(connectionsQuery);
  const queryClient = useQueryClient();

  // Uma aba só está À VISTA se for a ativa e a área de trabalho for a tela mostrada (RN-SEG-001): a escondida não fala com o banco.
  const onScreen = useWorkbenchOnScreen();

  // Quem a pessoa desconectou: as vistas das tabelas dessas conexões esperam o clique, em vez de reabrir a sessão (`connection-intent.ts`).
  const [disconnectLog] = useState(() => createDisconnectLog(queryClient));
  const disconnected = useSyncExternalStore(disconnectLog.subscribe, disconnectLog.getSnapshot);
  // Uma aba com sessão é uma conexão conectada de novo: o "Atualizar" dos registros abre a sessão da aba, sem passar pela da árvore.
  useEffect(() => {
    for (const tab of tabs) if (tab.sessionId !== null) disconnectLog.forget(tab.connectionId);
  }, [tabs, disconnectLog]);

  // `openTableTab` muda de identidade a cada mudança da lista de abas (ele a consulta), e o painel memorizado de cada tabela perderia o
  // `memo`. Ele recebe sempre esta mesma função, que chama a versão mais recente.
  const latestOpenTable = useRef(openTableTab);
  useEffect(() => {
    latestOpenTable.current = openTableTab;
  });
  const handleOpenTable = useCallback((connectionId: string, table: TableRef & { view?: TableView }) => latestOpenTable.current(connectionId, table), []);

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
  const handleClose = useCallback(
    (scope: CloseScope, tabId: string) => {
      const question = closeConfirmation(scope, tabs, tabId);
      if (question === null) closeNow(scope, tabId);
      else setConfirm({ scope, tabId, ...question });
    },
    [tabs, closeNow],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || activeTabId === null || !isCloseShortcut(event)) return;

    event.preventDefault();
    handleClose("one", activeTabId);
  }

  const connectionOf = (connectionId: string) => connections.data?.find((connection) => connection.id === connectionId);

  const question = confirm === null ? null : closeConfirmationText(confirm.total, confirm.withSql);

  return (
    <>
      <section onKeyDown={handleKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabs.length === 0 ? null : <TabStrip tabs={tabs} activeTabId={activeTabId} connectionOf={connectionOf} onSelect={setActiveTab} onClose={handleClose} />}

        {tabs.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-1.5 px-10">
            <h2 className="text-lg font-semibold">{copy.emptyTitle}</h2>
            <p className="max-w-[420px] text-muted">{copy.emptyHint}</p>
          </div>
        ) : (
          tabs.map((tab) => {
            const selected = tab.id === activeTabId;

            return (
              <div key={tab.id} role="tabpanel" id={panelElementId(tab.id)} aria-labelledby={tabElementId(tab.id)} hidden={!selected} className={selected ? "flex min-h-0 flex-1 flex-col" : undefined}>
                {tab.table ? (
                  <TableTabPanel tab={tab} table={tab.table} runner={runnerOf(tab.id)} connection={connectionOf(tab.connectionId)} visible={selected && onScreen} disconnected={disconnected.has(tab.connectionId)} onView={setTableView} onOpenTable={handleOpenTable} />
                ) : (
                  <QueryTabPanel tab={tab} runner={runnerOf(tab.id)} engine={connectionOf(tab.connectionId)?.engine} active={selected} onSqlChange={updateTab} />
                )}
              </div>
            );
          })
        )}
      </section>

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
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
