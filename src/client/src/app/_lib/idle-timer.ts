import { defaultPreferences, preferenceLimits } from "@/app/settings/_lib/preferences";

/** O aviso vem este tanto antes do bloqueio (RN-SEG-001). */
export const idleWarningSeconds = 60;

/**
 * Os minutos até bloquear que valem: de 1 a 240, inteiros. Outra coisa (o armazenamento é da janela e pode ter qualquer
 * valor, de uma versão antiga ou editado à mão) cai no padrão de 10 em vez de bloquear na hora ou nunca.
 */
export function effectiveMinutes(minutes: number): number {
  const { min, max } = preferenceLimits.lockMinutes;
  return Number.isInteger(minutes) && minutes >= min && minutes <= max ? minutes : defaultPreferences.security.lockAfterMinutes;
}

export type IdleSettings = {
  /** `security.lockEnabled`. */
  enabled: boolean;
  /** `security.lockAfterMinutes`. */
  minutes: number;
  /** Algum executor de aba tem comando em andamento (inclusive "carregar mais" e contagem). */
  busy: boolean;
};

export type IdleStatus =
  /** Bloqueio desligado: nada conta. */
  | { phase: "off" }
  /** Há comando em andamento: o tempo não conta. */
  | { phase: "paused" }
  | { phase: "counting" }
  /** Faltam `secondsLeft` segundos (de 1 até o aviso inteiro): é quando a tela avisa. */
  | { phase: "warning"; secondsLeft: number }
  | { phase: "lock" };

/**
 * A contagem do bloqueio por inatividade (RN-SEG-001), sem timer nem DOM: o relógio vem de fora, e quem usa a chama de tempos em
 * tempos (`check`) e avisa o que é atividade (`activity`: tecla, ponteiro ou roda).
 *
 * O tempo conta desde a última atividade. Com comando em andamento ele não conta, e recomeça quando o último termina: a primeira
 * conferência sem comando, depois de uma com comando (ou de uma com o bloqueio desligado), começa a contar dali. Dois comandos em
 * abas diferentes são um `busy` só, que o chamador soma.
 */
export function createIdleTimer(clock: () => number) {
  let since = clock();
  /** O último instante que o relógio mostrou: se ele agora mostra menos, o relógio do sistema voltou. */
  let lastSeen = since;
  /** A conferência anterior estava contando? Se não (desligado, comando em andamento), esta recomeça do zero. */
  let counting = true;
  /** O prazo, em milissegundos, que a última conferência que contava usou; `null` enquanto nada conta. */
  let limit: number | null = null;

  /**
   * O relógio agora. O do sistema pode voltar (o horário acertado, o fuso, uma sincronização): sem cuidado, o tempo que já passou deixaria de
   * contar e o bloqueio viria horas depois do prazo (voltando 1 h aos 9 minutos, 70 minutos reais sem uso). Se voltou, o início da contagem
   * recua pelo mesmo salto, e o que já passou continua tendo passado.
   */
  function now(): number {
    const current = clock();
    if (current < lastSeen) since -= lastSeen - current;
    lastSeen = current;
    return current;
  }

  return {
    /**
     * Tecla, ponteiro ou roda: recomeça a contagem inteira, e o aviso que estava na tela perde o motivo de existir. Devolve se
     * recomeçou. Não recomeça quando o prazo da última conferência já tinha acabado: é a janela que dormiu (os temporizadores
     * param, e nenhuma conferência viu o tempo acabar), e o toque que a acordou não pode salvar um Prism que ficou horas sem uso.
     * Quem chama confere de novo, e a conferência diz `lock`.
     */
    activity(): boolean {
      const current = now();
      if (limit !== null && current - since >= limit) return false;

      since = current;
      return true;
    },

    check({ enabled, minutes, busy }: IdleSettings): IdleStatus {
      if (!enabled || busy) {
        counting = false;
        limit = null;
        return enabled ? { phase: "paused" } : { phase: "off" };
      }
      const current = now();
      if (!counting) {
        counting = true;
        since = current;
      }

      limit = effectiveMinutes(minutes) * 60_000;
      const left = limit - (current - since);
      if (left <= 0) return { phase: "lock" };

      // Com o mínimo de 1 minuto, avisar 60 segundos antes seria no instante do último toque, e mexer o traria de volta a cada tecla: aí o aviso vem na metade final.
      const lead = Math.min(idleWarningSeconds * 1000, limit / 2);
      return left <= lead ? { phase: "warning", secondsLeft: Math.ceil(left / 1000) } : { phase: "counting" };
    },
  };
}
