import { createContext, useContext, useEffect, useEffectEvent, type ReactNode } from "react";

import { mainHost, resultHostRegistry, type Host } from "@/lib/host/host";

const HostContext = createContext<Host | null>(null);

/**
 * Em que página (o documento e a janela dele) está o que a árvore do React desenha aqui (RN-ABAS-017). A área de resultado de uma aba pode estar na página da
 * janela do resultado, e o diálogo, o menu, a lista, o aviso e o autocompletar que nascem nela têm de abrir no `body` DESSA página, ouvir o ponteiro e o teclado
 * dela e medir a janela dela. `ResultHost` dá o contexto a tudo o que desenha; quem desenha fora dele (os diálogos que a aba de consulta mostra por ela) o dá
 * pelo que a pessoa está usando agora. Sem provedor, vale a janela da aba.
 */
export function HostProvider({ host, children }: { host: Host; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

/** A página de onde este componente desenha: a do contexto, ou a da janela da aba. */
export function useHost(): Host {
  return useContext(HostContext) ?? mainHost();
}

/**
 * O que abriu na página de uma janela do resultado fecha, sem aplicar, quando a página sai (RN-ABAS-011): a área de resultado trocou de lugar, a pessoa fechou a
 * janela ou o bloqueio a fechou. Sem isto o diálogo, o menu ou a lista ficaria num documento morto e a pergunta, pendurada na janela da aba. A janela da aba não
 * sai enquanto o app está aberto, e então nada acontece nela. `onGone` é o fechar de sempre de quem chama (o Esc).
 */
export function useOnHostGone(host: Host, active: boolean, onGone: () => void): void {
  const gone = useEffectEvent(onGone);

  useEffect(() => {
    if (!active || host.resultWindow === null) return;

    return resultHostRegistry.subscribe(() => {
      if (!resultHostRegistry.list().includes(host)) gone();
    });
  }, [active, host]);
}
