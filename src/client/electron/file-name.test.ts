import { describe, expect, it } from "vitest";

import { exportExtensions, exportFileName } from "./file-name";

/** Os caracteres de controle e as marcas se escrevem por código: o lint recusa `\x00` num literal. */
const chars = (...codes: number[]) => String.fromCharCode(...codes);

describe("exportFileName: o nome que o diálogo de salvar propõe", () => {
  it("é o nome seguro do CSV de hoje com a extensão pedida", () => {
    expect(exportFileName("producao.apontamento", "csv")).toBe("producao.apontamento.csv");
    expect(exportFileName("producao.apontamento", "json")).toBe("producao.apontamento.json");
    expect(exportFileName("producao.apontamento", "xlsx")).toBe("producao.apontamento.xlsx");
  });

  it("as regras do CSV valem em qualquer extensão: o que o Windows não aceita vira `_`, e controle e marca de direção saem", () => {
    expect(exportFileName("a/b:c*d?e", "html")).toBe("a_b_c_d_e.html");
    expect(exportFileName(`fatura${chars(0x202e)}vsc${chars(10)}.exe`, "md")).toBe("faturavsc.exe.md");
    expect(exportFileName(`a${chars(0xfeff, 0x200b)}b`, "xml")).toBe("ab.xml");
  });

  it("o nome de dispositivo do Windows ganha um `_` na frente, com a extensão que for", () => {
    for (const device of ["con", "NUL", "com1", "lpt9", "aux", "prn"]) expect(exportFileName(device, "json")).toBe(`_${device}.json`);
    expect(exportFileName("con.pedidos", "sql")).toBe("_con.pedidos.sql");
    expect(exportFileName("console", "sql")).toBe("console.sql");
  });

  it("não termina em ponto nem em espaço antes da extensão, e não passa de um tamanho razoável", () => {
    expect(exportFileName("pedidos. ", "csv")).toBe("pedidos.csv");
    expect(exportFileName("x".repeat(500), "xlsx").length).toBeLessThanOrEqual(130);
    expect(exportFileName("x".repeat(500), "xlsx").endsWith(".xlsx")).toBe(true);
  });

  it("um nome que sobra vazio cai no nome padrão, com a extensão pedida", () => {
    expect(exportFileName("", "json")).toBe("registros.json");
    expect(exportFileName("...", "tsv")).toBe("registros.tsv");
    expect(exportFileName(`${chars(0x202e)}`, "md")).toBe("registros.md");
  });

  it("um ponto na frente da extensão não duplica o ponto", () => {
    expect(exportFileName("a", ".json")).toBe("a.json");
  });

  it("o nome proposto para cada extensão da exportação termina nela e não tem o que o sistema de arquivos recusa", () => {
    for (const extension of exportExtensions) {
      const name = exportFileName('s"c<h>|e?m*a/\\.t:abela', extension);

      expect(name.endsWith(`.${extension}`), name).toBe(true);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
    }
  });
});
