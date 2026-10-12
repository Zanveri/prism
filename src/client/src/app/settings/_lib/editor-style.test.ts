import { describe, expect, it } from "vitest";

import { editorFont, fontStack, lineHeightFor } from "./editor-style";
import { defaultPreferences } from "./preferences";

describe("a fonte do editor (Configurações → Editor SQL)", () => {
  it("com o padrão, o editor fica como sempre foi: IBM Plex Mono do app, 13 px, linha de 22 px, tabulação de 4", () => {
    expect(editorFont(defaultPreferences.editor)).toEqual({ fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "22px", tabSize: 4 });
  });

  it("a fonte escolhida vem primeiro, e a do app fica atrás: sem a fonte instalada o editor continua legível", () => {
    expect(fontStack("IBM Plex Mono")).toBe("var(--font-mono)");
    expect(fontStack("Cascadia Mono")).toBe('"Cascadia Mono", var(--font-mono)');
    expect(fontStack("JetBrains Mono")).toBe('"JetBrains Mono", var(--font-mono)');
  });

  it("a altura da linha acompanha o tamanho da fonte, na proporção do canvas (22 px para 13 px)", () => {
    expect(lineHeightFor(13)).toBe(22);
    expect([10, 12, 14, 16, 18, 24].map(lineHeightFor)).toEqual([17, 20, 24, 27, 30, 41]);
  });

  it("junta o tamanho, a fonte e a tabulação escolhidos", () => {
    expect(editorFont({ fontFamily: "Consolas", fontSize: 18, tabSize: 2 })).toEqual({ fontFamily: '"Consolas", var(--font-mono)', fontSize: "18px", lineHeight: "30px", tabSize: 2 });
  });
});
