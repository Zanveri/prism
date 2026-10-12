import type { QueryClient } from "@tanstack/react-query";

import type { useToast } from "@/components/ui/toast";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError } from "@/lib/api/prism-api";

import { driversCopy } from "./drivers.copy";
import { keepPollingAfterInstall } from "./drivers.polling";
import type { Driver } from "./drivers.schema";
import { driversKey, installDriver } from "./drivers.service";

/**
 * As recusas da seção 16 que o diálogo mostra no lugar, com a mensagem da API. As demais (5xx, API fora do ar) vão ao aviso
 * central. `DRIVER_NOT_FOUND` entra: o driver pode ter sumido do catálogo entre a lista e o clique.
 */
const refusals = ["DRIVER_LICENSE_NOT_ACCEPTED", "DRIVER_UNAVAILABLE", "DRIVER_ALREADY_INSTALLED", "DRIVER_INSTALL_IN_PROGRESS", "DRIVER_NOT_FOUND"];

export type InstallFlowState = {
  /** A caixa "Li e aceito a licença do fabricante". */
  accepted: boolean;
  /** O pedido está a caminho. */
  pending: boolean;
  /** A mensagem da recusa da API; enquanto houver uma, nada mais é enviado por este diálogo. */
  refusal: string | null;
};

export type InstallFlow = {
  subscribe: (listener: () => void) => () => void;
  getState: () => InstallFlowState;
  setAccepted: (accepted: boolean) => void;
  confirm: () => Promise<void>;
  copyLink: () => Promise<void>;
};

type InstallFlowOptions = {
  driver: Driver;
  queryClient: QueryClient;
  toast: ReturnType<typeof useToast>;
  /** O pedido foi aceito (202): o diálogo se fecha. */
  onClose: () => void;
};

/**
 * Pode enviar? O aceite marcado, a licença que se pode ler, nada em andamento e nenhuma recusa pendente. É **esta** regra que
 * guarda o aceite legal (RN-DRIVER-001 e 003): o atributo `disabled` do botão é só o desenho dela, e o corpo do pedido leva o
 * aceite de verdade, e não um `true` fixo.
 *
 * Depois de uma recusa (409: já instalado, já em andamento; 404; 422) a tela por trás foi atualizada e o que este diálogo sabe é
 * velho: ele não envia de novo, e a pessoa o fecha e abre outra vez com a lista nova.
 */
function canInstall(state: InstallFlowState, driver: Driver): boolean {
  return state.accepted && driver.license !== null && !state.pending && state.refusal === null;
}

/**
 * O diálogo de instalação (item C), como um objeto fora do React, no mesmo padrão do `QueryRunner` da área de trabalho: o
 * componente só o observa (`useSyncExternalStore`), e o teste o exercita sem DOM. O pedido passa pelo cache de mutações, para
 * a falha que o diálogo não trata chegar ao aviso central (RN-AVISO-004).
 *
 * Aceito o pedido (202), a consulta da lista fica ligada por uns 10 s mesmo que a lista ainda traga o driver como `available`
 * (`keepPollingAfterInstall`): a especificação garante que ela já traz `installing`, e a tela não depende só disso.
 */
export function createInstallFlow({ driver, queryClient, toast, onClose }: InstallFlowOptions): InstallFlow {
  let state: InstallFlowState = { accepted: false, pending: false, refusal: null };
  const listeners = new Set<() => void>();

  function set(next: InstallFlowState) {
    state = next;
    for (const listener of listeners) listener();
  }

  /** A lista pode estar velha (já instalado, já baixando) ou ter mudado com o pedido: busca de novo em qualquer caso. */
  const refresh = () => queryClient.invalidateQueries({ queryKey: driversKey });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,

    setAccepted(accepted) {
      if (!state.pending) set({ ...state, accepted });
    },

    async confirm() {
      if (!canInstall(state, driver)) return;

      const { accepted } = state;
      set({ ...state, pending: true });

      try {
        const result = await throughMutationCache(queryClient, async () => allowRefusal(await installDriver(driver.id, accepted), ...refusals));

        if (!result.ok) {
          set({ ...state, pending: false, refusal: result.error.detail ?? result.error.title });
          await refresh();
          return;
        }

        keepPollingAfterInstall();
        toast.success(driversCopy.toasts.installStarted(driver.name));
        await refresh();
        onClose();
      } catch (error) {
        // O aviso central já disse o que houve: o pedido não foi aceito, e dá para tentar de novo.
        if (!(error instanceof ApiRequestError)) throw error;
        set({ ...state, pending: false });
        void refresh();
      }
    },

    async copyLink() {
      const { license } = driver;
      if (license === null) return;

      try {
        await navigator.clipboard.writeText(license.url);
        toast.success(driversCopy.toasts.linkCopied);
      } catch {
        toast.warning(driversCopy.toasts.linkNotCopied);
      }
    },
  };
}
