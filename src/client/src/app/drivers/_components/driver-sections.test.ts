import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { clickLabeled } from "@/lib/testing/react-tree";

import { driversSchema, type Driver } from "../_lib/drivers.schema";
import { DriverRow, DriverSections, type DriverRowHandlers } from "./driver-sections";

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id,
    name: `Driver ${id}`,
    vendor: "Fabricante",
    engines: [2, 3],
    state: "available",
    version: "12.1.3",
    sizeBytes: 115343360,
    license: { name: "Licença", url: "https://exemplo.local/licenca" },
    platformNote: null,
    progress: null,
    error: null,
    restartRequired: false,
    ...overrides,
  };
}

const noop = () => {};
const handlers: DriverRowHandlers = { cancellingId: null, onInstall: noop, onCancel: noop, onRemove: noop };
const renderRow = (item: Driver, overrides: Partial<DriverRowHandlers> = {}) => renderToStaticMarkup(createElement("ul", null, createElement(DriverRow, { driver: item, ...handlers, ...overrides })));
const renderList = (list: Driver[]) => renderToStaticMarkup(createElement(DriverSections, { drivers: list, ...handlers }));
const buttonsOf = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, "").trim());

describe("a lista agrupada (item B)", () => {
  const all = [
    driver("sqlite", { name: "SQLite", vendor: "SQLite Consortium", engines: [], state: "comingSoon", version: null, sizeBytes: null, license: null }),
    driver("ibm-mac", { name: "IBM Data Server (macOS Intel)", state: "unavailable", platformNote: "A IBM não publica este driver para macOS Intel." }),
    driver("falhou", { name: "Driver que falhou", state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão com api.nuget.org caiu." } }),
    driver("pg", { name: "PostgreSQL", vendor: "Npgsql", engines: [1], state: "bundled", version: "10.0.3", sizeBytes: null }),
    driver("baixando", { name: "Driver baixando", state: "installing", progress: { receivedBytes: 48234496, totalBytes: 115343360 } }),
    driver("ibm", { name: "IBM Data Server", vendor: "IBM", state: "available" }),
    driver("instalado", { name: "Driver instalado", state: "installed" }),
  ];

  it("mostra os títulos dos grupos na ordem, e nenhum grupo vazio", () => {
    const markup = renderList(all);
    // h3: a lista mora no cartão "Drivers" de Configurações, cujo título é o h2 (RN-NAV-006).
    const headings = [...markup.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => match[1]);

    expect(headings).toEqual(["Instalados e embutidos", "Disponíveis para baixar", "Sem driver para esta plataforma", "Em breve"]);
    expect(renderList([driver("a", { state: "comingSoon" })]).match(/<h3/g)).toHaveLength(1);
  });

  it("cada linha traz o nome, o fabricante, as etiquetas dos bancos, a versão e o tamanho em MB", () => {
    const markup = renderRow(driver("ibm", { name: "IBM Data Server", vendor: "IBM", engines: [2, 3], version: "12.1.3", sizeBytes: 115343360 }));

    expect(markup).toContain("IBM Data Server");
    expect(markup).toContain(">IBM<");
    expect(markup).toContain(">DB2<");
    expect(markup).toContain(">IFX<");
    expect(markup).not.toContain(">PG<");
    expect(markup).toContain("12.1.3");
    expect(markup).toContain("110 MB");
  });

  it("o PostgreSQL embutido leva a etiqueta PG e não tem tamanho a mostrar", () => {
    const markup = renderRow(all[3]);

    expect(markup).toContain(">PG<");
    expect(markup).toContain("10.0.3");
    expect(markup).not.toContain("MB");
  });

  it("o estado em palavras, de cada driver", () => {
    expect(renderRow(all[3])).toContain("Embutido");
    expect(renderRow(all[6])).toContain("Instalado");
    expect(renderRow(all[5])).toContain("Disponível");
    expect(renderRow(all[4])).toContain("Baixando… 41%");
    expect(renderRow(all[2])).toContain("Falhou");
    expect(renderRow(all[1])).toContain("Sem driver para esta plataforma");
    expect(renderRow(all[0])).toContain("Em breve");
  });

  it("sem driver para a plataforma mostra a nota da API, como texto", () => {
    expect(renderRow(all[1])).toContain("A IBM não publica este driver para macOS Intel.");
  });

  it("o texto que vem da API nunca vira HTML", () => {
    const markup = renderRow(driver("x", { name: "<img src=x onerror=alert(1)>", vendor: "<b>IBM</b>", platformNote: "<script>1</script>", state: "unavailable" }));

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<b>IBM");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("os botões de cada linha", () => {
  it.each([
    ["available", ["Baixar"]],
    ["failed", ["Tentar de novo"]],
    ["installing", ["Cancelar"]],
    ["installed", ["Remover"]],
    ["bundled", []],
    ["unavailable", []],
    ["comingSoon", []],
  ] as const)("%s: %j", (state, labels) => {
    expect(buttonsOf(renderRow(driver("a", { state })))).toEqual(labels);
  });

  it("o PostgreSQL embutido nunca tem Remover", () => {
    expect(renderRow(driver("pg", { state: "bundled", engines: [1] }))).not.toContain("Remover");
  });

  it("um estado que a API inventou não derruba a lista: é 'Em breve' e não tem botão", () => {
    const [unknown] = driversSchema.parse([{ ...driver("novo"), state: "quarantined" }]);

    const markup = renderList([unknown, driver("pg", { state: "bundled" })]);

    expect(markup).toContain("Em breve");
    expect(buttonsOf(renderRow(unknown))).toEqual([]);
    expect(markup).toContain("Instalados e embutidos");
  });

  it("os botões dizem de qual driver falam (para o leitor de tela) e chamam o que a tela mandou", () => {
    const markup = renderRow(driver("ibm", { name: "IBM Data Server" }));

    expect(markup).toContain('aria-label="Baixar o driver IBM Data Server"');
  });
});

describe("os cliques das linhas chamam o que devem (itens C, D e F)", () => {
  const spies = () => ({ cancellingId: null, onInstall: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() });

  it.each([
    ["available", "Baixar", "onInstall"],
    ["failed", "Tentar de novo", "onInstall"],
    ["installing", "Cancelar", "onCancel"],
    ["installed", "Remover", "onRemove"],
  ] as const)("%s: '%s' chama %s com o driver da linha, e só ele", (state, label, handler) => {
    const spy = spies();
    const item = driver("a", { state });

    clickLabeled(DriverRow({ driver: item, ...spy }), label);

    expect(spy[handler]).toHaveBeenCalledExactlyOnceWith(item);
    for (const other of ["onInstall", "onCancel", "onRemove"] as const) if (other !== handler) expect(spy[other]).not.toHaveBeenCalled();
  });

  it("o botão de cancelar fica desligado enquanto o cancelamento roda", () => {
    const markup = renderRow(driver("baixando", { state: "installing", progress: { receivedBytes: 1, totalBytes: 2 } }), { cancellingId: "baixando" });

    expect(markup).toMatch(/<button[^>]* disabled(?:=""|[ >])[^>]*>Cancelando…<\/button>/);
  });
});

describe("a linha que o 'Instalar driver' aponta", () => {
  it("destaca só a linha apontada (aria-current), e as outras não", () => {
    const list = [driver("pg", { state: "bundled", engines: [1] }), driver("ibm")];
    const markup = renderToStaticMarkup(createElement(DriverSections, { drivers: list, highlightedId: "ibm", ...handlers }));

    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/<li[^>]*aria-current="true"[^>]*>.*Driver ibm/);
  });

  it("sem linha apontada, ou apontando um driver que não existe, nenhuma é destacada", () => {
    const list = [driver("ibm")];

    expect(renderToStaticMarkup(createElement(DriverSections, { drivers: list, highlightedId: null, ...handlers }))).not.toContain('aria-current="true"');
    expect(renderToStaticMarkup(createElement(DriverSections, { drivers: list, highlightedId: "outro", ...handlers }))).not.toContain('aria-current="true"');
  });
});

describe("o progresso (item D)", () => {
  const installing = driver("baixando", { state: "installing", progress: { receivedBytes: 48234496, totalBytes: 115343360 } });

  it("mostra a barra com a porcentagem e os bytes recebidos de cada total", () => {
    const markup = renderRow(installing);

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="41"');
    expect(markup).toContain("width:41%");
    expect(markup).toContain("46 MB de 110 MB");
  });

  it("sem o total a barra não inventa porcentagem", () => {
    const markup = renderRow(driver("a", { state: "installing", progress: null }));

    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain("aria-valuenow");
    expect(markup).toContain("Baixando…");
    expect(markup).not.toContain("%");
  });

  it("enquanto o cancelamento roda, o botão diz e não repete o clique", () => {
    const markup = renderRow(installing, { cancellingId: "baixando" });

    expect(buttonsOf(markup)).toEqual(["Cancelando…"]);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>/);
  });

  it("só a linha que baixa tem a barra", () => {
    expect(renderRow(driver("a", { state: "available" }))).not.toContain("progressbar");
  });
});

describe("o driver que falhou (item D)", () => {
  const failed = driver("falhou", { state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão com api.nuget.org caiu." } });

  it("mostra a causa na linha e o botão 'Tentar de novo'", () => {
    const markup = renderRow(failed);

    expect(markup).toContain("A conexão com api.nuget.org caiu.");
    expect(buttonsOf(markup)).toEqual(["Tentar de novo"]);
  });

  it("sem a causa, a linha diz que a API não a deu", () => {
    expect(renderRow(driver("a", { state: "failed", error: null }))).toContain("A API não disse a causa.");
  });
});

describe("o reinício pendente (itens E e F)", () => {
  it("a linha de um driver que espera o reinício diz isso", () => {
    expect(renderRow(driver("a", { state: "installed", restartRequired: true }))).toContain("Reinício pendente");
    expect(renderRow(driver("a", { state: "installed" }))).not.toContain("Reinício pendente");
  });
});
