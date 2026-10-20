import { MutationObserver, type QueryClient } from "@tanstack/react-query";

/**
 * Roda uma chamada pelo cache de mutações, como qualquer `mutationFn`: o que ela lançar chega ao
 * aviso central (RN-AVISO-004). O observador é solto no fim. Preso, ele seguraria a mutação no
 * cache, com as linhas da resposta e o SQL, até o cofre fechar: numa aba usada o dia inteiro a
 * memória só cresceria, e os dados de abas já fechadas continuariam lá. `silent`: a falha não vira aviso (`meta: { silent: true }`), para a pergunta
 * que a tela faz sem que a pessoa a tenha pedido.
 */
export async function throughMutationCache<T>(queryClient: QueryClient, mutationFn: () => Promise<T>, silent = false): Promise<T> {
  // A API é local: sem rede no computador, a chamada sai do mesmo jeito (`networkMode`).
  const observer = new MutationObserver(queryClient, { gcTime: 0, networkMode: "always", mutationFn, ...(silent ? { meta: { silent: true } } : {}) });
  try {
    return await observer.mutate();
  } finally {
    observer.reset();
  }
}
