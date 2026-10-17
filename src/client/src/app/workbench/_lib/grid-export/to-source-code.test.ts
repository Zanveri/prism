import { describe, expect, it } from "vitest";

import { chars, column, documentOf } from "./test-fixtures";
import { phpString, phpVariable } from "./to-source-code";

describe("o Código fonte, um array do PHP (RN-EXPORT-010)", () => {
  it("o exemplo da regra: <?php, a variável com o nome da origem, um array por linha, tabulação de recuo e LF", () => {
    const { text } = documentOf("sourceCode", [column("id", "number"), column("cliente")], [["1", "Ana"], ["2", null]]);

    expect(text).toBe('<?php\n$pedido = array(\n\tarray(\n\t\t"id" => 1,\n\t\t"cliente" => "Ana",\n\t),\n\tarray(\n\t\t"id" => 2,\n\t\t"cliente" => null,\n\t),\n);\n?>\n');
  });

  it("no PHP 5.4, os colchetes; sem linhas, o array vazio", () => {
    expect(documentOf("sourceCode", [column("id")], [["1"]], { php: "short" }).text).toBe('<?php\n$pedido = [\n\t[\n\t\t"id" => "1",\n\t],\n];\n?>\n');
    expect(documentOf("sourceCode", [column("id")], []).text).toBe("<?php\n$pedido = array();\n?>\n");
    expect(documentOf("sourceCode", [column("id")], [], { php: "short" }).text).toBe("<?php\n$pedido = [];\n?>\n");
  });

  it("o número e o lógico pela regra do JSON; a data em ISO 8601, ou como a grade com ela desligada", () => {
    const columns = [column("n", "number"), column("b", "boolean"), column("d", "datetime")];
    expect(documentOf("sourceCode", columns, [["12.50", "true", "2024-01-15 10:30:00-03"]]).text).toContain('\t\t"n" => 12.50,\n\t\t"b" => true,\n\t\t"d" => "2024-01-15T10:30:00-03:00",\n');
    expect(documentOf("sourceCode", columns, [["007", "t", "2024-01-15 10:30:00-03"]], { isoDates: false }).text).toContain('\t\t"n" => "007",\n\t\t"b" => "t",\n\t\t"d" => "2024-01-15 10:30:00-03",\n');
  });

  it("o caractere de direção nas chaves conta uma vez, e não por linha", () => {
    const { counts } = documentOf("sourceCode", [column(`a${chars(0x202e)}`)], [["1"], ["2"], ["3"]], { quote: "single" });

    expect(counts.removedCharacters).toBe(1);
  });

  it("phpString: nas aspas duplas, o escape do PHP e os bytes do UTF-8 dos controles e da direção; nas simples, só a barra e o apóstrofo", () => {
    expect(phpString(`$a "b" \\ ${chars(10, 13, 9, 11, 12, 0, 0x85)}`, false)).toEqual({ literal: '"\\$a \\"b\\" \\\\ \\n\\r\\t\\v\\f\\x00\\xC2\\x85"', removed: 0 });
    expect(phpString(`x${chars(0x202e)}y`, false)).toEqual({ literal: '"x\\xE2\\x80\\xAEy"', removed: 0 });
    expect(phpString(`it's \\ $a\n${chars(0x202e)}`, true)).toEqual({ literal: "'it\\'s \\\\ $a\n'", removed: 1 });
  });

  it("phpVariable: o que o PHP não aceita vira _, o dígito do começo ganha _, e o vazio é resultado", () => {
    expect(phpVariable("nota-fiscal")).toEqual({ variable: "nota_fiscal", removed: 0 });
    expect(phpVariable("1x")).toEqual({ variable: "_1x", removed: 0 });
    expect(phpVariable("ação")).toEqual({ variable: "ação", removed: 0 });
    expect(phpVariable(chars(0x202e))).toEqual({ variable: "resultado", removed: 1 });
  });
});
