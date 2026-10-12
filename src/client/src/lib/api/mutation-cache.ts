import { MutationObserver, type QueryClient } from "@tanstack/react-query";

/**
 * Roda uma chamada pelo cache de mutações, como qualquer `mutationFn`: o que ela lançar chega ao
 * aviso central (RN-AVISO-004). O observador é solto no fim. Preso, ele seguraria a mutação no
 * cache, com as linhas da resposta e o SQL, até o cofre fechar: numa aba usada o dia inteiro a
 * memória só cresceria, e os dados de abas já fechadas continuariam lá.
 */
export async function throughMutationCache<T>(queryClient: QueryClient, mutationFn: () => Promise<T>): Promise<T> {
  // A API é local: sem rede no computador, a chamada sai do mesmo jeito (`networkMode`).
  const observer = new MutationObserver(queryClient, { gcTime: 0, networkMode: "always", mutationFn });
  try {
    return await observer.mutate();
  } finally {
    observer.reset();
  }
}
