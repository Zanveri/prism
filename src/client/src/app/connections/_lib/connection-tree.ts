import type { SelectOption } from "@/components/ui/select";

import type { Connection, Folder } from "./connections.schema";

/** A árvore da lista: pastas com o que há dentro delas, e conexões. `depth` 0 é a raiz. */
export type TreeNode =
  | { kind: "folder"; id: string; name: string; depth: number; children: TreeNode[] }
  | { kind: "connection"; id: string; name: string; depth: number; connection: Connection };

// Sem diferenciar caixa nem acento ("álamo" fica junto de "Alfa") e com os números por valor.
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function byName(a: { name: string }, b: { name: string }) {
  return collator.compare(a.name, b.name);
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const group = key(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return groups;
}

/**
 * Monta a árvore de pastas e conexões. Dentro de cada pasta, as subpastas vêm primeiro e depois as
 * conexões, cada grupo em ordem alfabética. Uma pasta ou conexão cujo pai não existe mais vai para
 * a raiz: o que ficou sem lugar não pode sumir da lista. Pastas em ciclo (a API não deixa criá-las,
 * RN-PASTA-003) não têm como chegar à raiz e não aparecem.
 */
export function buildConnectionTree(folders: Folder[], connections: Connection[]): TreeNode[] {
  const folderIDs = new Set(folders.map((folder) => folder.id));
  const existing = (id: string | null) => (id !== null && folderIDs.has(id) ? id : null);

  const foldersByParent = groupBy(folders, (folder) => existing(folder.parentID));
  const connectionsByFolder = groupBy(connections, (connection) => existing(connection.folderID));

  function level(parentID: string | null, depth: number): TreeNode[] {
    return [
      ...(foldersByParent.get(parentID) ?? []).sort(byName).map((folder): TreeNode => ({ kind: "folder", id: folder.id, name: folder.name, depth, children: level(folder.id, depth + 1) })),
      ...(connectionsByFolder.get(parentID) ?? []).sort(byName).map((connection): TreeNode => ({ kind: "connection", id: connection.id, name: connection.name, depth, connection })),
    ];
  }

  return level(null, 0);
}

/** Todas as pastas, na ordem da árvore, com o caminho inteiro no rótulo ("Fábrica / Extrusão"), para escolher uma. */
export function folderOptions(nodes: TreeNode[], parents = ""): SelectOption[] {
  return nodes.flatMap((node) => (node.kind === "folder" ? [{ value: node.id, label: parents + node.name }, ...folderOptions(node.children, `${parents}${node.name} / `)] : []));
}
