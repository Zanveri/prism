import { describe, expect, it } from "vitest";

import type { Driver } from "@/app/drivers/_lib/drivers.schema";

import { choiceOf, engineChoices, type EngineChoice } from "./engine-choices";

const license = { name: "Licença", url: "https://exemplo.local/licenca" };

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return { id, name: id, vendor: "Fabricante", engines: [], state: "available", version: "1.0.0", sizeBytes: 1048576, license, platformNote: null, progress: null, error: null, restartRequired: false, ...overrides };
}

/** O catálogo desta entrega (RN-DRIVER-002), como a API o devolve hoje nesta árvore: o PostgreSQL embutido, o da IBM para baixar e os "em breve". */
const postgres = driver("postgresql", { name: "PostgreSQL", vendor: "Npgsql", engines: [1], state: "bundled", license: null, sizeBytes: null });
const ibm = driver("ibm-data-server", { name: "IBM Data Server", vendor: "IBM", engines: [2, 3] });
const soon = ["SQLite", "MySQL", "MariaDB"].map((name) => driver(name.toLowerCase(), { name, state: "comingSoon", version: null, license: null, sizeBytes: null }));
const catalog = [postgres, ibm, ...soon];

const summary = (choices: EngineChoice[]) => choices.map((choice) => [choice.label, choice.state, choice.stateLabel, choice.disabled]);

describe("engineChoices: a lista de bancos do formulário, montada do catálogo de drivers (RN-NAV-005)", () => {
  it("os três bancos que o Prism conecta, na ordem de sempre, cada um com o estado do driver que o atende; depois os 'em breve', desabilitados", () => {
    expect(summary(engineChoices(catalog))).toEqual([
      ["PostgreSQL", "bundled", "Driver embutido", false],
      ["Db2", "missing", "Driver não instalado", false],
      ["Informix", "missing", "Driver não instalado", false],
      ["SQLite", "comingSoon", "Em breve", true],
      ["MySQL", "comingSoon", "Em breve", true],
      ["MariaDB", "comingSoon", "Em breve", true],
    ]);
  });

  it("cada banco leva o driver que o atende (o da IBM serve ao Db2 e ao Informix) e o número dele (1, 2, 3); o 'em breve' não tem banco", () => {
    const choices = engineChoices(catalog);

    expect(choices.map((choice) => [choice.engine, choice.driver?.id ?? null])).toEqual([
      [1, "postgresql"],
      [2, "ibm-data-server"],
      [3, "ibm-data-server"],
      [null, "sqlite"],
      [null, "mysql"],
      [null, "mariadb"],
    ]);
  });

  it("cada estado do driver: instalado, baixando (com a porcentagem quando o total chegou), falhou — todos podem ser escolhidos", () => {
    const at = (overrides: Partial<Driver>) => summary(engineChoices([postgres, { ...ibm, ...overrides }]))[1];

    expect(at({ state: "installed" })).toEqual(["Db2", "installed", "Driver instalado", false]);
    expect(at({ state: "installing" })).toEqual(["Db2", "installing", "Baixando o driver…", false]);
    expect(at({ state: "installing", progress: { receivedBytes: 40, totalBytes: 100 } })).toEqual(["Db2", "installing", "Baixando o driver… 40%", false]);
    expect(at({ state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "rede" } })).toEqual(["Db2", "failed", "O download do driver falhou", false]);
  });

  it("sem driver para a plataforma (o macOS Intel para a IBM): aparece desabilitado, com o motivo que o catálogo dá", () => {
    const [, db2] = engineChoices([postgres, { ...ibm, state: "unavailable", platformNote: "A IBM não publica este driver para esta plataforma." }]);

    expect([db2.state, db2.stateLabel, db2.disabled, db2.reason]).toEqual(["unavailable", "Sem driver para esta plataforma", true, "A IBM não publica este driver para esta plataforma."]);
    expect(engineChoices([postgres, { ...ibm, state: "unavailable" }])[1].reason).toBe("O fabricante não publica o driver deste banco para esta plataforma.");
  });

  it("o 'em breve' diz por que não pode ser escolhido", () => {
    expect(engineChoices(catalog)[3].reason).toBe("O Prism ainda não conecta neste banco.");
  });

  it("o reinício que um driver espera vai junto (o formulário lembra do 'Reiniciar agora')", () => {
    expect(engineChoices([postgres, { ...ibm, state: "installed", restartRequired: true }]).map((choice) => choice.restartPending)).toEqual([false, true, true]);
  });

  it("sem a lista (ainda a caminho, ou falhou): os três bancos, escolhíveis e sem estado; a conexão pode ser salva sem saber do driver", () => {
    expect(summary(engineChoices(undefined))).toEqual([
      ["PostgreSQL", "unknown", "", false],
      ["Db2", "unknown", "", false],
      ["Informix", "unknown", "", false],
    ]);
  });

  it("um banco que nenhum driver do catálogo atende fica escolhível, sem estado", () => {
    expect(summary(engineChoices([postgres]))[1]).toEqual(["Db2", "unknown", "", false]);
  });

  it("um driver de um banco que a tela não conhece (a API mais nova que a tela) aparece como 'em breve', e nunca como um banco escolhível", () => {
    const novo = driver("novo", { name: "Banco Novo", engines: [9], state: "installed" });

    expect(summary(engineChoices([postgres, ibm, novo])).at(-1)).toEqual(["Banco Novo", "comingSoon", "Em breve", true]);
  });

  it("um estado que a tela não conhece num banco que ela conecta (vira `comingSoon` no schema) deixa o banco desabilitado, com o motivo", () => {
    const [, db2] = engineChoices([postgres, { ...ibm, state: "comingSoon" }]);

    expect([db2.state, db2.disabled, db2.reason]).toEqual(["comingSoon", true, "O Prism ainda não conecta neste banco."]);
  });
});

describe("choiceOf: o banco escolhido no formulário", () => {
  it("acha o banco pelo número", () => {
    expect(choiceOf(engineChoices(catalog), 3)?.label).toBe("Informix");
  });
});
