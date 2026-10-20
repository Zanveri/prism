import { describe, expect, it } from "vitest";

import { importBlockerOf } from "./import-entry";

describe("o \"Importar…\" dos Registros (RN-IMPORT-001)", () => {
  it("a conexão somente leitura e a visão desabilitam, cada uma com o motivo dela", () => {
    expect(importBlockerOf("Somente leitura pela pasta Produção", "table")).toBe("A conexão é somente leitura: importar grava na tabela.");
    expect(importBlockerOf(null, "view")).toBe("Só uma tabela recebe linhas importadas: esta é uma visão.");
    expect(importBlockerOf("Somente leitura", "view")).toBe("A conexão é somente leitura: importar grava na tabela.");
  });

  it("a tabela, e o objeto que a aba ainda não sabe o que é, ficam habilitados", () => {
    expect(importBlockerOf(null, "table")).toBeNull();
    expect(importBlockerOf(null, "unknown")).toBeNull();
  });
});
