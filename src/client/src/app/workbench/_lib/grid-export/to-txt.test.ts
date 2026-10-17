import { describe, expect, it } from "vitest";

import { chars, column, documentOf } from "./test-fixtures";
import { takeCodePoints, txtValue } from "./to-txt";

describe("a tabela de texto (RN-EXPORT-008)", () => {
  it("o exemplo da regra, com os padrões", () => {
    const { text } = documentOf("txt", [column("id", "number"), column("nome"), column("criado", "datetime")], [["1", "Bruna", "2024-01-15"], ["2", "Ana", "2024-02-20"]], { lineBreak: "lf" });

    expect(text).toBe("|id |nome |criado    |\n|---|-----|----------|\n|1  |Bruna|2024-01-15|\n|2  |Ana  |2024-02-20|\n");
  });

  it("as larguras são de cada lote de 200 linhas: o lote com o valor maior alarga as colunas dele, sem mudar as linhas já escritas, e o cabeçalho é o do primeiro", () => {
    const rows = Array.from({ length: 250 }, (_, index) => [index === 220 ? "um valor bem maior" : "a"]);
    const lines = documentOf("txt", [column("c")], rows, { lineBreak: "lf" }).text.split("\n");

    expect(lines[0]).toBe("|c  |");
    expect(lines[1]).toBe("|---|");
    expect(lines[2]).toBe("|a  |");
    expect(lines[201]).toBe("|a  |");
    expect(lines[202]).toBe(`|a${" ".repeat(17)}|`);
    expect(lines[222]).toBe("|um valor bem maior|");
    expect(lines).toHaveLength(250 + 3);
  });

  it("o lote fecha antes das 200 linhas quando os valores dele passam de 16 MiB", () => {
    const big = (letter: string) => letter.repeat(9 * 1024 * 1024);
    const lines = documentOf("txt", [column("c")], [[big("a")], [big("b")], ["c"]], { lineBreak: "lf", header: false }).text.split("\n");

    expect(lines[0].length).toBe(9 * 1024 * 1024 + 2);
    expect(lines[1].length).toBe(9 * 1024 * 1024 + 2);
    expect(lines[2]).toBe("|c  |");
  });

  it("a largura máxima corta o valor e o nome, e conta só os valores", () => {
    const { text, counts } = documentOf("txt", [column("nome completo")], [["Bruna Lima"], ["Ana"]], { maxWidth: "4", lineBreak: "lf" });

    expect(text).toBe("|nome|\n|----|\n|Brun|\n|Ana |\n");
    expect(counts.cutValues).toBe(1);
  });

  it("o nulo é vazio, ou NULL; o binário em hexadecimal, ou vazio", () => {
    expect(documentOf("txt", [column("a"), column("f", "binary")], [[null, "0xAB"]], { header: false, lineBreak: "lf" }).text).toBe("|   |0xAB|\n");
    expect(documentOf("txt", [column("a"), column("f", "binary")], [[null, "0xAB"]], { header: false, lineBreak: "lf", showNull: true, binary: "null" }).text).toBe("|NULL|NULL|\n");
  });

  it("sem as barras nas pontas, sem a linha sob o cabeçalho e com CRLF", () => {
    expect(documentOf("txt", [column("a"), column("b")], [["1", "2"]], { edgeDelimiters: false, headerLine: false }).text).toBe("a  |b  \r\n1  |2  \r\n");
  });

  it("txtValue: os controles, a quebra de linha, a tabulação e os separadores do Unicode viram espaço", () => {
    expect(txtValue(`a\nb\r\nc\td${chars(0, 0x7f, 0x85, 0x2028, 0x2029)}e`)).toBe("a b  c d     e");
  });

  it("a largura conta pontos de código: o ideograma, o emoji e o par solto contam um", () => {
    expect(documentOf("txt", [column("c")], [["一二"], ["🙂"], [chars(0xd800)]], { header: false, lineBreak: "lf" }).text).toBe("|一二 |\n|🙂  |\n|\uFFFD  |\n");
    expect(takeCodePoints("🙂🙂🙂", 2)).toBe("🙂🙂");
  });
});
