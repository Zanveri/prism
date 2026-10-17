import { describe, expect, it } from "vitest";

import { defaultOptions } from "../data-export/export-options";
import { clipboardLimitBytes, codePointCount, documentFormats, utf8Length, wellFormed, type DocumentContext, type DocumentRow } from "./document";
import { buildDocument, writeDocument } from "./documents";
import { chars, column } from "./test-fixtures";

const context = (columns = [column("a")]): DocumentContext => ({ engine: 1, sourceName: "pedido", columns, options: defaultOptions({ schema: "", table: "pedido" }) });
const rows = (count: number, value = "x"): DocumentRow[] => Array.from({ length: count }, (_, index) => ({ number: index + 1, values: [value] }));

describe("os documentos dos nove formatos de texto (RN-GRADE-016)", () => {
  it("são os da exportação menos o XLSX, na ordem do submenu do Copiar avançado", () => {
    expect(documentFormats).toEqual(["csv", "sourceCode", "dbUnit", "html", "json", "markdown", "sql", "txt", "xml"]);
  });

  it("utf8Length: o tamanho em UTF-8, com o par solto contado como o U+FFFD que o substitui", () => {
    expect(utf8Length("aé€🙂")).toBe(1 + 2 + 3 + 4);
    expect(utf8Length(chars(0xd800))).toBe(3);
    expect(utf8Length(`${chars(0xdc00)}${chars(0xd800)}`)).toBe(6);
    expect(utf8Length(wellFormed(`a${chars(0xd800)}b🙂`))).toBe(new TextEncoder().encode(`a${chars(0xd800)}b🙂`).length);
  });

  it("wellFormed: o par solto vira U+FFFD, e o par de verdade fica", () => {
    expect(wellFormed(`a${chars(0xd800)}b${chars(0xdc00)}🙂`)).toBe("a\uFFFDb\uFFFD🙂");
    expect(codePointCount(`🙂${chars(0xd800)}a`)).toBe(3);
  });

  it("todo formato escreve sem lançar, com qualquer valor hostil e sem linhas, e o texto nunca leva o par solto", () => {
    const hostile = [`a${chars(0, 0xd800)}"';<&>\r\n\t${chars(0x202e)}`, null, "", "0xDEAD"];
    for (const format of documentFormats) {
      for (const values of [[], [hostile]]) {
        const written = writeDocument(format, context([column("a"), column("b", "number"), column("c", "boolean"), column("f", "binary")]), values.map((row, index) => ({ number: index + 1, values: row })));
        expect(written.text, format).not.toMatch(/\p{Cs}/u);
      }
    }
  });
});

describe("buildDocument: o texto montado em partes, com o limite e a desistência", () => {
  it("dá o mesmo texto e o mesmo resumo que writeDocument, cedendo a vez à tela entre as partes", async () => {
    let pauses = 0;
    const built = await buildDocument("txt", context(), rows(450), { cellsPerPause: 100, pause: async () => void pauses++ });

    expect(built.kind).toBe("built");
    if (built.kind !== "built") return;
    expect(built.text).toBe(writeDocument("txt", context(), rows(450)).text);
    expect(built.bytes).toBe(utf8Length(built.text));
    expect(pauses).toBe(4);
  });

  it("passar do limite para na hora, sem montar o resto; chegar nele, não", async () => {
    const line = "x".repeat(99);
    const exact = writeDocument("csv", context(), rows(10, line));
    const bytes = utf8Length(exact.text);

    expect((await buildDocument("csv", context(), rows(10, line), { limitBytes: bytes })).kind).toBe("built");
    expect((await buildDocument("csv", context(), rows(10, line), { limitBytes: bytes - 1 })).kind).toBe("tooLarge");

    // A linha que passa do limite é a última que o escritor recebe.
    let read = 0;
    const counted = (function* () {
      for (const row of rows(1000, line)) {
        read++;
        yield row;
      }
    })();
    expect((await buildDocument("csv", context(), counted, { limitBytes: 1000 })).kind).toBe("tooLarge");
    expect(read).toBeLessThan(20);
  });

  it("o limite da área de transferência é 10 MiB", () => {
    expect(clipboardLimitBytes).toBe(10_485_760);
  });

  it("o sinal desiste entre duas partes", async () => {
    const controller = new AbortController();
    const built = await buildDocument("json", context(), rows(100), { signal: controller.signal, cellsPerPause: 10, pause: async () => controller.abort() });

    expect(built.kind).toBe("cancelled");
  });

  it("o texto sai com o par solto como U+FFFD, como o UTF-8 o grava", async () => {
    const built = await buildDocument("csv", context(), [{ number: 1, values: [`a${chars(0xd800)}`] }]);

    expect(built.kind === "built" && built.text).toBe("a\r\na\uFFFD\r\n");
  });
});
