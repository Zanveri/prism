import { describe, expect, it } from "vitest";

import type { GridSlice } from "./grid-slice";
import { chars, column, documentOf, hostile, hostileValues, sliceDocument, sliceOf } from "./test-fixtures";

/** O documento sem o título com o nome da origem, com os caracteres tirados. */
function toHtml(slice: GridSlice): { text: string; removed: number } {
  const { text, counts } = sliceDocument("html", slice, { title: false });
  return { text, removed: counts.removedCharacters };
}

/** Todas as marcas do documento: nome e atributos. O dado nunca é marca, então tudo o que aparece aqui é do formato. */
function tagsOf(html: string): { name: string; attributes: string[] }[] {
  return [...html.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/g)].map((match) => ({
    name: `${match[1]}${match[2].toLowerCase()}`,
    // Os valores entre aspas saem antes: o do `content` da política tem espaços e palavras que não são atributos.
    attributes: [...match[3].replace(/="[^"]*"/g, "").matchAll(/\s+([a-z-]+)/g)].map((attribute) => attribute[1]),
  }));
}

const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

describe("o HTML: um documento completo", () => {
  it("tem tipo de documento, idioma, codificação, título e uma tabela com o cabeçalho em <th>", () => {
    const { text, removed } = toHtml(sliceOf([column("id", "number"), column("nome")], [["1", "Ana"]]));

    expect(removed).toBe(0);
    expect(text.startsWith("<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">")).toBe(true);
    expect(text).toContain("<title>Resultado</title>");
    expect(text.endsWith("</table>\n</body>\n</html>\n")).toBe(true);
    expect(bodyOf(text)).toBe(
      '<body>\n<table>\n<thead>\n<tr><th scope="col" class="num">id</th><th scope="col">nome</th></tr>\n</thead>\n<tbody>\n<tr><td class="num">1</td><td>Ana</td></tr>\n</tbody>\n</table>\n</body>\n</html>\n',
    );
  });

  it("uma célula só: o documento é completo e válido, com o cabeçalho e uma única <td> com o valor escapado", () => {
    const { text, removed } = toHtml(sliceOf([column("a<b")], [['x & "y" <z>']]));

    expect(removed).toBe(0);
    expect(text.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(text.endsWith("</table>\n</body>\n</html>\n")).toBe(true);
    expect(bodyOf(text)).toBe(
      '<body>\n<table>\n<thead>\n<tr><th scope="col">a&lt;b</th></tr>\n</thead>\n<tbody>\n<tr><td>x &amp; &quot;y&quot; &lt;z&gt;</td></tr>\n</tbody>\n</table>\n</body>\n</html>\n',
    );
    expect(text.match(/<th[ >]/g)).toHaveLength(1);
    expect(text.match(/<td[ >]/g)).toHaveLength(1);
    // Cada marca que abre fecha: o documento está balanceado.
    for (const name of ["html", "head", "body", "table", "thead", "tbody", "tr", "th", "td", "title", "style"]) {
      expect(text.match(new RegExp(`<${name}[ >]`, "g")), name).toHaveLength(text.match(new RegExp(`</${name}>`, "g"))?.length ?? -1);
    }
  });

  it("sem linhas: só o cabeçalho", () => {
    expect(bodyOf(toHtml(sliceOf([column("a")], [])).text)).toBe('<body>\n<table>\n<thead>\n<tr><th scope="col">a</th></tr>\n</thead>\n<tbody>\n</tbody>\n</table>\n</body>\n</html>\n');
  });

  it("com o título, o nome da origem é o <title> e uma <caption>, escapados e sem o que o documento não aceita, contado uma vez", () => {
    const { text, counts } = documentOf("html", [column("a")], [["1"], ["2"]], {}, { sourceName: `ped<i>do${chars(0)}` });

    expect(text).toContain("<title>ped&lt;i&gt;do</title>");
    expect(text).toContain("<table>\n<caption>ped&lt;i&gt;do</caption>\n<thead>");
    expect(counts.removedCharacters).toBe(1);
  });

  it("sem os nomes das colunas, o <thead> fica vazio", () => {
    expect(documentOf("html", [column("a")], [["1"]], { columnNames: false }).text).toContain("<thead>\n</thead>\n<tbody>\n<tr><td>1</td></tr>\n</tbody>");
  });

  it("o binário em hexadecimal, inteiro, ou a célula nula com \"Deixar vazio\"", () => {
    expect(documentOf("html", [column("f", "binary")], [["0xBEEF"]]).text).toContain("<tr><td>0xBEEF</td></tr>");
    expect(documentOf("html", [column("f", "binary")], [["0xBEEF"]], { binary: "null" }).text).toContain('<tr><td class="null"></td></tr>');
  });

  it("o nulo é uma célula vazia marcada pela classe `null`; o texto vazio é uma célula vazia sem a classe", () => {
    const { text } = toHtml(sliceOf([column("a"), column("b", "number"), column("c")], [[null, null, ""]]));

    expect(text).toContain('<tr><td class="null"></td><td class="null"></td><td></td></tr>');
  });

  it("os números ficam à direita (cabeçalho e células), e o resto não", () => {
    const { text } = toHtml(sliceOf([column("n", "number"), column("t"), column("d", "datetime"), column("b", "boolean")], [["1", "2", "2024-01-02", "true"]]));

    expect(text).toContain('<th scope="col" class="num">n</th><th scope="col">t</th><th scope="col">d</th><th scope="col">b</th>');
    expect(text).toContain('<tr><td class="num">1</td><td>2</td><td>2024-01-02</td><td>true</td></tr>');
    expect(text).toContain(".num{text-align:right}");
  });

  it("célula cortada, coluna binária e nomes de coluna repetidos saem como na grade", () => {
    const { text } = toHtml(sliceOf([column("x"), column("x"), column("f", "binary")], [["cortado…", "ok", "0x00ff"]], { truncated: [[0, 0]] }));

    expect(text).toContain('<th scope="col">x</th><th scope="col">x</th><th scope="col">f</th>');
    expect(text).toContain("<tr><td>cortado…</td><td>ok</td><td>0x00ff</td></tr>");
  });
});

describe("o HTML: tudo o que vem do dado é escapado", () => {
  it("& < > aspas duplas e simples, no valor e no nome da coluna", () => {
    const { text } = toHtml(sliceOf([column(`n<"&'>`)], [[`<b>"&'</b>`]]));

    expect(text).toContain("<th scope=\"col\">n&lt;&quot;&amp;&#39;&gt;</th>");
    expect(text).toContain("<td>&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;</td>");
  });

  it("com valor e nome hostis, as únicas marcas do documento são as do formato: nenhum script, nenhum estilo ou evento vindo do dado", () => {
    const evil = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "<style>body{display:none}</style>", "</td></tr></table><script>x</script>", "<!-- ", "<svg onload=alert(1)>", "javascript:alert(1)", "&lt;script&gt;"];
    const { text } = toHtml(sliceOf([...evil.map((value) => column(value)), column("n", "number")], [[...evil, '"><b onclick=x>']]));
    const tags = tagsOf(text);
    const allowed = ["!doctype", "html", "head", "meta", "title", "style", "/style", "/title", "/head", "body", "table", "thead", "tbody", "tr", "th", "td", "/html", "/body", "/table", "/thead", "/tbody", "/tr", "/th", "/td"];

    expect(tags.map((tag) => tag.name).filter((name) => !allowed.includes(name))).toEqual([]);
    // Nenhum atributo fora dos do formato; em particular, nenhum on*, nenhum style, nenhum href/src.
    expect([...new Set(tags.flatMap((tag) => tag.attributes))].sort()).toEqual(["charset", "class", "content", "http-equiv", "lang", "scope"]);
    expect(text.match(/<script/gi)).toBeNull();
    expect(text).not.toMatch(/\sstyle=/i);
    expect(text.match(/<td/g)).toHaveLength(evil.length + 1);
    expect(text.match(/<th /g)).toHaveLength(evil.length + 1);
  });

  it("o documento diz que nenhum script roda nele, ainda que o escape falhasse", () => {
    expect(toHtml(sliceOf([column("a")], [])).text).toContain("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">");
  });

  it("a quebra de linha (\\n e \\r\\n) e a tabulação ficam no texto da célula, e a folha de estilo as preserva (white-space)", () => {
    const { text } = toHtml(sliceOf([column("a")], [[hostile.lf], [hostile.crlf], [hostile.tab]]));

    expect(text).toContain(`<td>${hostile.lf}</td>`);
    expect(text).toContain(`<td>${hostile.crlf}</td>`);
    expect(text).toContain(`<td>${hostile.tab}</td>`);
    expect(text).toContain("white-space:pre-wrap");
  });

  it("acento, emoji, valor que parece fórmula e texto com aspas passam", () => {
    const { text } = toHtml(sliceOf([column("a")], [[hostile.accents], [hostile.emoji], [hostile.formulaEquals], [hostile.formulaCommand]]));

    expect(text).toContain(`<td>${hostile.accents}</td>`);
    expect(text).toContain(`<td>${hostile.emoji}</td>`);
    expect(text).toContain("<td>=1+1</td>");
    expect(text).toContain("<td>=cmd|&#39; /C calc&#39;!A0</td>");
  });
});

describe("o HTML: o que o HTML não aceita no documento", () => {
  it("caracteres de controle, DEL, os de C1, os não-caracteres e os pares soltos são tirados, e a função diz quantos", () => {
    // NUL, SOH, BEL, ESC, DEL, NEL (C1), U+FFFE, um U+FDD0 e dois pares soltos.
    const dirty = `a${chars(0, 1, 7, 27, 127, 0x85, 0xfffe, 0xfdd0)}b${chars(0xd800)}c${chars(0xdc00)}d`;
    const { text, removed } = toHtml(sliceOf([column("a")], [[dirty]]));

    expect(removed).toBe(10);
    expect(text).toContain("<td>abcd</td>");
  });

  it("o nome da coluna também, e conta", () => {
    const { text, removed } = toHtml(sliceOf([column(`n${chars(0)}x`)], [["v"]]));

    expect(removed).toBe(1);
    expect(text).toContain('<th scope="col">nx</th>');
  });

  it("tabulação, quebra de linha, retorno de carro e acento não são tirados", () => {
    expect(toHtml(sliceOf([column("a")], [[chars(9, 10, 13, 0xe7, 0xa0)]])).removed).toBe(0);
  });

  it("depois de limpo, nenhum valor hostil deixa controle algum no documento", () => {
    const { text } = toHtml(sliceOf([column("a")], hostileValues.map((value) => [value])));

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      const control = (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff);
      expect(control, `U+${code.toString(16)}`).toBe(false);
    }
  });
});
