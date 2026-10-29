import { isValidElement } from "react";
import { Navigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A rota é lida por `useSearchParams`: aqui ela é a que cada teste dá, sem roteador montado.
const route = vi.hoisted(() => ({ search: "" }));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useSearchParams: () => [new URLSearchParams(route.search), () => {}] }));

import { DriversRedirect } from "./page";

afterEach(() => {
  route.search = "";
});

/** O destino do `<Navigate>` que o endereço antigo devolve. */
function redirectAt(search: string) {
  route.search = search;
  const element = DriversRedirect();
  if (!isValidElement<{ to: unknown; replace?: boolean }>(element) || element.type !== Navigate) throw new Error("O endereço de Drivers não devolveu um <Navigate>.");
  return element.props;
}

describe("o endereço de Drivers (RN-NAV-006: a tela de Drivers passou a ser Configurações › Drivers)", () => {
  it("leva a Configurações › Drivers, trocando a entrada do histórico (voltar não cai num endereço que só redireciona)", () => {
    expect(redirectAt("")).toEqual({ to: { pathname: "/settings/drivers", search: "" }, replace: true });
  });

  it("o 'Instalar driver' com o `driverID` do 422 continua apontando a linha do driver que falta", () => {
    expect(redirectAt("?driver=ibm-data-server")).toEqual({ to: { pathname: "/settings/drivers", search: "?driver=ibm-data-server" }, replace: true });
  });
});
