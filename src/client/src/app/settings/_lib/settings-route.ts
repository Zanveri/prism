import { generatePath, type To } from "react-router";

import { pathsConfig } from "@/config/paths.config";

import { settingsSections, type SettingsSection, type SettingsSectionId } from "./sections";

/** O driver cuja linha Configurações › Drivers destaca ao chegar (`?driver=<id>`, o `driverID` do 422 `DRIVER_NOT_INSTALLED`). */
export const driverParam = "driver";

/**
 * A página de uma seção das Configurações (a primeira, sem seção) e, nos drivers, apontando a linha de um driver (RN-NAV-006). É o destino
 * do endereço dos drivers (`pathsConfig.drivers`, que redireciona para cá), da navegação entre as seções e de quem precisa abrir uma pelo nome.
 */
export function settingsTo(section: SettingsSectionId = settingsSections[0].id, driverID?: string | null): To {
  return { pathname: generatePath(pathsConfig.settingsSection, { section }), search: driverID ? `?${new URLSearchParams({ [driverParam]: driverID })}` : "" };
}

/** A seção do endereço (`/settings/<seção>`), ou `undefined` se ela não existe. */
export const sectionOf = (param: string | undefined): SettingsSection | undefined => settingsSections.find((section) => section.id === param);

/** O endereço é das Configurações, em qualquer seção. */
export const isSettingsPath = (pathname: string) => pathname === pathsConfig.settings || pathname.startsWith(`${pathsConfig.settings}/`);

/** O driver que a tela destaca ao chegar; vazio não aponta nada. */
export const driverOf = (params: URLSearchParams): string | null => params.get(driverParam) || null;

/**
 * Os parâmetros sem o do driver, depois de lido, ou `null` se não há o que limpar: remontar a tela (o bloqueio por inatividade remonta as telas
 * de dentro do cofre) não destaca de novo. O objeto recebido não muda.
 */
export function withoutArrival(params: URLSearchParams): URLSearchParams | null {
  if (!params.has(driverParam)) return null;

  const rest = new URLSearchParams(params);
  rest.delete(driverParam);
  return rest;
}
