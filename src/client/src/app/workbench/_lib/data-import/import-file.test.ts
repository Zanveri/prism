import { describe, expect, it } from "vitest";

import { copyPercent, detectionLine, encodingText, formatOfName, hiddenColumnsNote, noRowsProblem, previewText, shortRowText, sourceRefusal } from "./import-file";
import type { ImportRead } from "./imports.schema";

const read = (change: Partial<ImportRead> = {}): ImportRead => ({ encoding: null, delimiter: null, listKey: null, sheets: null, sheet: null, columns: ["id", "nome"], shownColumns: 2, rows: [{ line: 2, values: ["1", "Ana"], short: false }], ...change });

describe("o formato pela extensão (RN-IMPORT-003)", () => {
  it(".csv e .txt são CSV; .tsv e .tab, TSV; .json, JSON; .xlsx e .xlsm, XLSX; outra (ou nenhuma), CSV; a caixa da extensão não importa", () => {
    expect(["a.csv", "a.TXT", "a.tsv", "a.Tab", "a.json", "a.xlsx", "a.XLSM", "a.xls", "dados", "relatorio.final.dat"].map(formatOfName)).toEqual(["csv", "csv", "tsv", "tsv", "json", "xlsx", "xlsx", "csv", "csv", "csv"]);
  });
});

describe("as frases do campo do arquivo (RN-IMPORT-003)", () => {
  it("as recusas da escolha, com os tamanhos escritos como o Windows (1.024 bytes por KB); a escolhida e a desistência não dizem nada", () => {
    expect(sourceRefusal({ status: "tooLarge", size: Math.round(2.4 * 1024 ** 3) })).toBe("O arquivo tem 2,4 GB, e o Prism importa até 2 GB.");
    expect(sourceRefusal({ status: "noSpace", needed: Math.round(1.2 * 1024 ** 3) })).toBe("Não há espaço na pasta de dados do Prism para copiar o arquivo: são precisos 1,2 GB.");
    expect(sourceRefusal({ status: "notWritable" })).toBe("Não é possível gravar na pasta de dados do Prism.");
    expect(sourceRefusal({ status: "unreadable", message: "o sistema não dá permissão para ler o arquivo" })).toBe("Não foi possível ler o arquivo: o sistema não dá permissão para ler o arquivo.");
    expect(sourceRefusal({ status: "notAFile" })).toBe("Escolha um arquivo, e não uma pasta ou um dispositivo.");
    expect(sourceRefusal({ status: "error" })).toBe("Não foi possível abrir o diálogo do sistema.");
    expect(sourceRefusal({ status: "canceled" })).toBeNull();
    expect(sourceRefusal({ status: "chosen", fileId: "x", fileName: "a.csv", size: 1 })).toBeNull();
  });

  it("a porcentagem da cópia, para baixo e no máximo 99% até o fim", () => {
    expect(copyPercent(45, 100)).toBe(45);
    expect(copyPercent(999, 1000)).toBe(99);
    expect(copyPercent(1000, 1000)).toBe(99);
    expect(copyPercent(0, 0)).toBe(0);
  });
});

describe("o que a leitura achou e a prévia do arquivo (RN-IMPORT-007 e 008)", () => {
  it("a linha de cima: a codificação, o separador e as colunas; no XLSX a planilha; no JSON a lista; sem separador, uma coluna só", () => {
    expect(detectionLine("csv", read({ encoding: { name: "utf-8", bom: true }, delimiter: ";", columns: Array.from({ length: 15 }, (_, i) => `c${i}`) }))).toBe("UTF-8 com BOM · ponto e vírgula · 15 colunas");
    expect(detectionLine("tsv", read({ encoding: { name: "windows-1252", bom: false }, delimiter: "\t" }))).toBe("Windows-1252 · tabulação · 2 colunas");
    expect(detectionLine("csv", read({ encoding: { name: "utf-8", bom: false }, delimiter: null, columns: ["a"] }))).toBe("UTF-8 · uma coluna só · 1 coluna");
    expect(detectionLine("xlsx", read({ sheet: "Pedidos" }))).toBe("Planilha Pedidos · 2 colunas");
    expect(detectionLine("json", read({ listKey: "pedido" }))).toBe("Lista em pedido · 2 colunas");
    expect(detectionLine("json", read())).toBe("Lista de objetos · 2 colunas");
    expect(encodingText("utf-16le", true)).toBe("UTF-16 LE com BOM");
  });

  it("a célula que chegou no teto de 1.000 caracteres ganha \"…\"; as colunas que não aparecem são ditas embaixo", () => {
    expect(previewText("abc")).toBe("abc");
    expect(previewText("x".repeat(1000))).toBe(`${"x".repeat(1000)}…`);
    expect(hiddenColumnsNote(16_384, 1_384)).toBe("As outras 15.000 colunas não aparecem na prévia.");
    expect(hiddenColumnsNote(2, 1)).toBe("A outra coluna não aparece na prévia.");
    expect(hiddenColumnsNote(2, 2)).toBeNull();
  });

  it("a linha completada com nulo diz quantos valores tinha (os que vieram antes dos nulos do fim) e quantos o cabeçalho tem", () => {
    expect(shortRowText({ line: 12, values: ["1", "a", "b", null, null], short: true } as never, 5, true)).toBe("A linha 12 tem 3 valores, e o cabeçalho tem 5: os que faltam vão como nulo.");
    expect(shortRowText({ line: 1, values: ["1", null], short: true } as never, 2, false)).toBe("A linha 1 tem 1 valor, e a primeira linha tem 2: os que faltam vão como nulo.");
  });

  it("o arquivo sem nenhuma linha de dados não avança", () => {
    expect(noRowsProblem(read({ rows: [] }))).toBe("O arquivo não tem linhas para importar.");
    expect(noRowsProblem(read())).toBeNull();
  });
});
