import { Button, EngineTag, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { driversCopy } from "../_lib/drivers.copy";
import { actionOf, formatMegabytes, groupDrivers, knownEngines, progressPercent, stateLabel } from "../_lib/drivers.model";
import type { Driver, DriverState } from "../_lib/drivers.schema";

const copy = driversCopy;

/** A bolinha de cada estado, como a do ponto de conexão da árvore: verde o que está pronto, âmbar o que corre, vermelho o que falhou, vazada o resto. */
const dots: Record<DriverState, string> = {
  bundled: "bg-success",
  installed: "bg-success",
  installing: "animate-pulse bg-accent",
  failed: "bg-danger",
  available: "border-[1.5px] border-subtle",
  unavailable: "border-[1.5px] border-subtle",
  comingSoon: "border-[1.5px] border-subtle",
};

const labelColors: Record<DriverState, string> = {
  bundled: "text-body",
  installed: "text-body",
  installing: "text-ink",
  failed: "text-danger",
  available: "text-body",
  unavailable: "text-muted",
  comingSoon: "text-muted",
};

/**
 * O progresso do download de um driver que baixa (RN-DRIVER-004): a barra e quanto já chegou. O total pode não ter chegado ainda: sem ele a
 * barra não inventa uma porcentagem. A linha da lista e o aviso do formulário de conexão usam esta mesma.
 */
export function DriverProgress({ driver, className }: { driver: Driver; className?: string }) {
  const percent = progressPercent(driver.progress);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div role="progressbar" aria-label={copy.row.progress(driver.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full bg-accent transition-[width] duration-500", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      {driver.progress === null ? null : <span className="flex-none font-mono text-xs text-muted">{copy.row.progressOf(formatMegabytes(driver.progress.receivedBytes), formatMegabytes(driver.progress.totalBytes))}</span>}
    </div>
  );
}

/** Chamada quando a linha apontada entra na tela: leva-a ao meio da área que rola. Fora do componente, para a identidade não mudar a cada desenho (e não rolar de novo a cada consulta da lista). */
const reveal = (element: HTMLElement | null) => element?.scrollIntoView({ block: "center" });

export type DriverRowHandlers = {
  /** O driver cujo cancelamento está a caminho: o botão dele diz isso e não repete o clique. */
  cancellingId: string | null;
  onInstall: (driver: Driver) => void;
  onCancel: (driver: Driver) => void;
  onRemove: (driver: Driver) => void;
};

/**
 * Uma linha da lista (item B): o nome e o fabricante, os bancos que o driver atende (as etiquetas da
 * tela de conexões), a versão e o tamanho, o estado em palavras e o botão que o estado permite.
 * `bundled`, `unavailable` e `comingSoon` não têm botão. Tudo o que vem da API entra como texto dos filhos
 * do React, nunca como HTML nem como link (RN-SHELL-002). `highlighted` é a linha que o "Instalar driver" de uma conexão sem
 * driver apontou (`?driver=`): fica destacada, `aria-current`, e entra na tela.
 */
export function DriverRow({ driver, highlighted = false, cancellingId, onInstall, onCancel, onRemove }: { driver: Driver; highlighted?: boolean } & DriverRowHandlers) {
  const action = actionOf(driver);
  const cancelling = cancellingId === driver.id;

  return (
    <li
      ref={highlighted ? reveal : undefined}
      aria-current={highlighted ? "true" : undefined}
      className={cn("grid grid-cols-[minmax(140px,1fr)_92px_minmax(88px,124px)_minmax(140px,236px)_minmax(96px,116px)] items-center gap-x-4 gap-y-2 px-4 py-3", highlighted && "bg-selected shadow-[inset_3px_0_0_var(--color-accent)]")}
    >
      <div className="flex min-w-0 flex-col">
        <span className={cn("font-semibold break-words", driver.state === "comingSoon" ? "text-muted" : "text-ink")}>{driver.name}</span>
        <span className="text-sm break-words text-muted">{driver.vendor}</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {knownEngines(driver).map((engine) => (
          <EngineTag key={engine} engine={engine} />
        ))}
      </div>

      <div className="flex flex-col">
        {driver.version === null ? (
          <span aria-hidden className="text-subtle">
            —
          </span>
        ) : (
          <span className="font-mono text-sm break-all text-body">{driver.version}</span>
        )}
        {driver.sizeBytes === null ? null : <span className="text-xs text-muted">{formatMegabytes(driver.sizeBytes)}</span>}
      </div>

      <div className="flex flex-col items-start gap-1">
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 flex-none rounded-full", dots[driver.state])} />
          <span className={labelColors[driver.state]}>{stateLabel(driver)}</span>
        </span>
        {driver.platformNote === null ? null : <span className="text-xs text-muted">{driver.platformNote}</span>}
        {driver.restartRequired ? <StatusBadge tone="warning">{copy.row.restartPending}</StatusBadge> : null}
      </div>

      <div className="flex justify-end">
        {action === "install" || action === "retry" ? (
          <Button type="button" variant="secondary" size="compact" aria-label={action === "install" ? copy.row.installLabel(driver.name) : copy.row.retryLabel(driver.name)} onClick={() => onInstall(driver)}>
            {action === "install" ? copy.row.install : copy.row.retry}
          </Button>
        ) : action === "cancel" ? (
          <Button type="button" variant="secondary" size="compact" aria-label={copy.row.cancelLabel(driver.name)} disabled={cancelling} onClick={() => onCancel(driver)}>
            {cancelling ? copy.row.cancelling : copy.row.cancel}
          </Button>
        ) : action === "remove" ? (
          <Button type="button" variant="secondary" size="compact" aria-label={copy.row.removeLabel(driver.name)} onClick={() => onRemove(driver)}>
            {copy.row.remove}
          </Button>
        ) : null}
      </div>

      {driver.state === "installing" ? <DriverProgress driver={driver} className="col-span-full" /> : null}

      {driver.state === "failed" ? (
        <p className="col-span-full text-xs break-words text-danger">
          {copy.row.failedBecause} {driver.error?.detail ?? copy.row.failedWithoutDetail}
        </p>
      ) : null}
    </li>
  );
}

/** A lista inteira (item B): quatro grupos, nesta ordem, e o que não tem driver não ganha título. */
export function DriverSections({ drivers, highlightedId = null, ...handlers }: { drivers: readonly Driver[]; highlightedId?: string | null } & DriverRowHandlers) {
  return (
    <div className="flex flex-col gap-8">
      {groupDrivers(drivers).map((group) => (
        <section key={group.key} aria-labelledby={`drivers-group-${group.key}`} className="flex flex-col gap-2">
          {/* h3: a lista mora no cartão "Drivers" de Configurações, cujo título é o h2 (RN-NAV-006). */}
          <h3 id={`drivers-group-${group.key}`} className="px-1 text-sm font-semibold text-muted">
            {copy.groups[group.key]}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-panel">
            {group.drivers.map((driver) => (
              <DriverRow key={driver.id} driver={driver} highlighted={driver.id === highlightedId} {...handlers} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
