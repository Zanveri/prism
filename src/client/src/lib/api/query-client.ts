import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import type { useToast } from "@/components/ui/toast";
import type { ToastTone } from "@/components/ui/toast-queue";

import { ApiRequestError } from "./prism-api";
import { vaultLock } from "./vault-lock";

/** A tela que mostra o erro no próprio lugar, sem aviso, passa `meta: { silent: true }`. */
type ErrorMeta = { silent?: boolean };

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: ErrorMeta;
    mutationMeta: ErrorMeta;
  }
}

export type ToastMessage = { tone: ToastTone; title: string; description?: string };

/** O aviso que uma chamada que falhou merece, ou `null` quando ela não merece nenhum (RN-AVISO-004). */
export function errorToastFor(error: unknown, meta?: ErrorMeta): ToastMessage | null {
  if (meta?.silent) return null;
  if (!(error instanceof ApiRequestError)) return { tone: "error", title: "Erro inesperado." };

  const { code, title, detail, errors } = error.error;

  // Erro de campo aparece no campo, não em aviso.
  if (errors !== null && Object.keys(errors).length > 0) return null;
  // RN-AVISO-003: o cofre fechou e a pessoa pode seguir, entrando de novo.
  if (code === "VAULT_LOCKED") return { tone: "warning", title: "Cofre fechado. Entre de novo." };
  if (code === "NETWORK_ERROR") return { tone: "error", title: "Sem resposta da API." };

  return detail === null ? { tone: "error", title } : { tone: "error", title, description: detail };
}

/**
 * O lugar único onde uma chamada à API que falha vira aviso (RN-AVISO-004): toda `queryFn` e
 * `mutationFn` usa `unwrap`, e o erro lançado passa por aqui. Nenhuma tela chama `toast.error`
 * para dizer que uma chamada falhou.
 */
export function createQueryClient(toast: ReturnType<typeof useToast>): QueryClient {
  function notify(error: unknown, meta: ErrorMeta | undefined) {
    // Prism bloqueado por inatividade (RN-SEG-001): o aviso ficaria por baixo da tela de bloqueio e só apareceria depois do desbloqueio, já velho.
    if (vaultLock.isLocked()) return;

    const message = errorToastFor(error, meta);
    if (message !== null) toast[message.tone](message.title, message.description);
  }

  return new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => notify(error, query.meta) }),
    mutationCache: new MutationCache({ onError: (error, _variables, _onMutateResult, mutation) => notify(error, mutation.meta) }),
    // A API é local: repetir não muda a resposta, só atrasa o aviso em vários segundos. E a rede do computador não tem nada a ver com ela: por
    // padrão a biblioteca PÁRA toda consulta e toda mutação quando o navegador diz "sem rede" (o Wi-Fi caiu, o cabo saiu) e só as retoma
    // quando ela volta, e o Prism ficaria sem responder a nada. `always` ignora o estado da rede.
    defaultOptions: { queries: { retry: false, networkMode: "always" }, mutations: { networkMode: "always" } },
  });
}
