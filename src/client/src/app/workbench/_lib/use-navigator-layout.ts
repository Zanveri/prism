import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { folderMemoryStore, noOpenFolders, type FolderChange, type FolderTree } from "./folder-memory";
import { navigatorLayoutStore } from "./navigator-layout";

/**
 * O navegador está escondido (RN-NAV-008), e quem o muda: a escolha é do usuário do cofre aberto, lembrada na chave dele
 * (`navigatorLayoutStore`). O guard já buscou a sessão (mesma chave): aqui só se lê o que ele guardou, como em `usePreferences`.
 */
export function useNavigatorHidden(): [boolean, (hidden: boolean) => void] {
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? null;

  const read = () => (userName === null ? false : navigatorLayoutStore.get(userName).hidden);
  const hidden = useSyncExternalStore(navigatorLayoutStore.subscribe, read, read);

  const setHidden = useCallback(
    (next: boolean) => {
      if (userName !== null) navigatorLayoutStore.set(userName, { hidden: next });
    },
    [userName],
  );

  return [hidden, setHidden];
}

/**
 * A seção Scripts do navegador está recolhida (RN-NAV-012), e quem a muda: como o navegador escondido, a escolha é do usuário do cofre aberto e volta na
 * próxima entrada. Sem usuário (a sessão ainda não chegou), aberta.
 */
export function useScriptsCollapsed(): [boolean, (collapsed: boolean) => void] {
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? null;

  const read = () => (userName === null ? false : navigatorLayoutStore.get(userName).scriptsCollapsed);
  const collapsed = useSyncExternalStore(navigatorLayoutStore.subscribe, read, read);

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (userName !== null) navigatorLayoutStore.set(userName, { scriptsCollapsed: next });
    },
    [userName],
  );

  return [collapsed, setCollapsed];
}

/**
 * As pastas abertas de uma árvore do navegador (RN-NAV-014), e quem as muda: as pastas de conexões (`"connections"`) e as de scripts (`"scripts"`, RN-SCRIPT-008)
 * voltam como a pessoa as deixou, na próxima entrada e em outra janela, por usuário do cofre aberto. O conjunto é o MESMO objeto até a árvore mudar. A função
 * devolve se a janela viu a mudança (abrir a pasta que já está aberta não altera o que ela vê, e não há outra renderização a esperar). Sem usuário (a sessão ainda não
 * chegou), nada aberto e nada gravado. Quem escreve é sempre um evento ou um efeito, nunca a renderização.
 */
export function useOpenFolders(tree: FolderTree): [ReadonlySet<string>, (change: FolderChange) => boolean] {
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? null;

  const read = () => (userName === null ? noOpenFolders : folderMemoryStore.get(userName, tree));
  const open = useSyncExternalStore(folderMemoryStore.subscribe, read, read);

  const change = useCallback((next: FolderChange) => (userName === null ? false : folderMemoryStore.change(userName, tree, next)), [userName, tree]);

  return [open, change];
}
