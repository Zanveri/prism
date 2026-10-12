import type { QueryClient } from "@tanstack/react-query";

import { vaultLock } from "@/lib/api/vault-lock";

/**
 * Quem desconectou uma conexão. "Desconectar" é uma decisão da pessoa (RN-SESSAO-004), e nada na tela a desfaz sozinho: as vistas de
 * uma tabela cuja conexão ela desconectou esperam o clique em "Conectar" ou "Atualizar", em vez de reabrir a sessão por conta própria
 * ao serem mostradas.
 *
 * O sinal é o cache. O "Desconectar" remove a consulta da sessão da árvore (`["database-session", conexão]`, `databaseSessionKey`), e uma
 * sessão aberta de novo a repõe com dado. O bloqueio por inatividade (RN-SEG-001) também a remove (`dropDataAtLock`), mas com o bloqueio
 * já armado (`vaultLock`), e desbloquear restaura tudo: a aba à vista recarrega sozinha. Então remover com o cofre bloqueado não conta.
 * Reabrir a sessão que caiu (`reopenDatabaseSession`) a reinicia, não a remove: também não conta.
 */
export type DisconnectLog = {
  /** Só enquanto alguém assina o cache é observado. */
  subscribe: (listener: () => void) => () => void;
  /** As conexões que a pessoa desconectou e que ainda não voltaram a ter sessão: o mesmo objeto enquanto nada muda. */
  getSnapshot: () => ReadonlySet<string>;
  /** Uma sessão da conexão voltou a existir por outro caminho que o da árvore (a de uma aba): a conexão deixa de estar desconectada. */
  forget: (connectionId: string) => void;
};

/** A família da consulta da sessão da árvore: o primeiro item de `databaseSessionKey`. */
const sessionFamily = "database-session";

export function createDisconnectLog(queryClient: QueryClient): DisconnectLog {
  let disconnected: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();

  function change(connectionId: string, isDisconnected: boolean) {
    if (disconnected.has(connectionId) === isDisconnected) return;

    const next = new Set(disconnected);
    if (isDisconnected) next.add(connectionId);
    else next.delete(connectionId);
    disconnected = next;
    for (const listener of listeners) listener();
  }

  function watchCache() {
    return queryClient.getQueryCache().subscribe((event) => {
      const [family, connectionId] = event.query.queryKey;
      if (family !== sessionFamily || typeof connectionId !== "string") return;

      if (event.type === "removed") {
        if (!vaultLock.isLocked()) change(connectionId, true);
      } else if (event.type === "updated" && event.action.type === "success") {
        change(connectionId, false);
      }
    });
  }

  let stopWatching: (() => void) | null = null;

  return {
    subscribe(listener) {
      listeners.add(listener);
      stopWatching ??= watchCache();

      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;

        stopWatching?.();
        stopWatching = null;
      };
    },
    getSnapshot: () => disconnected,
    forget: (connectionId) => change(connectionId, false),
  };
}

/** Um pedido de mostrar a conexão: o número diz se é o mesmo pedido ou um novo (salvar a mesma conexão duas vezes são dois pedidos). */
export type RevealRequest = { readonly connectionId: string; readonly seq: number };

/**
 * A conexão que o formulário acabou de salvar (RN-NAV-004): salvar volta à área de trabalho com ela à vista na árvore (os ancestrais
 * abertos) e escolhida. O formulário é outra tela, e o navegador fica montado por baixo dela (`WorkbenchSlot`), então o pedido viaja por aqui:
 * o formulário pede (`request`), o navegador vê o pedido quando volta à tela e a lista já tem a conexão, mostra-a e leva o pedido (`take`).
 * Um pedido só, o último: salvar outra conexão antes de voltar troca o pedido.
 */
export type ConnectionReveal = {
  request: (connectionId: string) => void;
  /** O pedido à espera, se há: o MESMO objeto enquanto nada muda (é o que o React compara). */
  pending: () => RevealRequest | null;
  /** O pedido foi atendido: sai, se ainda é o mesmo (um pedido novo, feito no meio, fica). */
  take: (seq: number) => void;
  /** Esquece o pedido (o navegador desmonta: o cofre fechou, e nada passa ao usuário seguinte). */
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createConnectionReveal(): ConnectionReveal {
  let pending: RevealRequest | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();

  function set(next: RevealRequest | null) {
    if (next === pending) return;
    pending = next;
    for (const listener of listeners) listener();
  }

  return {
    request: (connectionId) => set({ connectionId, seq: ++seq }),
    pending: () => pending,
    take: (taken) => {
      if (pending?.seq === taken) set(null);
    },
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** O pedido da tela: o formulário de conexão pede, o navegador atende. */
export const connectionReveal = createConnectionReveal();
