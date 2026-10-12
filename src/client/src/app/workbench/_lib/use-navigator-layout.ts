import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

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
