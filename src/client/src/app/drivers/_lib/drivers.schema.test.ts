import { describe, expect, it } from "vitest";

import { driverSchema, driversSchema } from "./drivers.schema";

/** Um item da lista como a seção 16 da especificação o descreve: o "IBM Data Server", disponível para baixar. */
const available = {
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state: "available",
  version: "12.1.3",
  sizeBytes: 115343360,
  license: { name: "IBM International Program License Agreement", url: "https://exemplo.local/licenca-ibm" },
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
};

/** Um banco que o Prism ainda não conecta: sem bancos atendidos e sem versão (seção 16). */
const comingSoon = { ...available, id: "sqlite", name: "SQLite", vendor: "SQLite Consortium", engines: [], state: "comingSoon", version: null, sizeBytes: null, license: null };

describe("driverSchema (seção 16 da especificação)", () => {
  it("aceita o item disponível para baixar", () => {
    expect(driverSchema.parse(available)).toEqual(available);
  });

  it("aceita o item em breve: sem bancos, sem versão, sem tamanho e sem licença", () => {
    expect(driverSchema.parse(comingSoon)).toMatchObject({ state: "comingSoon", engines: [], version: null, sizeBytes: null, license: null });
  });

  it("aceita o item que baixa, com o progresso, e o que falhou, com a causa", () => {
    const installing = { ...available, state: "installing", progress: { receivedBytes: 48234496, totalBytes: 115343360 } };
    const failed = { ...available, state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão com api.nuget.org caiu." } };

    expect(driverSchema.parse(installing).progress).toEqual({ receivedBytes: 48234496, totalBytes: 115343360 });
    expect(driverSchema.parse(failed).error).toEqual({ code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão com api.nuget.org caiu." });
  });

  it.each(["bundled", "available", "installing", "installed", "failed", "unavailable", "comingSoon"])("conhece o estado %s", (state) => {
    expect(driverSchema.parse({ ...available, state }).state).toBe(state);
  });

  it("um estado que a tela não conhece vira em breve, e a lista continua inteira", () => {
    const list = driversSchema.parse([available, { ...available, id: "novo", state: "quarantined" }]);

    expect(list.map((driver) => driver.state)).toEqual(["available", "comingSoon"]);
  });

  it("estado ausente ou que não é texto é resposta inválida: só texto desconhecido vira em breve", () => {
    const withoutState: Record<string, unknown> = { ...available };
    delete withoutState.state;

    expect(driverSchema.safeParse(withoutState).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, state: 7 }).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, state: null }).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, state: "" }).success).toBe(true);
  });

  it("um número de banco que a tela não conhece não derruba o item", () => {
    expect(driverSchema.parse({ ...available, engines: [2, 3, 9] }).engines).toEqual([2, 3, 9]);
  });

  it("o endereço da licença que não é https:// vale como licença ausente (o driver não pode ser instalado)", () => {
    for (const url of ["http://exemplo.local/licenca", "ftp://exemplo.local/licenca", "javascript:alert(1)", "//exemplo.local/licenca", "exemplo.local/licenca", "HTTPS://exemplo.local/licenca", "https://", ""]) {
      expect(driverSchema.parse({ ...available, license: { name: "Licença", url } }).license, url).toBeNull();
    }

    expect(driverSchema.parse({ ...available, license: { name: "Licença", url: "https://exemplo.local/licenca?a=1#b" } }).license?.url).toBe("https://exemplo.local/licenca?a=1#b");
  });

  it("o endereço com caractere de controle, de direção de texto, invisível ou espaço vale como licença ausente: o que se copia é o que se vê", () => {
    const hostile = [
      "https://exemplo.local/\u202Elicenca",
      "https://exemplo.local/\u2066licenca",
      "https://exemplo.local/\u200Blicenca",
      "https://exemplo.local/\u00ADlicenca",
      "https://exemplo.local/\uFEFFlicenca",
      "https://exemplo.local/\nlicenca",
      "https://exemplo.local/\tlicenca",
      "https://exemplo.local/\u0000licenca",
      "https://exemplo.local/ licenca",
      "https://exemplo.local/\u00A0licenca",
      "https://exemplo.local/\u2028licenca",
    ];

    for (const url of hostile) expect(driverSchema.parse({ ...available, license: { name: "Licença", url } }).license, JSON.stringify(url)).toBeNull();
  });

  it("recusa o que não é um item: sem identificador, tamanho negativo, progresso fora do formato", () => {
    expect(driverSchema.safeParse({ ...available, id: "" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, sizeBytes: -1 }).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, progress: { receivedBytes: "10" } }).success).toBe(false);
    expect(driverSchema.safeParse({ ...available, restartRequired: "sim" }).success).toBe(false);
    // A lista garante que o total do progresso nunca é zero (seção 16, "O que a lista garante").
    expect(driverSchema.safeParse({ ...available, progress: { receivedBytes: 0, totalBytes: 0 } }).success).toBe(false);
    // Toda chave vem sempre, com `null` quando não se aplica.
    const withoutSize: Record<string, unknown> = { ...available };
    delete withoutSize.sizeBytes;
    expect(driverSchema.safeParse(withoutSize).success).toBe(false);
    expect(driversSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
