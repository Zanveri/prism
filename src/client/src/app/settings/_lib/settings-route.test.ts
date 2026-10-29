import { describe, expect, it } from "vitest";

import { driverOf, isSettingsPath, sectionOf, settingsTo, withoutArrival } from "./settings-route";

const search = (to: ReturnType<typeof settingsTo>) => new URLSearchParams(typeof to === "string" ? "" : (to.search ?? ""));

describe("settingsTo: a página de uma seção das Configurações (RN-NAV-006)", () => {
  it("sem nada, é a página da primeira seção", () => {
    expect(settingsTo()).toEqual({ pathname: "/settings/account", search: "" });
  });

  it("numa seção: o endereço é o da página dela", () => {
    expect(settingsTo("drivers")).toEqual({ pathname: "/settings/drivers", search: "" });
  });

  it("os drivers apontando a linha de um driver (o `driverID` do 422 DRIVER_NOT_INSTALLED), com o valor codificado e de volta igual", () => {
    const hostile = "ibm&section=account x#y";
    const to = settingsTo("drivers", hostile);

    expect(typeof to === "string" ? to : to.pathname).toBe("/settings/drivers");
    expect(search(to).get("driver")).toBe(hostile);
    expect([...search(to).keys()]).toEqual(["driver"]);
  });

  it("um driver vazio ou nulo não entra", () => {
    expect(settingsTo("drivers", "")).toEqual({ pathname: "/settings/drivers", search: "" });
    expect(settingsTo("drivers", null)).toEqual({ pathname: "/settings/drivers", search: "" });
  });
});

describe("sectionOf: a seção do endereço", () => {
  it("a que existe; outra coisa, ou nada, não é seção", () => {
    expect(sectionOf("drivers")?.anchor).toBe("cfg-drivers");
    expect(sectionOf("nada")).toBeUndefined();
    expect(sectionOf(undefined)).toBeUndefined();
  });
});

describe("isSettingsPath: o endereço é das Configurações, em qualquer seção", () => {
  it("a tela e as páginas dela, e só elas", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings/editor")).toBe(true);
    expect(isSettingsPath("/workbench")).toBe(false);
    expect(isSettingsPath("/settingsx")).toBe(false);
  });
});

describe("driverOf: o driver que a tela destaca ao chegar", () => {
  it("o apontado; vazio não aponta nada", () => {
    expect(driverOf(new URLSearchParams("driver=ibm-data-server"))).toBe("ibm-data-server");
    expect(driverOf(new URLSearchParams("driver="))).toBeNull();
    expect(driverOf(new URLSearchParams(""))).toBeNull();
  });
});

describe("withoutArrival: depois de lido, o driver sai da URL (o bloqueio remonta a tela, e ela não pode destacar de novo)", () => {
  it("tira o driver, deixa o resto e não altera o objeto recebido", () => {
    const params = new URLSearchParams("driver=ibm&outro=1");

    expect(withoutArrival(params)?.toString()).toBe("outro=1");
    expect(params.toString()).toBe("driver=ibm&outro=1");
  });

  it("sem o driver, não há o que limpar", () => {
    expect(withoutArrival(new URLSearchParams("outro=1"))).toBeNull();
  });
});
