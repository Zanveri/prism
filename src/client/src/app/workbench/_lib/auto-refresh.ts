import type { RunnerState, RunTarget } from "./use-query-runner";

/**
 * A atualização automática do resultado (RN-GRADE-014, issue #11): o comando de uma leitura executado de novo, sozinho, a cada intervalo, para acompanhar
 * dados que mudam. Aqui fica o relógio, sem React e sem DOM (os temporizadores e o relógio vêm de fora, e o teste os troca); quem o liga ao comando é o
 * executor da aba (`createQueryRunner`), que é dono do comando, da sessão e de tudo o que o desliga (soltar a aba, aposentá-la).
 *
 * O que ele decide:
 * - a próxima execução só é marcada quando a anterior termina, e conta do fim dela: nunca duas ao mesmo tempo. Vale para qualquer coisa que ocupe a aba
 *   ("Carregar mais", "Contar total", o F5): o fim dela recomeça o tempo;
 * - fica em pausa enquanto a vista pede (`pause`: a aba fora de vista, a grade com edição), e ao sair dela executa na hora se o prazo já passou;
 * - para sozinho, com o motivo (`stopped`), quando uma execução não traz um resultado de leitura NOVO: o erro, o cancelamento, o comando que não pôde ser
 *   executado (o resultado de antes continua na tela, o mesmo objeto) e o comando que gravou; e quando a sessão da aba cai (`lost`): a execução
 *   automática não abre outra, porque nada reconecta sozinho (RN-SESSAO-004);
 * - desliga quando a pessoa executa OUTRO comando (`ranByPerson`); o mesmo comando (o F5) o mantém, e o tempo recomeça do fim dele;
 * - esquece a execução que o executor abandonou para o comando da pessoa (`yielded`): o desfecho dela não conta, e quem diz se segue é o comando da pessoa.
 */

/** Os intervalos do menu, em milissegundos: 5 s, 10 s, 30 s, 1 min e 5 min. */
export const autoRefreshChoices: readonly number[] = [5_000, 10_000, 30_000, 60_000, 300_000];

/** "Personalizado…": segundos inteiros, de 2 a 3.600 (uma hora). */
export const customSecondsLimits = { min: 2, max: 3_600 } as const;

/** Por que a atualização automática parou sozinha: o erro, o cancelamento, o comando que não pôde ser executado, o comando que gravou, a sessão que caiu. */
export type AutoRefreshStop = "failed" | "cancelled" | "notRun" | "writes" | "disconnected";

/**
 * O que a deixa em pausa: a aba fora de vista (outra aba, outra vista, outra tela), a grade com edição (alteração não salva, célula aberta, menu ou
 * diálogo) ou a aba indo para outra janela (RN-ABAS-002 e 003: a outra janela recebe a sessão livre, `handOffTab`).
 */
export type AutoRefreshPause = "hidden" | "editing" | "moving";

/** Por que ela não liga agora: a aba ocupada, o comando que grava, nenhuma linha de leitura na tela, a aba sem sessão. */
export type AutoRefreshBlocker = "busy" | "writes" | "noRows" | "disconnected";

export type AutoRefreshState =
  /** Desligada; `stopped` é o motivo, quando ela parou sozinha, e fica até a próxima execução ou até a pessoa ligar de novo. */
  | { status: "off"; stopped: AutoRefreshStop | null }
  /**
   * Ligada: o intervalo, a hora da última atualização (nula até a primeira), se uma execução automática está em andamento e a pausa que vale agora (a da
   * edição antes da de fora de vista: é a que a pessoa vê).
   */
  | { status: "on"; everyMs: number; lastAt: number | null; running: boolean; paused: AutoRefreshPause | null };

/** O que a aba oferece a quem desenha: ligar, trocar o intervalo, desligar e as pausas. */
export type AutoRefreshControl = {
  subscribe: (listener: () => void) => () => void;
  getState: () => AutoRefreshState;
  /** Por que não liga agora, ou nulo. Ligada, nada a impede de trocar o intervalo ou desligar. */
  blocker: () => AutoRefreshBlocker | null;
  /** Liga com este intervalo, sobre o comando das linhas na tela; ligada, troca o intervalo. Com um impedimento, não faz nada. */
  start: (everyMs: number) => void;
  /** A pessoa desligou: sem nota. */
  stop: () => void;
  /** A vista diz o que a deixa em pausa: `on` liga a pausa, `false` a tira. */
  pause: (reason: AutoRefreshPause, on: boolean) => void;
};

/** As peças do relógio. O executor entrega o estado dele e a assinatura; o teste, os temporizadores falsos. */
export type AutoRefreshDeps = {
  getState: () => RunnerState;
  /** O executor avisa cada mudança de estado. */
  subscribe: (listener: () => void) => () => void;
  /** Há algo em andamento na aba (`isBusyState`). */
  isBusy: (state: RunnerState) => boolean;
  /** A aba tem sessão aberta: sem ela, ligar reconectaria sozinho (RN-SESSAO-004). */
  connected: () => boolean;
  /** Executa o comando como execução automática; o desfecho é lido no estado do executor quando ele termina. */
  run: (target: RunTarget) => Promise<unknown>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** A mesma consulta: o mesmo texto e o mesmo filtro do resultado (RN-GRADE-011). O lugar no editor e o banco não mudam o comando. */
export function sameCommand(a: RunTarget, b: RunTarget): boolean {
  return a.sql === b.sql && (a.filter ?? "") === (b.filter ?? "");
}

/**
 * Por que a atualização automática não liga agora, ou nulo (RN-GRADE-014): a aba ocupada; o resultado que não é de leitura (o que o comando que grava
 * devolveu, RN-SQL-013, e as linhas afetadas); nenhuma linha na tela; e a aba sem sessão. Quem diz se o comando grava é a API (`totalRows`, a mesma regra da
 * RN-SQL-013: no PostgreSQL o próprio banco, pela transação só de leitura), e não uma leitura do texto na tela.
 */
export function autoRefreshBlocker(state: RunnerState, { busy, connected }: { busy: boolean; connected: boolean }): AutoRefreshBlocker | null {
  if (busy) return "busy";
  if (state.status === "affected") return "writes";
  if (state.status !== "rows") return "noRows";
  if (state.totalRows !== null) return "writes";
  return connected ? null : "disconnected";
}

/** Como a execução terminou, para o relógio: o resultado de leitura novo, ou o motivo de parar. */
export function outcomeOf(state: RunnerState, before: RunnerState | null): AutoRefreshStop | null {
  if (state.status === "error") return "failed";
  if (state.status === "cancelled") return "cancelled";
  if (state.status === "affected" || (state.status === "rows" && state.totalRows !== null)) return "writes";
  // O resultado de antes de volta (o mesmo objeto): a API não aceitou o comando (fora do ar, sessão ocupada, um erro inesperado).
  return state.status === "rows" && state !== before ? null : "notRun";
}

/** O intervalo como a tela o escreve: "5 s", "1 min", "1 min 30 s", "1 h". */
export function intervalLabel(everyMs: number): string {
  const seconds = Math.round(everyMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  if (seconds >= 3_600 && seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** O "Personalizado…": os segundos digitados, inteiros e dentro do limite, em milissegundos; ou nulo. */
export function customInterval(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return seconds >= customSecondsLimits.min && seconds <= customSecondsLimits.max ? seconds * 1000 : null;
}

/** O que só o executor chama: o comando da pessoa, a execução automática que ele abandonou, a sessão que caiu e a aba solta. */
export type AutoRefreshRunnerSide = {
  /** Antes de enviar um comando da pessoa: outro comando a desliga; o mesmo a mantém. */
  ranByPerson: (target: RunTarget) => void;
  /** O executor abandonou a execução automática em andamento, para o comando da pessoa: o desfecho dela não conta. */
  yielded: () => void;
  /** A sessão da aba caiu (a API já não a conhece): desliga, com a nota. */
  lost: () => void;
  /** A aba foi solta (desconectar, fechar, trocar de banco, ir para outra janela, o bloqueio): desliga, sem nota. */
  halt: () => void;
};

/** O relógio da atualização automática de uma aba (RN-GRADE-014). */
export function createAutoRefresh(deps: AutoRefreshDeps): AutoRefreshControl & AutoRefreshRunnerSide {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: AutoRefreshState = { status: "off", stopped: null };
  const listeners = new Set<() => void>();
  /** O comando que ela repete: o das linhas na tela quando ligou. */
  let target: RunTarget | null = null;
  let dueAt = 0;
  let timer: unknown = null;
  const pauses = new Set<AutoRefreshPause>();

  /** O que se viu do executor: se ele estava ocupado, se a ocupação foi uma execução (e de qual resultado ela partiu), e se a execução foi a automática. */
  let wasBusy = deps.isBusy(deps.getState());
  let ran: { from: RunnerState | null } | null = null;
  /** A execução automática foi pedida e ainda não terminou; `fired` conta as pedidas, para a resposta atrasada de uma não falar pela seguinte. */
  let firing = false;
  let fired = 0;

  function publish(next: AutoRefreshState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function patchOn(patch: Partial<Extract<AutoRefreshState, { status: "on" }>>) {
    if (state.status === "on") publish({ ...state, ...patch });
  }

  const pausedNow = (): AutoRefreshPause | null => (["editing", "moving", "hidden"] as const).find((reason) => pauses.has(reason)) ?? null;

  function disarm() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  /** Marca a próxima execução para `dueAt`, se nada a impede agora; com a aba ocupada, quem marca é o fim do que a ocupa. */
  function arm() {
    disarm();
    if (state.status !== "on" || pauses.size > 0 || firing || deps.isBusy(deps.getState())) return;
    timer = setTimer(tick, Math.max(0, dueAt - now()));
  }

  function off(stopped: AutoRefreshStop | null) {
    disarm();
    target = null;
    firing = false;
    if (state.status !== "off" || state.stopped !== stopped) publish({ status: "off", stopped });
  }

  function tick() {
    timer = null;
    if (state.status !== "on" || target === null || pauses.size > 0 || deps.isBusy(deps.getState())) return;
    // A aba perdeu a sessão sem que o executor dissesse (`lost`): executar abriria outra sozinho.
    if (!deps.connected()) return off("disconnected");

    firing = true;
    const token = ++fired;
    patchOn({ running: true });
    void deps.run(target).finally(() => {
      // O executor recusou sem chegar a executar (nada de "executando" no meio): não há o que esperar, e ela para.
      if (firing && token === fired && state.status === "on") off("notRun");
    });
  }

  /** Cada mudança do executor: o fim de uma ocupação recomeça o tempo e, se foi uma execução, diz se ela trouxe um resultado de leitura novo. */
  function observe() {
    const current = deps.getState();
    const busy = deps.isBusy(current);
    if (current.status === "running" && ran === null) ran = { from: current.previous };
    if (busy || !wasBusy) {
      wasBusy = busy;
      return;
    }

    wasBusy = false;
    const finished = ran;
    ran = null;
    const auto = firing;
    firing = false;
    if (state.status !== "on") return;

    if (finished !== null) {
      const stop = outcomeOf(current, finished.from);
      if (stop !== null) return off(stop);
      patchOn({ lastAt: now(), running: false });
    } else if (auto) patchOn({ running: false });

    dueAt = now() + state.everyMs;
    arm();
  }

  deps.subscribe(observe);

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    blocker: () => (state.status === "on" ? null : autoRefreshBlocker(deps.getState(), { busy: deps.isBusy(deps.getState()), connected: deps.connected() })),
    start: (everyMs) => {
      if (state.status === "on") {
        patchOn({ everyMs });
        dueAt = now() + everyMs;
        return arm();
      }
      const current = deps.getState();
      if (current.status !== "rows" || autoRefreshBlocker(current, { busy: deps.isBusy(current), connected: deps.connected() }) !== null) return;

      target = current.target;
      dueAt = now() + everyMs;
      publish({ status: "on", everyMs, lastAt: null, running: false, paused: pausedNow() });
      arm();
    },
    stop: () => off(null),
    pause: (reason, on) => {
      if (on === pauses.has(reason)) return;
      if (on) pauses.add(reason);
      else pauses.delete(reason);
      patchOn({ paused: pausedNow() });
      arm();
    },
    ranByPerson: (command) => {
      if (state.status === "off") {
        if (state.stopped !== null) publish({ status: "off", stopped: null });
        return;
      }
      if (target !== null && !sameCommand(command, target)) off(null);
    },
    yielded: () => {
      // O comando da pessoa entra no lugar: é o fim DELE que diz se segue (o mesmo comando) e que recomeça o tempo.
      firing = false;
      ran = null;
      patchOn({ running: false });
    },
    lost: () => {
      if (state.status === "on") off("disconnected");
    },
    halt: () => off(null),
  };
}
