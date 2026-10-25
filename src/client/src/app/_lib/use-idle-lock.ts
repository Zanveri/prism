import { useEffect, useEffectEvent, useState } from "react";

import { resultHostRegistry } from "@/lib/host/host";

import { createIdleTimer } from "./idle-timer";
import { watchActivity } from "./idle-watch";
import { shouldShareActivity } from "./peer-session";

/** De quanto em quanto tempo a contagem é conferida; é também o passo do "faltam N s" do aviso. */
const checkEveryMs = 1000;

type IdleLockOptions = {
  /** Bloqueio ligado e Prism desbloqueado: bloqueado, ou desligado, nada conta. */
  enabled: boolean;
  minutes: number;
  /** Há comando em andamento em alguma aba? Lido a cada conferência. */
  isBusy: () => boolean;
  /** O tempo acabou. Chamado uma vez; quem chama bloqueia, e `enabled` passa a falso. */
  onLock: () => void;
  /**
   * RN-ABAS-004: as outras janelas. A atividade desta (e, a cada conferência, o comando em andamento nela) vai a elas, no máximo uma vez por segundo
   * (`share`), e a delas chega aqui (`subscribe`) e recomeça esta contagem: o Prism só bloqueia quando nenhuma janela foi usada no prazo. Estável.
   */
  peers?: { share: () => void; subscribe: (onActivity: () => void) => () => void };
};

/**
 * Liga a contagem do bloqueio por inatividade (RN-SEG-001) à janela. Devolve quantos segundos faltam enquanto o aviso deve estar
 * na tela, e `null` fora dele.
 *
 * Os eventos que contam como "mexer" e as regras deles (captura, só o que a pessoa faz, o `pointermove` parado, o toque que acorda a
 * janela) estão em `watchActivity`, testada. Vale em qualquer tela de dentro do cofre, porque quem usa isto fica acima delas. A
 * conferência é a cada segundo e também quando a janela volta a aparecer.
 */
export function useIdleLock({ enabled, minutes, isBusy, onLock, peers }: IdleLockOptions): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const busy = useEffectEvent(isBusy);
  const lock = useEffectEvent(onLock);
  const sharePeers = useEffectEvent(() => peers?.share());
  const subscribePeers = useEffectEvent((listener: () => void) => peers?.subscribe(listener) ?? (() => {}));

  useEffect(() => {
    if (!enabled) return;

    // A contagem nasce junto do efeito: ligar de novo (ou desbloquear) começa do zero.
    const timer = createIdleTimer(Date.now);
    let stopped = false;
    let lastShared: number | null = null;

    function share() {
      const now = Date.now();
      if (!shouldShareActivity(lastShared, now)) return;
      lastShared = now;
      sharePeers();
    }

    // O que a pessoa faz nesta janela recomeça a contagem daqui e vai às outras.
    const counted = {
      activity() {
        const restarted = timer.activity();
        if (restarted) share();
        return restarted;
      },
    };

    function check() {
      if (stopped) return;

      const running = busy();
      // O comando em andamento aqui também segura as outras janelas: o tempo delas recomeça do fim dele, como o daqui.
      if (running) share();
      const status = timer.check({ enabled: true, minutes, busy: running });
      setSecondsLeft(status.phase === "warning" ? status.secondsLeft : null);
      if (status.phase === "lock") {
        stopped = true;
        lock();
      }
    }

    const stopWatching = watchActivity({ window, document, timer: counted, check });
    // RN-SEG-001 e RN-ABAS-015: o que a pessoa faz na janela do resultado também conta como atividade (ela é uma página à parte, com a janela dela).
    const stopResultWindows = resultHostRegistry.each((host) => watchActivity({ window: host.view, document: host.document, timer: counted, check }));
    // A pessoa mexeu em outra janela: a contagem daqui recomeça (ou, se o prazo já tinha acabado com esta janela dormindo, bloqueia).
    const stopPeers = subscribePeers(() => {
      timer.activity();
      check();
    });
    const interval = setInterval(check, checkEveryMs);

    return () => {
      stopped = true;
      clearInterval(interval);
      stopWatching();
      stopResultWindows();
      stopPeers();
      setSecondsLeft(null);
    };
  }, [enabled, minutes]);

  return enabled ? secondsLeft : null;
}
