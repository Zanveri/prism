import { fitsSavedSqlLimit, type SavedTab, type SavedWorkspace } from "../../../../electron/workspace-messages";

import { inDatabase } from "./navigator-model";
import { isScriptDirty, scriptPlace, type ScriptRef } from "./saved-scripts";
import { isTableTab, type QueryTab } from "./workbench-model";

/**
 * As abas que voltam na próxima entrada (seção 24 da especificação, RN-ABAS-006), sem tocar a página nem a API: o que de cada aba vai para o cofre e o que
 * volta dele. Vai: da aba de consulta, o texto do editor, a conexão, o banco, o script de onde veio e se tem mudança não salva; da aba de uma tabela, a
 * conexão, o banco, o esquema, a tabela e a vista; e a ordem e a ativa. Não vai: o título (a consulta ganha um número novo, o script volta com o nome que tem
 * hoje), a sessão, o resultado, o cursor e as alterações não salvas da grade.
 */

/** O texto do editor da aba agora, se ela tem editor montado (`liveEditors`): a cópia da aba chega com atraso. */
export type LiveSql = (tabId: string) => string | null;

/**
 * Uma aba como vai para o cofre. A vista da tabela é a enumeração da tela (`TableView`) e a do schema (`workspace-messages.ts`) ao mesmo tempo: a ida (aqui)
 * e a volta (`restoreWorkspace`) atribuem uma à outra, e uma que divergir não compila. A mudança não salva do script segue o texto deste instante e o lugar
 * da aba (`isScriptDirty`, a mesma conta do ponto da faixa: a conexão e o banco contam, RN-SCRIPT-003). O texto que passa de 1 MB (RN-SCRIPT-004) não vai: a aba
 * vai vazia, marcada, e volta com o aviso.
 */
export function savedTabOf(tab: QueryTab, liveSql: string | null): SavedTab {
  if (isTableTab(tab)) return { kind: "table", connectionID: tab.connectionId, database: tab.database ?? null, schema: tab.table.schema, table: tab.table.name, view: tab.table.view };

  const sql = liveSql ?? tab.sql;
  const fits = fitsSavedSqlLimit(sql);
  return {
    kind: "query",
    connectionID: tab.connectionId,
    database: tab.connectionId === null ? null : (tab.database ?? null),
    sql: fits ? sql : "",
    scriptID: tab.script?.id ?? null,
    dirty: tab.script === undefined ? false : isScriptDirty(tab.script, sql, tab),
    sqlTooLarge: !fits,
  };
}

/** As abas desta janela, na ordem da faixa, e a ativa. */
export function toSavedWorkspace(tabs: readonly QueryTab[], activeTabId: string | null, liveSql: LiveSql): SavedWorkspace {
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  return { tabs: tabs.map((tab) => savedTabOf(tab, liveSql(tab.id))), activeIndex: index < 0 ? null : index };
}

/**
 * A janela que fecha (RN-ABAS-004) fecha as abas dela, com as perguntas de sempre, mas fechar o app não tira aba do que volta (RN-ABAS-006: a gravação de
 * antes de fechar o app as leva). Do instante em que a janela começa a fechar, as abas que fecham ficam como estavam por último, na ordem de então, e a ativa
 * é a de então. Se a pessoa cancela uma pergunta, a janela fica aberta e o que fechou até ali sai do que volta (`withHeld` deixa de ser usado).
 */
export type HeldWorkspace = { order: readonly string[]; byId: ReadonlyMap<string, SavedTab>; activeId: string | null };

export function holdWorkspace(tabs: readonly QueryTab[], activeTabId: string | null, liveSql: LiveSql): HeldWorkspace {
  return { order: tabs.map((tab) => tab.id), byId: new Map(tabs.map((tab) => [tab.id, savedTabOf(tab, liveSql(tab.id))])), activeId: activeTabId };
}

/** O que a janela que fecha conta: as abas de quando ela começou a fechar, com o que mudou nas que ainda estão abertas, e as que chegaram depois no fim. */
export function withHeld(held: HeldWorkspace, tabs: readonly QueryTab[], liveSql: LiveSql): { held: HeldWorkspace; workspace: SavedWorkspace } {
  const byId = new Map(held.byId);
  for (const tab of tabs) byId.set(tab.id, savedTabOf(tab, liveSql(tab.id)));
  const known = new Set(held.order);
  const order = [...held.order, ...tabs.filter((tab) => !known.has(tab.id)).map((tab) => tab.id)];
  const index = held.activeId === null ? -1 : order.indexOf(held.activeId);

  const next: HeldWorkspace = { order, byId, activeId: held.activeId };
  return { held: next, workspace: { tabs: order.flatMap((id) => byId.get(id) ?? []), activeIndex: index < 0 ? null : index } };
}

/**
 * O que a janela conta, deste instante, para o relato (`workspace-reporter.ts`): a área de trabalho dá as abas a cada renderização (`update`), e o relato as lê
 * quando conta (`read`), com o texto vivo dos editores. Enquanto a janela fecha (`hold`), as abas que fecham ficam; se ela fica aberta (`release`), saem.
 */
export function createWorkspaceSource(liveSql: LiveSql) {
  let tabs: readonly QueryTab[] = [];
  let activeTabId: string | null = null;
  let held: HeldWorkspace | null = null;

  return {
    update(nextTabs: readonly QueryTab[], nextActive: string | null) {
      tabs = nextTabs;
      activeTabId = nextActive;
    },
    hold() {
      held = holdWorkspace(tabs, activeTabId, liveSql);
    },
    release() {
      held = null;
    },
    read(): SavedWorkspace {
      if (held === null) return toSavedWorkspace(tabs, activeTabId, liveSql);
      const next = withHeld(held, tabs, liveSql);
      held = next.held;
      return next.workspace;
    },
  };
}

/** O que a reabertura precisa saber: as conexões que existem, os scripts que existem (com o texto salvo, quando foi lido), e de onde vêm os ids e os números. */
export type RestoreContext = {
  connections: ReadonlySet<string>;
  /**
   * O nome de cada script, o SQL salvo dele (`null` se não foi lido: só a aba com mudança não salva precisa dele) e o lugar em que foi salvo: a conexão
   * (nula no script genérico, RN-SCRIPT-005) e o banco (RN-ARVORE-007).
   */
  scripts: ReadonlyMap<string, { name: string; sql: string | null; connectionID: string | null; database?: string | null }>;
  newId: () => string;
  /** O número da próxima "consulta-N.sql" da janela. */
  nextNumber: () => number;
};

export type RestoredWorkspace = {
  tabs: QueryTab[];
  activeTabId: string | null;
  /** Os títulos das abas cujo texto passava de 1 MB: voltaram vazias, e a tela avisa. */
  emptied: string[];
  /** As abas de consulta cuja conexão foi excluída: voltaram sem conexão, como um script sem conexão (RN-SCRIPT-003). */
  withoutConnection: number;
  /** As abas de tabela cuja conexão foi excluída: a aba de uma tabela sempre tem a conexão dela, e não volta. */
  droppedTables: number;
  /** As conexões das abas de tabela que voltaram: as vistas delas esperam o clique para conectar (nada conecta sozinho). */
  tableConnections: ReadonlySet<string>;
};

/**
 * As abas gravadas, de volta, na ordem em que estavam: desconectadas (sem sessão), com ids novos, a consulta com o número seguinte da janela, a aba de um
 * script com o nome que ele tem hoje, o lugar com que ele está gravado (a conexão e o banco, ou o genérico: RN-SCRIPT-003 e 005) e a marca de mudança não
 * salva que tinha, e a ativa. A aba volta na conexão em que estava, que pode não ser a do script (a troca é a mudança não salva). A que perdeu a conexão
 * volta sem ela (a de tabela não volta), e a ativa que não voltou passa à vizinha, como ao fechar uma aba.
 */
export function restoreWorkspace(saved: SavedWorkspace, context: RestoreContext): RestoredWorkspace {
  const emptied: string[] = [];
  const tableConnections = new Set<string>();
  let withoutConnection = 0;
  let droppedTables = 0;

  const byIndex = saved.tabs.map((tab): QueryTab | null => {
    if (tab.kind === "table") {
      if (!context.connections.has(tab.connectionID)) {
        droppedTables++;
        return null;
      }
      tableConnections.add(tab.connectionID);
      const database = tab.database ?? undefined;
      return { id: context.newId(), title: database === undefined ? `${tab.schema}.${tab.table}` : `${database}.${tab.schema}.${tab.table}`, connectionId: tab.connectionID, ...inDatabase(database), sessionId: null, sql: "", table: { schema: tab.schema, name: tab.table, view: tab.view } };
    }

    const connectionId = tab.connectionID !== null && context.connections.has(tab.connectionID) ? tab.connectionID : null;
    if (tab.connectionID !== null && connectionId === null) withoutConnection++;

    const script = tab.scriptID === null ? undefined : context.scripts.get(tab.scriptID);
    // O lugar salvo é o de abrir o script (`scriptPlace`): a conexão que não existe mais vale "sem conexão", como na aba que abre sem ela.
    const ref: ScriptRef | undefined =
      script === undefined || tab.scriptID === null ? undefined : { id: tab.scriptID, name: script.name, savedSql: script.sql ?? (tab.dirty ? "" : tab.sql), ...scriptPlace({ connectionID: script.connectionID, database: script.database ?? null }, context.connections).saved, dirty: tab.dirty };
    const title = ref?.name ?? `consulta-${context.nextNumber()}.sql`;
    if (tab.sqlTooLarge) emptied.push(title);

    return { id: context.newId(), title, connectionId, ...inDatabase(connectionId === null ? undefined : (tab.database ?? undefined)), sessionId: null, sql: tab.sql, ...(ref === undefined ? {} : { script: ref }) };
  });

  const tabs = byIndex.filter((tab) => tab !== null);
  const index = saved.activeIndex;
  const active = index === null ? null : (byIndex[index] ?? byIndex.slice(index + 1).find((tab) => tab !== null) ?? byIndex.slice(0, index).findLast((tab) => tab !== null) ?? null);

  return { tabs, activeTabId: active?.id ?? null, emptied, withoutConnection, droppedTables, tableConnections };
}
