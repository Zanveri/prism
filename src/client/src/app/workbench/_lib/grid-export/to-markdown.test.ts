import { describe, expect, it } from "vitest";

import { column, hostile, hostileValues, sliceOf } from "./test-fixtures";
import { toMarkdown } from "./to-markdown";

/** Quantas barras verticais SEPARAM células numa linha: as que a barra invertida não escapa (a separação é sempre ` | `). */
const separators = (line: string) => (line.match(/(?<!\\)\|/g) ?? []).length;

describe("toMarkdown: a tabela no estilo do GitHub", () => {
  it("cabeçalho, linha de alinhamento e uma linha por registro; número alinhado à direita", () => {
    const slice = sliceOf([column("id", "number"), column("nome")], [["1", "Ana"], ["2", "Bia"]]);

    expect(toMarkdown(slice)).toBe("| id | nome |\n| ---: | --- |\n| 1 | Ana |\n| 2 | Bia |\n");
  });

  it("sem colunas não há tabela; só com colunas, o cabeçalho e o alinhamento", () => {
    expect(toMarkdown(sliceOf([], []))).toBe("");
    expect(toMarkdown(sliceOf([column("a"), column("b", "number")], []))).toBe("| a | b |\n| --- | ---: |\n");
  });

  it("uma célula só", () => {
    expect(toMarkdown(sliceOf([column("a")], [["x"]]))).toBe("| a |\n| --- |\n| x |\n");
  });

  it("o nulo é uma célula vazia (e não o texto null)", () => {
    expect(toMarkdown(sliceOf([column("a"), column("b")], [[null, "x"], ["", null]]))).toBe("| a | b |\n| --- | --- |\n|  | x |\n|  |  |\n");
  });

  it("coluna booleana, de data, binária, célula cortada e nomes repetidos: o texto da grade, sem mudança", () => {
    const slice = sliceOf([column("x"), column("x", "boolean"), column("d", "datetime"), column("f", "binary")], [["cortado…", "true", "2024-01-02", "0x00ff"]], { truncated: [[0, 0]] });

    expect(toMarkdown(slice)).toBe("| x | x | d | f |\n| --- | --- | --- | --- |\n| cortado… | true | 2024-01-02 | 0x00ff |\n");
  });
});

describe("toMarkdown: o que se escapa", () => {
  const cellOf = (value: string) => toMarkdown(sliceOf([column("a")], [[value]])).split("\n")[2];

  it("a barra vertical e a barra invertida", () => {
    expect(cellOf("a|b")).toBe("| a\\|b |");
    expect(cellOf("a\\b")).toBe("| a\\\\b |");
    expect(cellOf(hostile.pipeAndBackslash)).toBe("| a\\|b\\\\c\\|d\\\\ |");
  });

  it("a quebra de linha (\\n, \\r\\n e \\r) vira <br>, e a linha da tabela continua uma só", () => {
    expect(cellOf(hostile.lf)).toBe("| linha1<br>linha2 |");
    expect(cellOf(hostile.crlf)).toBe("| linha1<br>linha2 |");
    expect(cellOf(hostile.cr)).toBe("| só<br>CR |");
    expect(cellOf("a\n\nb")).toBe("| a<br><br>b |");
  });

  it("o HTML do dado é escapado: não sobra marca nenhuma além do <br> que nós pusemos", () => {
    expect(cellOf(hostile.markup)).toBe("| &lt;script>alert(\"x\")&lt;/script> &amp; &lt;b>negrito&lt;/b> \\]\\]> 'a' |");
    expect(cellOf("&lt;")).toBe("| &amp;lt; |");
    expect(cellOf("<br>")).toBe("| &lt;br> |");
    expect(cellOf("x<br>y\nz")).toBe("| x&lt;br>y<br>z |");
  });

  it("o que o Markdown lê como formatação dentro da célula também: asteriscos, sublinhados, crases, til e colchetes", () => {
    expect(cellOf("*a* _b_ `c` ~d~ [e](f)")).toBe("| \\*a\\* \\_b\\_ \\`c\\` \\~d\\~ \\[e\\](f) |");
    expect(cellOf("2*3*4")).toBe("| 2\\*3\\*4 |");
    expect(cellOf("__init__")).toBe("| \\_\\_init\\_\\_ |");
  });

  it("o nome da coluna recebe o mesmo escape", () => {
    expect(toMarkdown(sliceOf([column("a|b"), column("c<d>")], [["1", "2"]])).split("\n")[0]).toBe("| a\\|b | c&lt;d> |");
  });

  it("tudo que parece fórmula, aspas, tabulação, acento, emoji e controle passa: o Markdown não executa nada", () => {
    for (const value of [hostile.formulaEquals, hostile.formulaAt, hostile.quote, hostile.singleQuote, hostile.tab, hostile.accents, hostile.emoji, hostile.controls]) {
      expect(cellOf(value)).toBe(`| ${value} |`);
    }
  });

  it("com qualquer valor hostil, a tabela tem uma linha por registro e a quantidade certa de células por linha", () => {
    const columns = [column("a"), column("b|c"), column("d", "number")];
    const rows = hostileValues.map((value) => [value, value, "1"]);
    const lines = toMarkdown(sliceOf(columns, rows)).split("\n");

    expect(lines).toHaveLength(rows.length + 3);
    expect(lines.at(-1)).toBe("");
    for (const line of lines.slice(0, -1)) {
      expect(line.startsWith("| ")).toBe(true);
      expect(line.endsWith(" |")).toBe(true);
      expect(separators(line), line).toBe(columns.length + 1);
    }
  });
});
