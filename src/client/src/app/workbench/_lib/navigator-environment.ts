import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";
import type { EnvironmentLookup } from "@/app/connections/_lib/environment";
import { environmentKey, type UserEnvironment } from "@/app/connections/_lib/user-environments";

/** O que o seletor de ambiente do navegador escolheu (RN-NAV-010): todos (o padrão), as conexões sem ambiente, ou um ambiente do usuário, pela chave. */
export type EnvironmentChoice = { type: "all" } | { type: "none" } | { type: "environment"; key: string };

export const allEnvironments: EnvironmentChoice = Object.freeze({ type: "all" });
export const noEnvironment: EnvironmentChoice = Object.freeze({ type: "none" });

/** A escolha ainda vale: "Todos" e "Sem ambiente" sempre; um ambiente, só enquanto alguma pasta ou conexão o usa (RN-AMB-001). */
export function choiceAvailable(choice: EnvironmentChoice, environments: readonly UserEnvironment[]): boolean {
  return choice.type !== "environment" || environments.some((environment) => environment.key === choice.key);
}

/**
 * As pastas e as conexões que a árvore mostra com o seletor de ambiente (RN-NAV-010). "Todos" devolve as mesmas listas (a árvore não se refaz). Com um
 * ambiente, só as conexões cujo ambiente é esse, o próprio ou o herdado da pasta (o `environmentLookup`, RN-PASTA-005), sem diferenciar maiúsculas; com
 * "Sem ambiente", as que não têm nenhum dos dois. As pastas são as do caminho até elas, na ordem da lista: a pasta do ambiente sem conexão dele dentro
 * não aparece. A pasta em ciclo (que a API recusa, RN-PASTA-003) não prende o caminho num laço. Pura: o campo de busca filtra depois, sobre a árvore
 * que sai daqui, e os dois se combinam.
 */
export function filterByEnvironment<F extends Folder, C extends Connection>(folders: F[], connections: C[], choice: EnvironmentChoice, lookup: EnvironmentLookup): { folders: F[]; connections: C[] } {
  if (choice.type === "all") return { folders, connections };

  const matches = (connection: C) => {
    const shown = lookup.connection(connection);
    return choice.type === "none" ? shown === null : shown !== null && environmentKey(shown.name) === choice.key;
  };
  return withFolderPath(folders, connections.filter(matches));
}

/**
 * As conexões `kept` e as pastas no caminho até elas, na ordem da lista, que é o que os filtros do navegador mostram (o de ambiente, RN-NAV-010, e o das
 * conectadas, RN-NAV-013): a pasta sem nenhuma delas dentro não aparece, e a pasta em ciclo (que a API recusa, RN-PASTA-003) não prende o caminho num laço.
 */
export function withFolderPath<F extends Folder, C extends Connection>(folders: F[], kept: C[]): { folders: F[]; connections: C[] } {
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentID]));
  const onPath = new Set<string>();
  for (const connection of kept) {
    for (let id = connection.folderID; id !== null && !onPath.has(id) && parentOf.has(id); id = parentOf.get(id) ?? null) onPath.add(id);
  }

  return { folders: folders.filter((folder) => onPath.has(folder.id)), connections: kept };
}
