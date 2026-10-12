import { describe, expect, it } from "vitest";

import { arrivalOf, settingsTo, withoutArrival } from "./settings-route";

const search = (to: ReturnType<typeof settingsTo>) => new URLSearchParams(typeof to === "string" ? "" : (to.search ?? ""));

describe("settingsTo: Configurações já numa seção (RN-NAV-006)", () => {
  it("sem nada, é a tela como sempre", () => {
    expect(settingsTo()).toEqual({ pathname: "/settings", search: "" });
  });

  it("numa seção: o parâmetro diz qual", () => {
    expect(settingsTo("drivers")).toEqual({ pathname: "/settings", search: "?section=drivers" });
  });

  it("os drivers apontando a linha de um driver (o `driverID` do 422 DRIVER_NOT_INSTALLED), com o valor codificado e de volta igual", () => {
    const hostile = "ibm&section=account x#y";

    expect(search(settingsTo("drivers", hostile)).get("driver")).toBe(hostile);
    expect(search(settingsTo("drivers", hostile)).getAll("section")).toEqual(["drivers"]);
  });

  it("um driver vazio ou nulo não entra", () => {
    expect(settingsTo("drivers", "")).toEqual({ pathname: "/settings", search: "?section=drivers" });
    expect(settingsTo("drivers", null)).toEqual({ pathname: "/settings", search: "?section=drivers" });
  });
});

describe("arrivalOf: o que a tela faz ao chegar", () => {
  it("a seção pedida, se existe; outra coisa é ignorada", () => {
    expect(arrivalOf(new URLSearchParams("section=drivers"))).toEqual({ section: "drivers", driver: null });
    expect(arrivalOf(new URLSearchParams("section=nada"))).toEqual({ section: null, driver: null });
    expect(arrivalOf(new URLSearchParams(""))).toEqual({ section: null, driver: null });
  });

  it("um driver apontado leva aos drivers, mesmo sem a seção escrita", () => {
    expect(arrivalOf(new URLSearchParams("driver=ibm-data-server"))).toEqual({ section: "drivers", driver: "ibm-data-server" });
    expect(arrivalOf(new URLSearchParams("section=drivers&driver=ibm-data-server"))).toEqual({ section: "drivers", driver: "ibm-data-server" });
  });

  it("um driver vazio não aponta nada", () => {
    expect(arrivalOf(new URLSearchParams("section=drivers&driver="))).toEqual({ section: "drivers", driver: null });
  });
});

describe("withoutArrival: depois de lidos, os dois parâmetros saem da URL de uma vez (o bloqueio remonta a tela, e ela não pode chegar de novo)", () => {
  it("tira a seção e o driver, deixa o resto e não altera o objeto recebido", () => {
    const params = new URLSearchParams("section=drivers&driver=ibm&outro=1");

    expect(withoutArrival(params)?.toString()).toBe("outro=1");
    expect(params.toString()).toBe("section=drivers&driver=ibm&outro=1");
  });

  it("sem nenhum dos dois, não há o que limpar", () => {
    expect(withoutArrival(new URLSearchParams("outro=1"))).toBeNull();
  });
});
