import { describe, expect, it } from "vitest";

import { exportChoicesKey } from "../data-export/export-choices";
import { defaultOptions } from "../data-export/export-options";
import { copyAsChoicesKey, parseCopyAsChoices, readCopyAsChoices, serializeCopyAsChoices, writeCopyAsChoices } from "./copy-as-choices";

/** Um `localStorage` de mentira, com o que ficou gravado à mão. */
function memoryStorage() {
  const items = new Map<string, string>();
  return { items, storage: () => ({ getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }) };
}

describe("as escolhas do Copiar como (RN-GRADE-017)", () => {
  it("são por usuário, numa chave separada da exportação, e começam nos padrões dela, com o CSV", () => {
    expect(copyAsChoicesKey(" Ana ")).toBe("prism:copy-as:ana");
    expect(copyAsChoicesKey("ana")).not.toBe(exportChoicesKey("ana"));
    expect(parseCopyAsChoices(null)).toEqual({ format: "csv", options: defaultOptions({ schema: "", table: "" }) });
  });

  it("gravam o formato e as opções, sem a tabela de destino, que vem da origem ao ler", () => {
    const options = defaultOptions({ schema: "estoque", table: "pedido" });
    const choices = { format: "json" as const, options: { ...options, json: { ...options.json, wrap: false }, txt: { ...options.txt, maxWidth: "40" } } };
    const raw = serializeCopyAsChoices(choices);

    expect(raw).not.toContain("estoque");
    expect(raw).not.toContain("pedido");
    expect(parseCopyAsChoices(raw, { schema: "vendas", table: "itens" })).toEqual({
      format: "json",
      options: { ...choices.options, sql: { ...choices.options.sql, schema: "vendas", table: "itens" }, dbUnit: { ...choices.options.dbUnit, table: "itens" } },
    });
  });

  it("a escolha que não vale mais volta ao padrão, sem erro: o formato que não existe, o XLSX, o valor fora da faixa, o JSON que não se lê", () => {
    expect(parseCopyAsChoices('{"format":"xlsx"}').format).toBe("csv");
    expect(parseCopyAsChoices('{"format":"banco"}').format).toBe("csv");
    expect(parseCopyAsChoices('{"format":"txt","options":{"txt":{"minWidth":"0"}}}').options.txt.minWidth).toBe("3");
    expect(parseCopyAsChoices('{"options":{"csv":{"delimiter":"#","header":false}}}').options.csv).toMatchObject({ delimiter: ";", header: false });
    expect(parseCopyAsChoices("{não é json").format).toBe("csv");
    expect(parseCopyAsChoices("[1,2]").format).toBe("csv");
  });

  it("ler e gravar pelo armazenamento; o que falta ou lança vale nada lembrado, e sem usuário nada é gravado", () => {
    const { items, storage } = memoryStorage();
    writeCopyAsChoices("Ana", { format: "xml", options: defaultOptions({ schema: "", table: "" }) }, storage);

    expect(readCopyAsChoices("ana", { schema: "", table: "" }, storage).format).toBe("xml");
    writeCopyAsChoices(null, { format: "sql", options: defaultOptions({ schema: "", table: "" }) }, storage);
    expect([...items.keys()]).toEqual(["prism:copy-as:ana"]);

    const broken = () => ({
      getItem: () => {
        throw new Error("negado");
      },
      setItem: () => {
        throw new Error("cheio");
      },
    });
    expect(readCopyAsChoices("ana", { schema: "", table: "" }, broken).format).toBe("csv");
    expect(() => writeCopyAsChoices("ana", { format: "csv", options: defaultOptions({ schema: "", table: "" }) }, broken)).not.toThrow();
    expect(readCopyAsChoices(null, { schema: "", table: "" }, () => null).format).toBe("csv");
  });
});
