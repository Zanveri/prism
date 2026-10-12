import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useApiRestart } from "@/app/_components/api-gate";
import { ConfirmDialog, useToast } from "@/components/ui";
import { allowRefusal, unwrap } from "@/lib/api/prism-api";

import { driversCopy } from "../_lib/drivers.copy";
import { resumePolling } from "../_lib/drivers.polling";
import type { Driver } from "../_lib/drivers.schema";
import { cancelDriverInstall, driversKey, removeDriver } from "../_lib/drivers.service";
import { watchDriverTransitions } from "../_lib/drivers.watch";
import { InstallDriverDialog } from "./install-driver-dialog";
import { RestartDialog } from "./restart-dialog";

const copy = driversCopy;

export type DriverActions = {
  /** Abre o diálogo de instalação (o aceite da licença, RN-DRIVER-003). */
  install: (driver: Driver) => void;
  /** Cancela a instalação em andamento (RN-DRIVER-004). */
  cancel: (driver: Driver) => void;
  /** Pergunta antes de remover (RN-DRIVER-007). */
  remove: (driver: Driver) => void;
  /** O reinício do `ApiGate`, o mesmo do "Reiniciar" da tela de erro (RN-DRIVER-005). */
  restart: () => void;
  /** O driver cujo cancelamento está a caminho: o botão dele diz isso e não repete o clique. */
  cancellingId: string | null;
  /** Os diálogos das ações (instalar, confirmar a remoção, reiniciar): quem usa o gancho os põe na tela. */
  dialogs: ReactNode;
};

/**
 * Tudo o que a tela de Drivers fazia com um driver, num lugar só, para Configurações › Drivers (RN-NAV-006) e para o formulário de conexão
 * (RN-NAV-005) usarem o MESMO fluxo: o diálogo de instalação, o cancelamento, a remoção com a recusa de "em uso" e o reinício. Quem fala com a
 * API em cada ação é o componente da ação (o diálogo de instalação, `createInstallFlow`) ou a mutação daqui.
 *
 * O que a lista de drivers deixa para trás é acontecimento, e não estado (`watchDriverTransitions`): o fim de uma instalação, ou uma remoção,
 * que pede reinício abre o diálogo de reinício uma vez, e a falha de um download dá o aviso uma vez. Montar o gancho também recomeça a contagem
 * de erros da consulta periódica (`resumePolling`), como abrir a tela de Drivers fazia.
 */
export function useDriverActions(): DriverActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const restartApi = useApiRestart();

  const [installTarget, setInstallTarget] = useState<Driver | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Driver | null>(null);
  const [restartKind, setRestartKind] = useState<"installed" | "removed" | null>(null);

  useEffect(() => resumePolling(), []);

  useEffect(
    () =>
      watchDriverTransitions(queryClient, {
        onRestartRequired: () => setRestartKind((current) => current ?? "installed"),
        onInstallFailed: (driver) => toast.error(copy.toasts.installFailed(driver.name), driver.error?.detail ?? undefined),
      }),
    [queryClient, toast],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: driversKey });

  const cancel = useMutation({
    mutationFn: async (driver: Driver) => unwrap(await cancelDriverInstall(driver.id)),
    onSuccess: (_data, driver) => toast.success(copy.toasts.cancelled(driver.name)),
    // Com ou sem recusa (`DRIVER_NOT_INSTALLING`: a instalação acabou antes do clique), a lista diz como as coisas estão.
    onSettled: refresh,
  });

  const remove = useMutation({
    // RN-DRIVER-007: com sessão aberta de um banco do driver, a API recusa (409). A frase é da tela, no aviso de erro.
    mutationFn: async (driver: Driver) => allowRefusal(await removeDriver(driver.id), "DRIVER_IN_USE"),
    onSuccess: async (result, driver) => {
      setRemoveTarget(null);

      if (result.ok) {
        toast.success(copy.toasts.removed(driver.name));
        setRestartKind("removed");
      } else {
        toast.error(copy.toasts.inUse);
      }

      await refresh();
    },
    onError: () => {
      setRemoveTarget(null);
      void refresh();
    },
  });

  const restart = () => void restartApi();

  const dialogs = (
    <>
      {installTarget === null ? null : <InstallDriverDialog driver={installTarget} onClose={() => setInstallTarget(null)} />}

      <ConfirmDialog
        open={removeTarget !== null}
        tone="danger"
        title={copy.removeConfirm.title}
        description={removeTarget === null ? undefined : copy.removeConfirm.description(removeTarget.name)}
        confirmLabel={copy.removeConfirm.submit}
        pendingLabel={copy.removeConfirm.submitting}
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />

      {restartKind === null ? null : <RestartDialog kind={restartKind} onRestart={restart} onLater={() => setRestartKind(null)} />}
    </>
  );

  return {
    install: setInstallTarget,
    cancel: (driver) => cancel.mutate(driver),
    remove: setRemoveTarget,
    restart,
    cancellingId: cancel.isPending ? cancel.variables.id : null,
    dialogs,
  };
}
