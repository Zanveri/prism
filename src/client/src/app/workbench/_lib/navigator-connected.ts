import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import { withFolderPath } from "./navigator-environment";

/**
 * "Só as conectadas" (RN-NAV-013): desligado (`connected` nulo), as mesmas listas (a árvore não se refaz); ligado, só as conexões conectadas, na definição
 * única (`isConnected`: a sessão da árvore aberta, ou uma aba conectada, a conta da lista do botão da conexão da aba, RN-ARVORE-008), e as pastas no caminho
 * até elas. Roda sobre o que o seletor de ambiente deixou (RN-NAV-010), e o campo de busca filtra depois: os três se combinam. Pura.
 */
export function filterConnected<F extends Folder, C extends Connection>(folders: F[], connections: C[], connected: ReadonlySet<string> | null): { folders: F[]; connections: C[] } {
  if (connected === null) return { folders, connections };
  return withFolderPath(folders, connections.filter((connection) => connected.has(connection.id)));
}
