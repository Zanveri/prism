import { buildConnectionTree, type TreeNode } from "@/app/connections/_lib/connection-tree";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import { navKey } from "./navigator-model";

/**
 * O que a árvore abre para mostrar a conexão que o formulário acabou de salvar (RN-NAV-004: salvar volta à área de trabalho com a conexão à
 * vista, os ancestrais abertos, e escolhida): a chave da linha dela e as das pastas acima, da mais próxima à raiz. Uma pasta que não existe
 * mais acaba a subida (a árvore põe na raiz o que ficou sem pai), e pastas em ciclo, que a API não deixa criar (RN-PASTA-003), não a prendem.
 */
export function revealOf(connection: { id: string; folderID: string | null }, folders: readonly { id: string; parentID: string | null }[]): { key: string; folderKeys: string[] } {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  const folderKeys: string[] = [];

  for (let folder = connection.folderID === null ? undefined : byId.get(connection.folderID); folder !== undefined && !seen.has(folder.id); folder = folder.parentID === null ? undefined : byId.get(folder.parentID)) {
    seen.add(folder.id);
    folderKeys.push(navKey({ type: "folder", id: folder.id }));
  }

  return { key: navKey({ type: "connection", connectionId: connection.id }), folderKeys };
}

/** O que a importação criou (RN-TRANSF-014): os IDs das pastas e das conexões novas, e o lugar escolhido (`null` é a raiz). */
export type ImportedItems = { folderIDs: readonly string[]; connectionIDs: readonly string[]; targetFolderID: string | null };

/**
 * O que a árvore faz depois da importação (RN-TRANSF-014): abre as pastas até o que entrou (`folderKeys`, as de cima de cada item criado) e escolhe a
 * primeira linha importada na ordem da árvore inteira, sem os filtros (`first`); `target` é a pasta de destino, para onde o foco vai quando um filtro esconde
 * essa linha. Quem decide o que está à vista é o navegador, que tem os filtros.
 */
export function importRevealOf(imported: ImportedItems, folders: readonly Folder[], connections: readonly Connection[]): { folderKeys: string[]; first: string | null; target: string | null } {
  const created = new Set([...imported.folderIDs, ...imported.connectionIDs]);
  const folderKeys = new Set<string>();
  for (const folder of folders) if (imported.folderIDs.includes(folder.id)) for (const key of revealOf({ id: folder.id, folderID: folder.parentID }, folders).folderKeys) folderKeys.add(key);
  for (const connection of connections) if (imported.connectionIDs.includes(connection.id)) for (const key of revealOf(connection, folders).folderKeys) folderKeys.add(key);

  // A primeira linha importada, na ordem do navegador: dentro de cada pasta, as subpastas e depois as conexões, pelo nome (`buildConnectionTree`).
  const first = (function find(nodes: readonly TreeNode[]): TreeNode | null {
    for (const node of nodes) {
      if (created.has(node.id)) return node;
      const inside = node.kind === "folder" ? find(node.children) : null;
      if (inside !== null) return inside;
    }
    return null;
  })(buildConnectionTree([...folders], [...connections]));

  return {
    folderKeys: [...folderKeys],
    first: first === null ? null : first.kind === "folder" ? navKey({ type: "folder", id: first.id }) : navKey({ type: "connection", connectionId: first.id }),
    target: imported.targetFolderID === null ? null : navKey({ type: "folder", id: imported.targetFolderID }),
  };
}

/** A importação já está nas listas: todas as pastas e conexões criadas chegaram (o navegador lê as listas de novo antes de mostrar). */
export function importArrived(imported: ImportedItems, folders: readonly Folder[], connections: readonly Connection[]): boolean {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const connectionIds = new Set(connections.map((connection) => connection.id));
  return imported.folderIDs.every((id) => folderIds.has(id)) && imported.connectionIDs.every((id) => connectionIds.has(id));
}
