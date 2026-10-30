import type { Engine } from "@/components/ui/engine-tag";

import { driversCopy } from "./drivers.copy";
import type { Driver, DriverState } from "./drivers.schema";

const copy = driversCopy;

/** O código do 422 de sessão, de teste de conexão e de execução quando o driver do banco não está instalado (RN-DRIVER-006). */
export const driverNotInstalledCode = "DRIVER_NOT_INSTALLED";

export type DriverGroupKey = "installed" | "available" | "unavailable" | "comingSoon";

/** A ordem da tela (item B): o que se usa, o que se pode baixar, o que a plataforma não atende e o que ainda vem. */
const groups: readonly { key: DriverGroupKey; states: readonly DriverState[] }[] = [
  { key: "installed", states: ["bundled", "installed"] },
  { key: "available", states: ["available", "installing", "failed"] },
  { key: "unavailable", states: ["unavailable"] },
  { key: "comingSoon", states: ["comingSoon"] },
];

/** Os grupos que têm driver, na ordem da tela; dentro de cada um vale a ordem do catálogo. */
export function groupDrivers(drivers: readonly Driver[]): { key: DriverGroupKey; drivers: Driver[] }[] {
  return groups.map(({ key, states }) => ({ key, drivers: drivers.filter((driver) => states.includes(driver.state)) })).filter((group) => group.drivers.length > 0);
}

/** A porcentagem do download, de 0 a 100; sem progresso (o primeiro byte ainda não chegou) não há como saber. */
export function progressPercent(progress: Driver["progress"]): number | null {
  if (progress === null) return null;
  return Math.min(100, Math.floor((progress.receivedBytes * 100) / progress.totalBytes));
}

export function stateLabel(driver: Driver): string {
  if (driver.state !== "installing") return copy.states[driver.state];

  const percent = progressPercent(driver.progress);
  return percent === null ? copy.states.installing : copy.states.installingPercent(percent);
}

/** `110 MB`, `5,2 MB`: 1 MB são 1.048.576 bytes, a conta do Windows e do DBeaver; uma casa só abaixo de 10 MB. */
export function formatMegabytes(bytes: number): string {
  if (bytes === 0) return "0 MB";

  const megabytes = bytes / 1048576;
  if (megabytes < 1) return "< 1 MB";
  return `${megabytes.toLocaleString("pt-BR", { maximumFractionDigits: megabytes < 10 ? 1 : 0 })} MB`;
}

export type DriverAction = "install" | "retry" | "cancel" | "remove";

/**
 * O botão de uma linha. `bundled` (nunca se remove o que vem no pacote), `unavailable` e `comingSoon`
 * não têm: não há o que a pessoa possa fazer com eles.
 */
export function actionOf(driver: Driver): DriverAction | null {
  switch (driver.state) {
    case "available":
      return "install";
    case "failed":
      return "retry";
    case "installing":
      return "cancel";
    case "installed":
      return "remove";
    default:
      return null;
  }
}

const isEngine = (value: number): value is Engine => Number.isInteger(value) && value >= 1 && value <= 13;

/** Os bancos do driver que a tela sabe desenhar (as etiquetas PG, DB2 e IFX), em ordem e sem repetir. */
export function knownEngines(driver: Driver): Engine[] {
  return [...new Set(driver.engines)].filter(isEngine).sort((a, b) => a - b);
}

export const hasInstalling = (drivers: readonly Driver[] | undefined): boolean => drivers?.some((driver) => driver.state === "installing") ?? false;

/**
 * O driver que falta, no 422 `DRIVER_NOT_INSTALLED` (seção 16: o erro traz `driverID` como extensão). A tela de Drivers usa
 * para apontar a linha dele quando o "Instalar driver" leva até lá. Sem a extensão, o link leva à tela sem apontar nada.
 */
export function driverIdOf(extensions: Readonly<Record<string, unknown>>): string | undefined {
  const { driverID } = extensions;
  return typeof driverID === "string" && driverID !== "" ? driverID : undefined;
}

/**
 * O reinício passou a ser necessário entre as duas listas: um `restartRequired` que era falso e agora é
 * verdadeiro. Cobre a instalação que acabou e a remoção (RN-DRIVER-005 e 007), sem depender do `state`
 * que a API dá a um driver removido que espera o reinício. Sem lista anterior não há o que comparar.
 */
export function restartBecamePending(before: readonly Driver[] | undefined, after: readonly Driver[]): boolean {
  if (before === undefined) return false;
  return after.some((driver) => driver.restartRequired && before.find((previous) => previous.id === driver.id)?.restartRequired === false);
}

/** Os drivers que estavam baixando na lista anterior e agora falharam. */
export function failedInstalls(before: readonly Driver[] | undefined, after: readonly Driver[]): Driver[] {
  if (before === undefined) return [];
  return after.filter((driver) => driver.state === "failed" && before.find((previous) => previous.id === driver.id)?.state === "installing");
}
