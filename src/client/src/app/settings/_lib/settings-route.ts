import type { To } from "react-router";

import { pathsConfig } from "@/config/paths.config";

import { settingsSections, type SettingsSectionId } from "./sections";

/** A seção que a tela mostra ao chegar (`?section=drivers`). */
export const sectionParam = "section";

/** O driver cuja linha Configurações › Drivers destaca ao chegar (`?driver=<id>`, o `driverID` do 422 `DRIVER_NOT_INSTALLED`). */
export const driverParam = "driver";

/**
 * Configurações já numa seção e, nos drivers, apontando a linha de um driver (RN-NAV-006). É o destino do endereço dos drivers
 * (`pathsConfig.drivers`, que redireciona para cá) e de quem precisa abrir uma seção pelo nome.
 */
export function settingsTo(section?: SettingsSectionId, driverID?: string | null): To {
  const params = new URLSearchParams();
  if (section !== undefined) params.set(sectionParam, section);
  if (driverID) params.set(driverParam, driverID);

  const search = params.toString();
  return { pathname: pathsConfig.settings, search: search === "" ? "" : `?${search}` };
}

/**
 * O que a tela faz ao chegar: rolar até a seção pedida (só se ela existe) e destacar a linha do driver. Um driver apontado é dos
 * drivers, mesmo sem a seção escrita.
 */
export function arrivalOf(params: URLSearchParams): { section: SettingsSectionId | null; driver: string | null } {
  const driver = params.get(driverParam) || null;
  const requested = settingsSections.find((section) => section.id === params.get(sectionParam))?.id ?? null;

  return { section: requested ?? (driver === null ? null : "drivers"), driver };
}

/**
 * Os parâmetros sem os dois da chegada, depois de lidos, ou `null` se não há o que limpar. Saem juntos, numa troca só: dois
 * `setSearchParams` seguidos partiriam da mesma busca, e o segundo devolveria o que o primeiro tirou. O objeto recebido não muda.
 */
export function withoutArrival(params: URLSearchParams): URLSearchParams | null {
  if (!params.has(sectionParam) && !params.has(driverParam)) return null;

  const rest = new URLSearchParams(params);
  rest.delete(sectionParam);
  rest.delete(driverParam);
  return rest;
}
