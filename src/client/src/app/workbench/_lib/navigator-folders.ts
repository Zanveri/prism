import { navKey, parseNavKey } from "./navigator-model";
import type { EnvironmentChoice } from "./navigator-environment";

/**
 * O que a árvore de conexões decide sobre as pastas abertas (RN-NAV-014), em funções puras: quais nós estão abertos, e o que valem o seletor de ambiente e "Só as
 * conectadas" (RN-NAV-010 e 013) para as pastas. Quem lembra as pastas é `folder-memory.ts`; o navegador (`navigator.tsx`) só executa.
 */

/** A chave da linha de uma pasta de conexões na árvore (`NavPath` `folder`). */
export const folderKeyOf = (id: string): string => navKey({ type: "folder", id });

/** O identificador da pasta de uma chave de linha de pasta; `null` se a chave é de outra coisa. */
export function folderIdOfKey(key: string): string | null {
  try {
    const path = parseNavKey(key);
    return path.type === "folder" ? path.id : null;
  } catch {
    return null;
  }
}

/** Os identificadores das pastas de uma lista de chaves de linha de pasta (o que as revelações trazem: `revealOf`, `importRevealOf`), sem as chaves de outras coisas. */
export const folderIdsOfKeys = (keys: readonly string[]): string[] => keys.flatMap((key) => folderIdOfKey(key) ?? []);

/** As pastas recolhidas na vista filtrada (a árvore com o seletor de ambiente ou "Só as conectadas" ligados), e a vista a que elas valem. */
export type FilterFolders = { readonly filter: string; readonly keys: ReadonlySet<string> };

export const noFilterFolders: FilterFolders = Object.freeze({ filter: "", keys: new Set<string>() });

/**
 * Qual é a vista filtrada de agora: o ambiente escolhido e "Só as conectadas", ou `null` sem nenhum dos dois ligados. Trocar o ambiente muda a vista (o que
 * se recolheu na outra não vale nesta); desligar tudo a encerra.
 */
export function filterViewOf(environment: EnvironmentChoice, onlyConnected: boolean): string | null {
  if (environment.type === "all" && !onlyConnected) return null;
  return `${environment.type === "environment" ? `environment:${environment.key}` : environment.type}|${onlyConnected ? "connected" : "all"}`;
}

/**
 * O que se recolheu na vista filtrada, depois de a vista de agora ser conhecida: vale só enquanto a MESMA vista segue ligada. Trocar o ambiente ou ligar ou
 * desligar "Só as conectadas" começa outra vista, e desligar tudo a encerra: as recolhidas saem na hora, e voltar à primeira não as traz de volta (senão o que
 * a pessoa veria dependeria de ter mexido ou não numa pasta da vista do meio). Devolve o MESMO estado enquanto ele vale, ou quando nada está recolhido.
 */
export function filterFoldersFor(state: FilterFolders, view: string | null): FilterFolders {
  return state.keys.size === 0 || state.filter === view ? state : noFilterFolders;
}

/** As pastas recolhidas na vista filtrada de agora; `null` sem filtro, onde valem as pastas lembradas. O que se recolheu em outra vista não vale nesta. */
export function collapsedInFilter(state: FilterFolders, view: string | null): ReadonlySet<string> | null {
  if (view === null) return null;
  return state.filter === view ? state.keys : noFilterFolders.keys;
}

/** A pasta abre ou fecha só na vista filtrada: `wasOpen` é como ela estava (aberta, se a vista não a recolheu). Fora do filtro, a vista não guarda nada. */
export function toggledInFilter(state: FilterFolders, view: string | null, key: string, wasOpen: boolean): FilterFolders {
  if (view === null) return noFilterFolders;

  const keys = new Set(collapsedInFilter(state, view));
  if (wasOpen) keys.add(key);
  else keys.delete(key);
  return { filter: view, keys };
}

/** "Recolher tudo" na vista filtrada: todas as pastas da árvore à vista ficam recolhidas, só nela. */
export function collapsedAllInFilter(view: string | null, folderKeys: readonly string[]): FilterFolders {
  return view === null ? noFilterFolders : { filter: view, keys: new Set(folderKeys) };
}

/** As pastas abrem na vista filtrada (criar dentro, revelar, mover): saem das recolhidas. Devolve o MESMO estado quando nenhuma estava recolhida. */
export function openedInFilter(state: FilterFolders, view: string | null, keys: readonly string[]): FilterFolders {
  const collapsed = collapsedInFilter(state, view);
  if (view === null || collapsed === null || !keys.some((key) => collapsed.has(key))) return state;
  return { filter: view, keys: new Set([...collapsed].filter((key) => !keys.includes(key))) };
}

/**
 * Os nós abertos da árvore (RN-ARVORE-002, RN-NAV-014): os de `expanded` (conexões, bancos, esquemas, grupos e tabelas, que não passam de uma entrada para a outra),
 * menos a conexão a que faltam o usuário ou a senha (RN-TRANSF-016), e as pastas. Sem filtro, as pastas abertas são as lembradas (`openFolderIds`): a que não
 * foi aberta está fechada, e o identificador de pasta que não está na árvore à vista (excluída, ou escondida pelo filtro) não tem efeito. Com o seletor de
 * ambiente ou "Só as conectadas" ligado (`filterCollapsed` não nulo), a árvore tem só as pastas no caminho até as conexões à vista, e elas abrem, menos as que
 * a pessoa recolheu nessa vista: nada do que se lembra entra nem sai.
 */
export function openTreeKeys({ expanded, lackingKeys, folderKeys, openFolderIds, filterCollapsed }: {
  expanded: ReadonlySet<string>;
  lackingKeys: ReadonlySet<string>;
  folderKeys: readonly string[];
  openFolderIds: ReadonlySet<string>;
  filterCollapsed: ReadonlySet<string> | null;
}): Set<string> {
  let folders: string[];
  if (filterCollapsed === null) {
    const remembered = new Set([...openFolderIds].map(folderKeyOf));
    folders = folderKeys.filter((key) => remembered.has(key));
  } else {
    folders = folderKeys.filter((key) => !filterCollapsed.has(key));
  }

  return new Set([...[...expanded].filter((key) => !lackingKeys.has(key)), ...folders]);
}
