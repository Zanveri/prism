import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getSession, sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import type { Session } from "@/app/sign-in/_lib/sign-in.schema";
import { pathsConfig } from "@/config/paths.config";
import { onPeerEvent } from "@/lib/api/bridge";
import { vaultLock } from "@/lib/api/vault-lock";

import { peerAction } from "../_lib/peer-session";

type Navigate = (to: string, options: { replace: true }) => unknown;

/**
 * RN-ABAS-004: o "Sair" de outra janela vale para esta (ela vai ao login e esquece o que tinha, como no "Sair" daqui), e o login de outra libera esta
 * (no login, ela entra). O bloqueio e o desbloqueio são do `VaultLock`, que só existe dentro do cofre; isto vale em qualquer tela, também no login.
 * Recebe o roteador de fora (`app.tsx`), porque fica acima dele, ao lado das consultas.
 */
export function PeerSession({ pathname, navigate }: { pathname: () => string; navigate: Navigate }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    function leave() {
      void navigate(pathsConfig.signIn, { replace: true });
      queryClient.clear();
    }

    // Outra janela entrou, e esta está dentro de um cofre: entrar fecha o cofre de quem estava antes (RN-COFRE-007). Se o cofre aberto agora não é o
    // do usuário desta janela, ela sai; sem saber de quem é a sessão daqui (ela ainda está conferindo), só confere de novo.
    async function checkUser() {
      const mine = queryClient.getQueryData<Session>(sessionQuery.queryKey);
      if (mine === undefined) return void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });

      const current = await getSession();
      if (!current.ok || !current.data.unlocked || current.data.userName !== mine.userName) leave();
    }

    return onPeerEvent((kind) => {
      const where = pathname() === pathsConfig.signIn ? "outside" : vaultLock.isLocked() ? "locked" : "open";
      const action = peerAction(kind, where);
      if (action === "leave") leave();
      else if (action === "enter") {
        // Como o login daqui: o que estava em cache era de antes de entrar.
        queryClient.clear();
        void navigate(pathsConfig.workbench, { replace: true });
      } else if (action === "checkUser") void checkUser();
    });
  }, [queryClient, pathname, navigate]);

  return null;
}
