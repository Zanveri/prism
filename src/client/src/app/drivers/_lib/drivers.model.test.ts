import { describe, expect, it } from "vitest";

import type { Driver } from "./drivers.schema";
import { actionOf, driverIdOf, failedInstalls, formatMegabytes, groupDrivers, hasInstalling, knownEngines, progressPercent, restartBecamePending, stateLabel } from "./drivers.model";

/** Um driver disponível; cada teste muda o que importa para ele. */
function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id,
    name: id,
    vendor: "Fabricante",
    engines: [2, 3],
    state: "available",
    version: "1.0.0",
    sizeBytes: 115343360,
    license: { name: "Licença", url: "https://exemplo.local/licenca" },
    platformNote: null,
    progress: null,
    error: null,
    restartRequired: false,
    ...overrides,
  };
}

describe("groupDrivers (item B)", () => {
  it("agrupa na ordem: instalados e embutidos; para baixar; sem driver na plataforma; em breve", () => {
    const list = [
      driver("sqlite", { state: "comingSoon" }),
      driver("ibm-mac", { state: "unavailable" }),
      driver("falhou", { state: "failed" }),
      driver("pg", { state: "bundled" }),
      driver("baixando", { state: "installing" }),
      driver("ibm", { state: "available" }),
      driver("instalado", { state: "installed" }),
    ];

    expect(groupDrivers(list).map(({ key, drivers }) => [key, drivers.map((item) => item.id)])).toEqual([
      ["installed", ["pg", "instalado"]],
      ["available", ["falhou", "baixando", "ibm"]],
      ["unavailable", ["ibm-mac"]],
      ["comingSoon", ["sqlite"]],
    ]);
  });

  it("não devolve o grupo vazio, e mantém a ordem em que a API mandou dentro de cada grupo", () => {
    expect(groupDrivers([driver("b", { state: "comingSoon" }), driver("a", { state: "comingSoon" })])).toEqual([{ key: "comingSoon", drivers: [driver("b", { state: "comingSoon" }), driver("a", { state: "comingSoon" })] }]);
    expect(groupDrivers([])).toEqual([]);
  });
});

describe("progressPercent e stateLabel (itens B e D)", () => {
  it("a porcentagem é de baixo, e nunca passa de 0 a 100", () => {
    expect(progressPercent({ receivedBytes: 48234496, totalBytes: 115343360 })).toBe(41);
    expect(progressPercent({ receivedBytes: 0, totalBytes: 100 })).toBe(0);
    expect(progressPercent({ receivedBytes: 100, totalBytes: 100 })).toBe(100);
    expect(progressPercent({ receivedBytes: 150, totalBytes: 100 })).toBe(100);
  });

  it("sem progresso (o primeiro byte ainda não chegou) não há porcentagem", () => {
    expect(progressPercent(null)).toBeNull();
  });

  it("escreve o estado em palavras", () => {
    expect(stateLabel(driver("a", { state: "bundled" }))).toBe("Embutido");
    expect(stateLabel(driver("a", { state: "installed" }))).toBe("Instalado");
    expect(stateLabel(driver("a", { state: "available" }))).toBe("Disponível");
    expect(stateLabel(driver("a", { state: "installing", progress: { receivedBytes: 42, totalBytes: 100 } }))).toBe("Baixando… 42%");
    expect(stateLabel(driver("a", { state: "failed" }))).toBe("Falhou");
    expect(stateLabel(driver("a", { state: "unavailable" }))).toBe("Sem driver para esta plataforma");
    expect(stateLabel(driver("a", { state: "comingSoon" }))).toBe("Em breve");
  });

  it("baixando sem progresso ainda é só 'Baixando…'", () => {
    expect(stateLabel(driver("a", { state: "installing", progress: null }))).toBe("Baixando…");
  });
});

describe("formatMegabytes", () => {
  it("escreve o tamanho em MB (1 MB = 1.048.576 bytes), com uma casa só abaixo de 10", () => {
    expect(formatMegabytes(115343360)).toBe("110 MB");
    expect(formatMegabytes(5452595)).toBe("5,2 MB");
    expect(formatMegabytes(0)).toBe("0 MB");
    expect(formatMegabytes(300)).toBe("< 1 MB");
  });
});

describe("actionOf: o botão de cada linha (itens B, C, D e F)", () => {
  it.each([
    ["available", "install"],
    ["failed", "retry"],
    ["installing", "cancel"],
    ["installed", "remove"],
    ["bundled", null],
    ["unavailable", null],
    ["comingSoon", null],
  ] as const)("%s -> %s", (state, action) => {
    expect(actionOf(driver("a", { state }))).toBe(action);
  });
});

describe("knownEngines", () => {
  it("deixa as etiquetas só dos bancos que o Prism conhece, sem repetir", () => {
    expect(knownEngines(driver("a", { engines: [3, 9, 2, 2, 0] }))).toEqual([2, 3]);
    expect(knownEngines(driver("a", { engines: [] }))).toEqual([]);
  });
});

describe("hasInstalling (item D)", () => {
  it("há instalação em andamento só se algum driver está baixando", () => {
    expect(hasInstalling([driver("a"), driver("b", { state: "installing" })])).toBe(true);
    expect(hasInstalling([driver("a"), driver("b", { state: "failed" }), driver("c", { state: "installed" })])).toBe(false);
    expect(hasInstalling([])).toBe(false);
    expect(hasInstalling(undefined)).toBe(false);
  });
});

describe("driverIdOf: o driver que falta no 422 DRIVER_NOT_INSTALLED (seção 16)", () => {
  it("é a extensão `driverID` do erro, quando é um texto", () => {
    expect(driverIdOf({ driverID: "ibm-data-server" })).toBe("ibm-data-server");
  });

  it("sem a extensão, vazia ou de outro tipo, não há driver a apontar", () => {
    expect(driverIdOf({})).toBeUndefined();
    expect(driverIdOf({ driverID: "" })).toBeUndefined();
    expect(driverIdOf({ driverID: 7 })).toBeUndefined();
    expect(driverIdOf({ driverId: "ibm" })).toBeUndefined();
  });
});

describe("o que mudou entre duas listas (itens D, E e F)", () => {
  it("o reinício passa a ser necessário quando restartRequired vira verdadeiro: instalação concluída ou remoção", () => {
    const before = [driver("ibm", { state: "installing" }), driver("pg", { state: "bundled" })];
    const installed = [driver("ibm", { state: "installed", restartRequired: true }), driver("pg", { state: "bundled" })];
    expect(restartBecamePending(before, installed)).toBe(true);

    // A remoção vale no reinício: o driver pode continuar `installed` (ou voltar a `available`) com `restartRequired`.
    const removable = [driver("ibm", { state: "installed" })];
    expect(restartBecamePending(removable, [driver("ibm", { state: "installed", restartRequired: true })])).toBe(true);
    expect(restartBecamePending(removable, [driver("ibm", { state: "available", restartRequired: true })])).toBe(true);
  });

  it("não é novidade o que já estava pendente, nem a primeira lista que se vê", () => {
    const pending = [driver("ibm", { state: "installed", restartRequired: true })];

    expect(restartBecamePending(pending, pending)).toBe(false);
    expect(restartBecamePending(undefined, pending)).toBe(false);
    expect(restartBecamePending([driver("ibm")], [driver("ibm")])).toBe(false);
  });

  it("uma instalação que falhou é a que estava baixando e agora falhou", () => {
    const before = [driver("ibm", { state: "installing" }), driver("antigo", { state: "failed" })];
    const after = [driver("ibm", { state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "caiu" } }), driver("antigo", { state: "failed" })];

    expect(failedInstalls(before, after).map((item) => item.id)).toEqual(["ibm"]);
    expect(failedInstalls(undefined, after)).toEqual([]);
    expect(failedInstalls(after, after)).toEqual([]);
  });
});
