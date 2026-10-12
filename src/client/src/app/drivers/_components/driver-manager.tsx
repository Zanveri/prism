import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button, FormMessage } from "@/components/ui";

import { driversCopy } from "../_lib/drivers.copy";
import { isPollingSuspended, resumePolling, subscribePolling } from "../_lib/drivers.polling";
import { driversQuery } from "../_lib/drivers.service";
import { useDriverActions } from "./driver-actions";
import { DriverSections } from "./driver-sections";
import { RestartBanner } from "./restart-banner";

const copy = driversCopy;

/**
 * A lista de drivers com tudo o que a tela de Drivers tinha (RN-NAV-006, seção 16): os grupos, o estado de cada driver, instalar,
 * cancelar, remover, o erro com a causa, o lembrete e o diálogo de reinício, a lista que parou de atualizar e a linha destacada. Mora em
 * Configurações › Drivers; o título e a explicação são do cartão de lá.
 *
 * A lista é a de `GET api/user/drivers`, consultada de novo a cada segundo enquanto algum driver baixa. Só quem mostra a lista a busca (aqui
 * e o formulário de conexão); a barra superior só lê o cache para o lembrete. `highlightedId` é a linha que o "Instalar driver" de uma
 * conexão sem driver apontou: fica destacada e entra na tela.
 */
export function DriverManager({ highlightedId }: { highlightedId: string | null }) {
  const drivers = useQuery(driversQuery);
  const actions = useDriverActions();
  // A tela é avisada quando a consulta periódica para (o terceiro erro não muda nada do que o TanStack entrega, e sem a assinatura ela não
  // seria desenhada de novo).
  const pollingSuspended = useSyncExternalStore(subscribePolling, isPollingSuspended, isPollingSuspended);

  const list = drivers.data;
  const restartPending = list?.some((driver) => driver.restartRequired) ?? false;
  /** Atualizar a lista a pedido: a contagem de erros recomeça, e a consulta periódica volta se houver o que acompanhar. */
  const reload = () => {
    resumePolling();
    void drivers.refetch();
  };

  return (
    <div className="flex flex-col gap-6">
      {restartPending ? <RestartBanner onRestart={actions.restart} /> : null}

      {list !== undefined && drivers.isError && pollingSuspended ? (
        <FormMessage tone="error" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="mr-auto">{copy.stalled.message}</span>
          <Button type="button" variant="secondary" size="compact" onClick={reload}>
            {copy.stalled.action}
          </Button>
        </FormMessage>
      ) : null}

      {list === undefined ? (
        drivers.isError ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage tone="error">{copy.loadFailed}</FormMessage>
            <Button type="button" variant="secondary" size="sm" onClick={reload}>
              {copy.retry}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-muted">
            {copy.loading}
          </p>
        )
      ) : list.length === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-ink">{copy.empty.title}</p>
          <p className="text-muted">{copy.empty.hint}</p>
        </div>
      ) : (
        <DriverSections drivers={list} highlightedId={highlightedId} cancellingId={actions.cancellingId} onInstall={actions.install} onCancel={actions.cancel} onRemove={actions.remove} />
      )}

      {actions.dialogs}
    </div>
  );
}
