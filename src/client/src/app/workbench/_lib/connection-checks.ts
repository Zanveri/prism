import type { ConnectionVerificationResult } from "@/app/connections/_lib/connections.schema";

import { connectionChecksCopy } from "./connection-checks.copy";

/**
 * A verificação periódica das conexões conectadas (RN-VERIF-002 e 003), sem React: quais verificar, o relógio de cada uma, o pedido à API, a vez entre as
 * janelas e o que o indicador mostra. Um por janela (`connectionChecks`, em `use-connection-checks.ts`), alimentado pelo `ConnectionChecks` do provedor da
 * área de trabalho; as dependências vêm de fora, para o teste ter o relógio e as respostas na mão.
 */

/** O que o indicador mostra de uma conexão conectada com a verificação ligada (RN-VERIF-003). */
export type CheckState =
  /** Conectada, sem resposta ainda: a primeira verificação vem um intervalo depois de ela entrar (a sessão acabou de abrir, e a abertura já respondeu). */
  | { kind: "waiting"; busy: boolean }
  | { kind: "ok"; checkedAt: string; elapsedMs: number; busy: boolean }
  | { kind: "failed"; checkedAt: string; elapsedMs: number | null; message: string; sqlState: string | null; busy: boolean }
  /** A API não tinha sessão aberta com ela: a tela para de verificá-la até uma sessão nova abrir (a próxima ação na árvore ou na aba). */
  | { kind: "notConnected" };

/**
 * Uma conexão a verificar: o intervalo, em segundos, e as sessões dela nesta janela (a da árvore e as das abas), numa chave: com `notConnected` a
 * verificação para, e volta quando a chave muda, porque uma sessão nova abriu.
 */
export type CheckTarget = { intervalSeconds: number; sessions: string };

export type ConnectionChecksDeps = {
  /** O pedido à API; `null` quando ele falhou (a API fora do ar, a conexão que sumiu, o pedido abandonado): o indicador fica como estava. Nunca lança. */
  verify: (connectionId: string, signal: AbortSignal) => Promise<ConnectionVerificationResult | null>;
  /** A vez entre as janelas: só uma verifica a mesma conexão por intervalo (`window-hub.ts`). Fora do Electron, sempre `true`. Nunca lança. */
  claim: (connectionId: string, intervalMs: number) => Promise<boolean>;
  /** A vez acabou: a resposta vai às outras janelas, ou, nula, só a vez fica livre. */
  finish: (connectionId: string, result: ConnectionVerificationResult | null) => void;
  schedule: (run: () => void, ms: number) => () => void;
  /** O cofre está bloqueado (RN-SEG-001): nada sai, e quem alimenta tira as conexões em seguida. */
  paused: () => boolean;
};

/** A conexão passou de responder a não responder (`failed`), ou voltou a responder (`recovered`): o aviso sai uma vez (RN-VERIF-003). */
export type CheckTransition = "failed" | "recovered";

type Entry = {
  target: CheckTarget;
  state: CheckState;
  cancelTimer: (() => void) | null;
  /** `claiming`: pedindo a vez; `verifying`: o pedido à API está a caminho. Nunca dois ao mesmo tempo (o intervalo conta do fim do anterior). */
  phase: "idle" | "claiming" | "verifying";
  /** Abandona o pedido a caminho: a conexão desconectou, ou o cofre bloqueou. */
  abort: AbortController | null;
};

const waiting: CheckState = Object.freeze({ kind: "waiting", busy: false });

export function createConnectionChecks(deps: ConnectionChecksDeps) {
  const entries = new Map<string, Entry>();
  let snapshot: ReadonlyMap<string, CheckState> = new Map();
  const listeners = new Set<() => void>();
  const transitionListeners = new Set<(connectionId: string, transition: CheckTransition) => void>();

  function publish() {
    snapshot = new Map([...entries].map(([id, entry]) => [id, entry.state]));
    for (const listener of listeners) listener();
  }

  function schedule(id: string, entry: Entry, ms = entry.target.intervalSeconds * 1000) {
    entry.cancelTimer?.();
    entry.cancelTimer = deps.schedule(() => void run(id, entry), ms);
  }

  function drop(id: string, entry: Entry) {
    entry.cancelTimer?.();
    entry.cancelTimer = null;
    entry.abort?.abort();
    entries.delete(id);
  }

  /** A resposta, no indicador: `busy` deixa como estava, com a marca da dica; a passagem de responder a não responder (e de volta) avisa. */
  function apply(id: string, entry: Entry, result: ConnectionVerificationResult) {
    const before = entry.state;
    switch (result.status) {
      case "ok":
        entry.state = { kind: "ok", checkedAt: result.checkedAt, elapsedMs: result.elapsedMs ?? 0, busy: false };
        break;
      case "failed":
        entry.state = { kind: "failed", checkedAt: result.checkedAt, elapsedMs: result.elapsedMs, message: result.message ?? "", sqlState: result.sqlState, busy: false };
        break;
      case "busy":
        entry.state = before.kind === "notConnected" ? before : { ...before, busy: true };
        break;
      case "notConnected":
        entry.state = { kind: "notConnected" };
        break;
    }

    if (entry.state.kind === "failed" && before.kind !== "failed") for (const listener of transitionListeners) listener(id, "failed");
    if (entry.state.kind === "ok" && before.kind === "failed") for (const listener of transitionListeners) listener(id, "recovered");
  }

  /** O relógio da conexão disparou: pede a vez, verifica, e o relógio recomeça do fim (com `notConnected`, para). */
  async function run(id: string, entry: Entry) {
    entry.cancelTimer = null;
    if (entries.get(id) !== entry) return;
    // Bloqueado, nada sai; quem alimenta tira a conexão em seguida (as sessões já fecharam).
    if (deps.paused()) return schedule(id, entry);

    entry.phase = "claiming";
    const abort = new AbortController();
    entry.abort = abort;
    const granted = await deps.claim(id, entry.target.intervalSeconds * 1000);
    if (entries.get(id) !== entry || abort.signal.aborted) {
      if (granted) deps.finish(id, null);
      return;
    }
    if (!granted) {
      // Outra janela está verificando, ou acabou de verificar: a resposta dela chega por `peer`, que recomeça o relógio.
      entry.phase = "idle";
      entry.abort = null;
      return schedule(id, entry);
    }

    entry.phase = "verifying";
    const result = await deps.verify(id, abort.signal);
    deps.finish(id, result);
    if (entries.get(id) !== entry || abort.signal.aborted) return;

    entry.phase = "idle";
    entry.abort = null;
    if (result !== null) {
      apply(id, entry, result);
      publish();
    }
    if (entry.state.kind !== "notConnected") schedule(id, entry);
  }

  return {
    /**
     * As conexões a verificar agora (as conectadas nesta janela com a verificação ligada) e o intervalo de cada uma. A que sai para de ser verificada na hora
     * (o pedido a caminho é abandonado) e sai do indicador; a que entra começa a contar o intervalo; a que mudou de intervalo recomeça a contar dele; e a que
     * estava sem sessão (`notConnected`) e ganhou uma sessão nova volta a ser verificada.
     */
    track(targets: ReadonlyMap<string, CheckTarget>) {
      let changed = false;
      for (const [id, entry] of [...entries]) {
        if (targets.has(id)) continue;
        drop(id, entry);
        changed = true;
      }

      for (const [id, target] of targets) {
        const entry = entries.get(id);
        if (entry === undefined) {
          const created: Entry = { target, state: waiting, cancelTimer: null, phase: "idle", abort: null };
          entries.set(id, created);
          schedule(id, created);
          changed = true;
          continue;
        }

        const before = entry.target;
        entry.target = target;
        if (entry.state.kind === "notConnected" && before.sessions !== target.sessions) {
          entry.state = waiting;
          if (entry.phase === "idle") schedule(id, entry);
          changed = true;
        } else if (before.intervalSeconds !== target.intervalSeconds && entry.phase === "idle" && entry.state.kind !== "notConnected") {
          schedule(id, entry);
        }
      }

      if (changed) publish();
    },

    /**
     * A resposta da verificação que outra janela fez (RN-VERIF-002): a da conexão que esta janela também verifica vai ao indicador, e o relógio daqui
     * recomeça dela. A que chega com a verificação daqui a caminho fica de fora (a daqui é a mais nova), e também a da conexão sem sessão aqui. `busy` e
     * `notConnected` dizem respeito às sessões da outra janela: só recomeçam o relógio.
     */
    peer(connectionId: string, result: ConnectionVerificationResult) {
      const entry = entries.get(connectionId);
      if (entry === undefined || entry.phase === "verifying" || entry.state.kind === "notConnected") return;

      if (result.status === "ok" || result.status === "failed") {
        apply(connectionId, entry, result);
        publish();
      }
      if (entry.phase === "idle") schedule(connectionId, entry);
    },

    /** O que o indicador mostra de cada conexão verificada (a mesma instância enquanto nada muda); a conexão de fora não está. */
    snapshot: (): ReadonlyMap<string, CheckState> => snapshot,

    get: (connectionId: string): CheckState | null => snapshot.get(connectionId) ?? null,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** A conexão passou de responder a não responder, ou voltou: quem avisa é a tela, com o nome dela. */
    onTransition(listener: (connectionId: string, transition: CheckTransition) => void): () => void {
      transitionListeners.add(listener);
      return () => void transitionListeners.delete(listener);
    },
  };
}

export type ConnectionChecks = ReturnType<typeof createConnectionChecks>;

/**
 * As conexões cuja verificação respondeu que a API não tem sessão aberta com elas (`notConnected`, o "Sem sessão aberta"), na ordem da foto. Elas não contam
 * como conectadas (RN-NAV-013: a conta e o filtro do navegador, a lista do botão da conexão da aba e o script genérico, `connectedConnectionIds`) até uma
 * sessão nova abrir: sem isso a conta e o filtro diriam "conectada" ao lado do indicador que diz o contrário.
 */
export function notConnectedIds(snapshot: ReadonlyMap<string, CheckState>): string[] {
  return [...snapshot].flatMap(([connectionId, state]) => (state.kind === "notConnected" ? [connectionId] : []));
}

/** Como o indicador aparece (RN-VERIF-003): o tom do ponto, o texto (o nome acessível) e a dica, com a marca de ocupada quando a última resposta foi `busy`. */
export type CheckView = { tone: "waiting" | "ok" | "failed" | "notConnected"; label: string; tip: string };

export function checkView(state: CheckState): CheckView {
  const copy = connectionChecksCopy;
  const busy = (tip: string) => (state.kind !== "notConnected" && state.busy ? `${tip}\n${copy.tip.busy}` : tip);
  switch (state.kind) {
    case "waiting":
      return { tone: "waiting", label: copy.state.waiting, tip: busy(copy.tip.waiting) };
    case "ok":
      return { tone: "ok", label: copy.state.ok, tip: busy(copy.tip.ok(state.checkedAt, state.elapsedMs)) };
    case "failed":
      return { tone: "failed", label: copy.state.failed, tip: busy(copy.tip.failed(state.checkedAt, state.message, state.sqlState)) };
    case "notConnected":
      return { tone: "notConnected", label: copy.state.notConnected, tip: copy.tip.notConnected };
  }
}
