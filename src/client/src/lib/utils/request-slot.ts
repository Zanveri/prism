/**
 * Um pedido que viaja entre duas partes da tela que não se conhecem: quem pede (`request`) e quem atende (`take`, depois de agir). Um pedido só, o último; o
 * número (`seq`) diz se é o mesmo pedido ou um novo, e o objeto devolvido é o MESMO enquanto nada muda (é o que o React compara em `useSyncExternalStore`).
 * É o desenho de `connectionReveal` e de `credentialsRequests`, sem o tipo preso a um pedido.
 */
export type RequestSlot<T> = {
  request: (value: T) => void;
  pending: () => { readonly value: T; readonly seq: number } | null;
  /** O pedido foi atendido: sai, se ainda é o mesmo (um pedido novo, feito no meio, fica). */
  take: (seq: number) => void;
  /** Esquece o pedido (quem atende desmonta: o cofre fechou, e nada passa ao usuário seguinte). */
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createRequestSlot<T>(): RequestSlot<T> {
  let pending: { readonly value: T; readonly seq: number } | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();

  function set(next: typeof pending) {
    if (next === pending) return;
    pending = next;
    for (const listener of listeners) listener();
  }

  return {
    request: (value) => set({ value, seq: ++seq }),
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
