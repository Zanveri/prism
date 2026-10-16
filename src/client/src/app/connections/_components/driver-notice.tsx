import type { ReactNode } from "react";

import type { DriverActions } from "@/app/drivers/_components/driver-actions";
import { DriverProgress } from "@/app/drivers/_components/driver-sections";
import { RestartBanner } from "@/app/drivers/_components/restart-banner";
import { driversCopy } from "@/app/drivers/_lib/drivers.copy";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { connectionsCopy } from "../_lib/connections.copy";
import type { EngineChoice } from "../_lib/engine-choices";

const copy = connectionsCopy.form.driver;

/** O que o aviso pede ao fluxo dos drivers (`useDriverActions`): o mesmo de Configurações › Drivers. */
export type DriverNoticeActions = Pick<DriverActions, "install" | "cancel" | "restart" | "cancellingId" | "exportsNote">;

/** A caixa do aviso: o tom diz se é o que falta (âmbar) ou o que falhou (vermelho). Não é região viva: o progresso mudaria a cada segundo. */
function Box({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "error"; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm text-ink", tone === "warning" ? "border-accent/40 bg-accent/10" : tone === "error" ? "border-danger/40 bg-danger/10" : "border-border bg-panel")}>{children}</div>
  );
}

/**
 * O driver do banco escolhido, ali mesmo no formulário (RN-NAV-005): o que falta, com "Instalar driver" (o MESMO diálogo de Configurações ›
 * Drivers, com o aceite da licença, RN-DRIVER-003), o progresso com "Cancelar" (RN-DRIVER-004), a falha com a causa e "Tentar de novo", e o
 * reinício que ficou pendente (RN-DRIVER-005). Embutido e instalado não pedem nada. A conexão pode ser salva sem o driver: o aviso diz isso.
 * Sem a lista de drivers o formulário não sabe, e não inventa.
 */
export function DriverNotice({ choice, actions }: { choice: EngineChoice; actions: DriverNoticeActions }) {
  const { driver } = choice;
  if (driver === null) return null;

  const cancelling = actions.cancellingId === driver.id;
  const restart = choice.restartPending ? <RestartBanner onRestart={actions.restart} exportsNote={actions.exportsNote} /> : null;

  switch (choice.state) {
    case "missing":
      return (
        <div className="flex flex-col gap-3">
          <Box tone="warning">
            <p>{copy.missing(driver.name)}</p>
            <p className="text-muted">{copy.missingHint}</p>
            <Button type="button" variant="secondary" size="compact" onClick={() => actions.install(driver)}>
              {driversCopy.installDriver}
            </Button>
          </Box>
          {restart}
        </div>
      );

    case "installing":
      return (
        <Box>
          <p>{copy.installing(driver.name)}</p>
          <DriverProgress driver={driver} className="self-stretch" />
          <Button type="button" variant="secondary" size="compact" disabled={cancelling} onClick={() => actions.cancel(driver)}>
            {cancelling ? driversCopy.row.cancelling : driversCopy.row.cancel}
          </Button>
        </Box>
      );

    case "failed":
      return (
        <div className="flex flex-col gap-3">
          <Box tone="error">
            <p>{copy.failed(driver.name)}</p>
            <p className="break-words text-muted">
              {driversCopy.row.failedBecause} {driver.error?.detail ?? driversCopy.row.failedWithoutDetail}
            </p>
            <Button type="button" variant="secondary" size="compact" onClick={() => actions.install(driver)}>
              {driversCopy.row.retry}
            </Button>
          </Box>
          {restart}
        </div>
      );

    case "unavailable":
      return (
        <Box>
          <p>{copy.unavailable}</p>
          <p className="text-muted">{choice.reason}</p>
        </Box>
      );

    default:
      return restart;
  }
}
