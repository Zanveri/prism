import { useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, FormMessage, PackageIcon, useToast } from "@/components/ui";

import { driversCopy } from "../_lib/drivers.copy";
import { formatMegabytes } from "../_lib/drivers.model";
import type { Driver } from "../_lib/drivers.schema";
import { createInstallFlow } from "../_lib/install-driver-flow";

const copy = driversCopy.install;

type InstallDriverDialogViewProps = {
  driver: Driver;
  accepted: boolean;
  pending: boolean;
  /** A mensagem da recusa da API, na tela até o diálogo fechar. */
  refusal: string | null;
  onAcceptedChange: (accepted: boolean) => void;
  onConfirm: () => void;
  onCopyLink: () => void;
  onClose: () => void;
};

/**
 * O que o diálogo mostra (item C): o fabricante, a licença, o endereço do texto oficial dela, o tamanho e o
 * aviso do reinício. **O endereço é só texto**: o app não abre navegador nem navega para fora (RN-SHELL-001),
 * então não há `<a>`, `href`, `window.open` nem ponte nova no preload; a pessoa seleciona o texto ou usa
 * "Copiar link" e lê no navegador dela. O botão só é liberado com o aceite marcado (RN-DRIVER-003), e nunca sem a
 * licença (o catálogo a trouxe, em `https://`): não se aceita o que não se pode ler. Depois de uma recusa ele fica
 * desligado: o que o diálogo sabe é velho.
 *
 * O desenho do botão repete a regra de `createInstallFlow`, que é quem a guarda: se o clique chegar mesmo assim, nada é enviado.
 */
export function InstallDriverDialogView({ driver, accepted, pending, refusal, onAcceptedChange, onConfirm, onCopyLink, onClose }: InstallDriverDialogViewProps) {
  const { license } = driver;
  const canConfirm = accepted && license !== null && !pending && refusal === null;

  return (
    <Dialog
      open
      size="md"
      icon={<PackageIcon />}
      title={copy.title(driver.name)}
      description={copy.description}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canConfirm}>
            {pending ? copy.submitting : copy.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-muted">{copy.vendor}</dt>
          <dd className="break-words text-ink">{driver.vendor}</dd>

          {license === null ? null : (
            <>
              <dt className="text-muted">{copy.license}</dt>
              <dd className="break-words text-ink">{license.name}</dd>

              <dt className="text-muted">{copy.licenseUrl}</dt>
              <dd className="flex min-w-0 flex-col items-start gap-2">
                <span className="rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-sm break-all text-ink select-text">{license.url}</span>
                <span className="text-xs text-muted">{copy.licenseUrlHint}</span>
                <Button type="button" variant="secondary" size="compact" onClick={onCopyLink}>
                  {copy.copyLink}
                </Button>
              </dd>
            </>
          )}

          <dt className="text-muted">{copy.size}</dt>
          <dd className="text-ink">{driver.sizeBytes === null ? "—" : formatMegabytes(driver.sizeBytes)}</dd>
        </dl>

        {license === null ? <FormMessage tone="error">{copy.noLicense}</FormMessage> : null}

        <FormMessage tone="warning">{copy.restartNotice}</FormMessage>

        <label className="flex cursor-pointer items-start gap-2.5 text-ink">
          <input type="checkbox" checked={accepted} onChange={(event) => onAcceptedChange(event.target.checked)} disabled={pending} className="mt-[3px] size-4 flex-none cursor-pointer accent-accent" />
          <span>{copy.accept}</span>
        </label>

        {refusal === null ? null : <FormMessage tone="error">{refusal}</FormMessage>}
      </div>
    </Dialog>
  );
}

/**
 * O pedido de instalação (item C): quem decide o que acontece é `createInstallFlow` (um objeto fora do React, testado); aqui
 * só se observa o estado dele e se liga cada controle. Montado ao abrir e desmontado ao fechar: o aceite e a recusa não
 * sobram para a próxima vez.
 */
export function InstallDriverDialog({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [flow] = useState(() => createInstallFlow({ driver, queryClient, toast, onClose }));
  const state = useSyncExternalStore(flow.subscribe, flow.getState);

  return (
    <InstallDriverDialogView
      driver={driver}
      accepted={state.accepted}
      pending={state.pending}
      refusal={state.refusal}
      onAcceptedChange={flow.setAccepted}
      onConfirm={() => void flow.confirm()}
      onCopyLink={() => void flow.copyLink()}
      onClose={onClose}
    />
  );
}
