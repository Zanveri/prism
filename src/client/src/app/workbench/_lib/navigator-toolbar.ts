import type { MenuState } from "./navigator-menu";
import { parseNavKey, type NavKind, type NavNode } from "./navigator-model";
import { navigatorCopy } from "./navigator.copy";

const copy = navigatorCopy.toolbar;

export type ToolbarActionId = "newConnection" | "newFolder" | "connect" | "disconnect" | "refresh" | "collapseAll" | "hide";

/** Um botão da barra: o nome (o que o leitor de tela diz), a dica (o nome e, quando há, o atalho) e se a ação se aplica agora. */
export type ToolbarButton = { id: ToolbarActionId; label: string; title: string; disabled: boolean };

/** O que a barra precisa saber do item escolhido na árvore. Só descreve: quem executa é a tela (`navigator.tsx`). */
export type ToolbarSelection = {
  node: NavNode | null;
  /** A conexão a que o item pertence (`selectionConnectionId`), com o estado dela; `null` para a pasta e para nada escolhido. */
  connection: { id: string; name: string; status: MenuState["status"]; busy: boolean } | null;
  /** A pasta onde "Nova pasta" e "Nova conexão" criam (`targetFolderId`); `null` é a raiz. */
  folder: { id: string; name: string } | null;
};

/** As linhas que não são um nó que abre: a chave delas é a do pai mais um sufixo (`#coluna:3`, `#loading`, `#error`). */
const suffixedKinds: ReadonlySet<NavKind> = new Set(["view", "routine", "sequence", "column", "index", "foreignKey", "loading", "error"]);

/**
 * A conexão a que o item escolhido pertence, qualquer que seja a linha: Conectar e Desconectar agem sobre ela (RN-NAV-002). A conexão e os
 * nós que abrem a trazem na própria chave; as folhas e as linhas de aviso, na do pai (o que vem antes do último `#`, que um nome de esquema
 * pode ter, mas o sufixo não). A pasta não é de conexão nenhuma.
 */
export function selectionConnectionId(node: NavNode | null): string | null {
  if (node === null || node.kind === "folder") return null;

  const path = parseNavKey(suffixedKinds.has(node.kind) ? node.key.slice(0, node.key.lastIndexOf("#")) : node.key);
  return path.type === "folder" ? null : path.connectionId;
}

/**
 * Onde "Nova pasta" e "Nova conexão" criam (RN-NAV-002): na pasta escolhida, na pasta do item escolhido (a da conexão dele) ou, sem
 * uma coisa nem outra, na raiz (`null`).
 */
export function targetFolderId(node: NavNode | null, connections: readonly { id: string; folderID: string | null }[]): string | null {
  if (node === null) return null;

  if (node.kind === "folder") {
    const path = parseNavKey(node.key);
    return path.type === "folder" ? path.id : null;
  }

  const connectionId = selectionConnectionId(node);
  return connections.find((connection) => connection.id === connectionId)?.folderID ?? null;
}

/** Os nós que guardam uma lista buscada, ou derivada de uma: é onde "Atualizar" tem o que buscar de novo. */
const refreshableKinds: ReadonlySet<NavKind> = new Set(["database", "schema", "group", "table"]);

/** "Atualizar" se aplica a esta linha? A conexão só tem o que atualizar depois de conectada. A linha e a barra perguntam aqui. */
export function isRefreshable(node: NavNode, connected: boolean): boolean {
  return refreshableKinds.has(node.kind) || (node.kind === "connection" && connected);
}

/**
 * A barra de ações do navegador (RN-NAV-002), como a do DBeaver: sempre os mesmos botões, na mesma ordem. Conectar, Desconectar e
 * Atualizar agem sobre o item escolhido na árvore, e o que não se aplica agora vem desabilitado, não some. O nome diz sobre o que o botão
 * vai agir ("Conectar MES Produção", "Nova pasta em Fábrica"); a dica é o nome e, no de esconder, o atalho.
 */
export function toolbarFor({ node, connection, folder }: ToolbarSelection, { canCollapse }: { canCollapse: boolean }, hideShortcut?: string): ToolbarButton[] {
  const connected = connection?.status === "connected";
  const canConnect = connection !== null && (connection.status === "disconnected" || connection.status === "failed");
  const canDisconnect = connection !== null && connected && !connection.busy;
  const canRefresh = node !== null && isRefreshable(node, connected);

  const button = (id: ToolbarActionId, label: string, disabled = false, shortcut?: string): ToolbarButton => ({ id, label, title: shortcut === undefined ? label : `${label} (${shortcut})`, disabled });

  return [
    button("newConnection", folder === null ? copy.newConnection : copy.newConnectionIn(folder.name)),
    button("newFolder", folder === null ? copy.newFolder : copy.newFolderIn(folder.name)),
    button("connect", canConnect ? copy.connectTo(connection.name) : copy.connect, !canConnect),
    button("disconnect", canDisconnect ? copy.disconnectFrom(connection.name) : copy.disconnect, !canDisconnect),
    button("refresh", canRefresh ? copy.refreshItem(node.label) : copy.refresh, !canRefresh),
    button("collapseAll", copy.collapseAll, !canCollapse),
    button("hide", copy.hide, false, hideShortcut),
  ];
}

/**
 * RN-GRADE-012: F5 no navegador é o "Atualizar" do nó escolhido, o mesmo da barra e do menu: só quando ele se aplica (o botão da barra está habilitado).
 * A tecla nunca recarrega a janela, aplicando-se ou não (o processo principal não a deixa chegar ao menu).
 */
export function refreshesSelection(buttons: readonly ToolbarButton[]): boolean {
  return buttons.some((button) => button.id === "refresh" && !button.disabled);
}
