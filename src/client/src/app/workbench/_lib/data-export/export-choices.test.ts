import { describe, expect, it } from "vitest";

import { exportChoicesKey, parseExportChoices, readExportChoices, serializeExportChoices, writeExportChoices } from "./export-choices";
import { defaultFilePattern } from "./export-file-name";
import { defaultBom, defaultOptions } from "./export-options";

const target = { schema: "estoque", table: "pedido" };

describe("as escolhas lembradas da última exportação (RN-EXPORT-003)", () => {
  it("nada gravado: os padrões, com a tabela de destino da origem", () => {
    expect(parseExportChoices(null, target)).toEqual({ format: "csv", options: defaultOptions(target), bom: defaultBom(), count: true, pattern: defaultFilePattern, zip: false, reveal: false, clipboard: false });
  });

  it("volta o que foi gravado: o formato, as opções de cada um, o BOM, o contar, o padrão do nome, o .zip, o mostrar e a área de transferência", () => {
    const options = defaultOptions({ schema: "outro", table: "outra" });
    options.csv.delimiter = "\t";
    options.txt.minWidth = "8";
    options.sql.rowsPerStatement = "1";
    const saved = serializeExportChoices({ format: "txt", options, bom: { ...defaultBom(), json: true }, count: false, pattern: "${tabela}", zip: true, reveal: true, clipboard: true });

    const parsed = parseExportChoices(saved, target);

    expect(parsed).toMatchObject({ format: "txt", count: false, pattern: "${tabela}", zip: true, reveal: true, clipboard: true });
    expect(parsed.bom.json).toBe(true);
    expect(parsed.options.csv.delimiter).toBe("\t");
    expect(parsed.options.txt.minWidth).toBe("8");
    // A tabela de destino é da origem, e não se lembra.
    expect(parsed.options.sql).toMatchObject({ schema: "estoque", table: "pedido", rowsPerStatement: "1" });
    expect(parsed.options.dbUnit.table).toBe("pedido");
    expect(saved).not.toContain("outra");
  });

  it("a escolha que não vale mais volta ao padrão, sem erro e sem levar as outras junto", () => {
    const parsed = parseExportChoices(
      JSON.stringify({ format: "pdf", count: "sim", pattern: "${tabelas}", options: { csv: { delimiter: ":", nullText: "a\nb", header: false }, txt: { minWidth: "5", maxWidth: "2" }, sql: { rowsPerStatement: "5000" } } }),
      target,
    );
    expect(parsed.format).toBe("csv");
    expect(parsed.count).toBe(true);
    expect(parsed.pattern).toBe(defaultFilePattern);
    expect(parsed.options.csv).toMatchObject({ delimiter: ";", nullText: "", header: false });
    expect(parsed.options.txt).toMatchObject({ minWidth: "3", maxWidth: "0" });
    expect(parsed.options.sql.rowsPerStatement).toBe("10");
  });

  it("JSON quebrado, ou o armazenamento que lança, valem os padrões; gravar que falha não lança; a chave é por usuário, em minúsculas", () => {
    expect(parseExportChoices("{", target).format).toBe("csv");
    for (const raw of ["[]", "[1, 2]", '[{ "format": "json" }]', "null", "42", '"x"']) expect(parseExportChoices(raw, target)).toEqual(parseExportChoices(null, target));
    expect(readExportChoices("ana", target, () => ({ getItem: () => "[]", setItem: () => {} })).format).toBe("csv");
    expect(readExportChoices("ana", target, () => ({ getItem: () => { throw new Error("negado"); }, setItem: () => {} })).format).toBe("csv");
    expect(() => writeExportChoices("ana", parseExportChoices(null, target), () => ({ getItem: () => null, setItem: () => { throw new Error("cheio"); } }))).not.toThrow();
    expect(exportChoicesKey(" Ana ")).toBe("prism:data-export:ana");

    const store = new Map<string, string>();
    const storage = () => ({ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) });
    writeExportChoices("ana", { ...parseExportChoices(null, target), format: "json" }, storage);
    expect(readExportChoices("ANA", target, storage).format).toBe("json");
    expect(readExportChoices(null, target, storage).format).toBe("csv");
  });
});
