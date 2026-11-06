import { describe, expect, it } from "vitest";

import { localeArgument, localeFromArgv, parseLocale, pickCopy } from "./locale";
import { splashPage } from "./splash";

describe("o idioma do programa", () => {
  it("lê o locale.json e recusa o que não é um dos idiomas", () => {
    expect(parseLocale('{ "locale": "en" }')).toBe("en");
    expect(parseLocale('{ "locale": "es" }')).toBe("es");
    expect(parseLocale('{ "locale": "fr" }')).toBe("pt-BR");
    expect(parseLocale("não é JSON")).toBe("pt-BR");
    expect(parseLocale("null")).toBe("pt-BR");
  });

  it("vai à janela como argumento e volta igual; sem argumento, o português", () => {
    expect(localeFromArgv(["electron", localeArgument("es")])).toBe("es");
    expect(localeFromArgv(["electron", "--prism-locale=xx"])).toBe("pt-BR");
    expect(localeFromArgv([])).toBe("pt-BR");
  });

  it("escolhe os textos do idioma pedido", () => {
    const all = { "pt-BR": { ok: "Salvar" }, en: { ok: "Save" }, es: { ok: "Guardar" } } as const;
    expect(pickCopy("en", all).ok).toBe("Save");
    expect(pickCopy("pt-BR", all).ok).toBe("Salvar");
  });

  it("o splash nasce no idioma do programa", () => {
    const page = splashPage("1.2.3", "en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("version 1.2.3");
    expect(page).toContain("Open, connect, query.");
    expect(page).not.toContain("{{");
  });
});
