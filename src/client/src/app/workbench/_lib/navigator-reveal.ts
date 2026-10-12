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
