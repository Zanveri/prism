import { useEffect, useEffectEvent, useState } from "react";

import { createIdleTimer } from "./idle-timer";
import { watchActivity } from "./idle-watch";

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
};

/**
 * Liga a contagem do bloqueio por inatividade (RN-SEG-001) à janela. Devolve quantos segundos faltam enquanto o aviso deve estar
 * na tela, e `null` fora dele.
 *
 * Os eventos que contam como "mexer" e as regras deles (captura, só o que a pessoa faz, o `pointermove` parado, o toque que acorda a
 * janela) estão em `watchActivity`, testada. Vale em qualquer tela de dentro do cofre, porque quem usa isto fica acima delas. A
 * conferência é a cada segundo e também quando a janela volta a aparecer.
 */
export function useIdleLock({ enabled, minutes, isBusy, onLock }: IdleLockOptions): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const busy = useEffectEvent(isBusy);
  const lock = useEffectEvent(onLock);

  useEffect(() => {
    if (!enabled) return;

    // A contagem nasce junto do efeito: ligar de novo (ou desbloquear) começa do zero.
    const timer = createIdleTimer(Date.now);
    let stopped = false;

    function check() {
      if (stopped) return;

      const status = timer.check({ enabled: true, minutes, busy: busy() });
      setSecondsLeft(status.phase === "warning" ? status.secondsLeft : null);
      if (status.phase === "lock") {
        stopped = true;
        lock();
      }
    }

    const stopWatching = watchActivity({ window, document, timer, check });
    const interval = setInterval(check, checkEveryMs);

    return () => {
      stopped = true;
      clearInterval(interval);
      stopWatching();
      setSecondsLeft(null);
    };
  }, [enabled, minutes]);

  return enabled ? secondsLeft : null;
}
