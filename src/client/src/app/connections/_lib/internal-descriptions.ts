import type { Connection, Folder } from "./connections.schema";

/**
 * Encontra a pasta mais próxima na hierarquia acima de `folderID` (incluindo ela própria)
 * que tem "Utilizar descrições internas" (`useInternalDescriptions`) marcado.
 */
export function inheritedInternalDescriptionsFolder(folders: readonly Folder[], folderID: string | null): Folder | null {
  const seen = new Set<string>();
  let currentId = folderID;

  while (currentId !== null && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = folders.find((candidate) => candidate.id === currentId);
    if (!folder) return null;
    if (folder.useInternalDescriptions) return folder;
    currentId = folder.parentID;
  }

  return null;
}

/**
 * Resolve se uma conexão utiliza descrições internas:
 * - Se a conexão tem escolha própria (`true` ou `false`), vale a escolha da conexão (permite desmarcar individualmente mesmo quando a pasta está marcada);
 * - Se `null` ou `undefined`, herda das pastas ancestrais (`true` se alguma pasta acima tiver a opção marcada).
 */
export function usesInternalDescriptions(
  connection: Pick<Connection, "folderID" | "useInternalDescriptions"> | null | undefined,
  folders: readonly Folder[],
): boolean {
  if (!connection) return false;
  if (connection.useInternalDescriptions === true) return true;
  if (connection.useInternalDescriptions === false) return false;
  return inheritedInternalDescriptionsFolder(folders, connection.folderID) !== null;
}
