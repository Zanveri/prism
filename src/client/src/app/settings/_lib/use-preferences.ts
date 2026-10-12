import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { defaultPreferences, preferencesStore, type PreferencesPatch } from "./preferences";

/**
 * As preferências do usuário do cofre aberto, e quem as muda. Quem usa é avisado a cada mudança: a tela de
 * Configurações grava, e o resto (o tema, o editor) lê. Sem usuário (a sessão ainda não chegou) vale o padrão e
 * `update` não faz nada: sem usuário não há chave onde gravar.
 */
export function usePreferences() {
  // O guard já buscou a sessão (mesma chave): aqui só se lê o que ele guardou, como na barra superior.
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? null;

  const read = () => (userName === null ? defaultPreferences : preferencesStore.get(userName));
  const preferences = useSyncExternalStore(preferencesStore.subscribe, read, read);

  const update = useCallback(
    (patch: PreferencesPatch) => {
      if (userName !== null) preferencesStore.set(userName, patch);
    },
    [userName],
  );

  return { preferences, update, signedIn: userName !== null };
}
