import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { themeSchemes, type ThemeId } from "@/app/settings/_lib/theme";
import { contrast } from "@/lib/testing/contrast";
import { paletteOf } from "@/lib/testing/theme-palettes";

import { databaseLogoOf, databaseLogos, logoChips } from "./database-logos";

const folder = new URL("./", import.meta.url);
const readme = readFileSync(new URL("README.md", folder), "utf8");

/** O catálogo de drivers da API (RN-DRIVER-002): é dele que sai a grade de bancos. */
const catalog = JSON.parse(readFileSync(new URL("../../../../api/Prism.Infrastructure/Drivers/drivers.catalog.json", folder), "utf8")) as { drivers: { id: string; engines?: number[]; kind?: string }[] };
/** Os bancos que o Prism conecta, pelo número da API, com a chave da marca. */
const engineBrands: Record<number, string> = { 1: "postgresql", 2: "db2", 3: "informix" };
/** Cada banco da grade: os que o Prism conecta (pelo número) e os "em breve" (pelo id do driver). */
const catalogBrands = catalog.drivers.flatMap((driver) => (driver.kind === "comingSoon" ? [driver.id] : (driver.engines ?? []).map((engine) => engineBrands[engine])));

const withLogo = ["clickhouse", "duckdb", "mariadb", "mysql", "postgresql", "sqlite"];
const withoutLogo = ["db2", "firebird", "informix", "oracle", "sql-server"];

/** As superfícies em que a marca aparece na grade: o fundo do diálogo (`raised`) e o do banco escolhido ou sob o ponteiro (`selected`). */
const surfacesOf = (theme: ThemeId) => {
  const { palette } = paletteOf(theme);
  return [palette.raised, palette.selected];
};
const themes = Object.keys(themeSchemes) as ThemeId[];

describe("as logos dos bancos da grade de nova conexão (RN-NAV-005, Ruling 136)", () => {
  it("o catálogo de drivers tem os onze bancos de que o README fala: os três que o Prism conecta e os oito em breve", () => {
    expect([...catalogBrands].sort()).toEqual([...withLogo, ...withoutLogo].sort());
  });

  it("cada banco do catálogo está no README: com o arquivo da logo, ou com o motivo de ficar com a ficha de hoje", () => {
    for (const brand of withLogo) expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| \`${brand}\\.(svg|png)\``, "m"));
    for (const brand of withoutLogo) expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| sem logo \\(\`${brand}\`\\)`, "m"));
  });

  it("a pasta tem só as seis logos, o README, o registro e o teste dele, e o .gitattributes", () => {
    expect(readdirSync(folder).sort()).toEqual([".gitattributes", "README.md", "clickhouse.svg", "database-logos.test.ts", "database-logos.ts", "duckdb.svg", "mariadb.svg", "mysql.svg", "postgresql.png", "sqlite.svg"]);
  });

  it("o registro tem uma logo para cada arquivo, e nenhuma para quem fica com a ficha", () => {
    expect(Object.keys(databaseLogos).sort()).toEqual(withLogo);
    for (const brand of withLogo) expect(databaseLogoOf(brand)).toBe(databaseLogos[brand as keyof typeof databaseLogos]);
    for (const brand of [...withoutLogo, "outro-banco"]) expect(databaseLogoOf(brand)).toBeNull();
  });

  it.each(withLogo)("o SHA-256 de %s é o que o README registra: o arquivo é o da fonte, sem redesenho nem cor nova", (brand) => {
    const file = readdirSync(folder).find((name) => name.startsWith(`${brand}.`)) ?? "";
    const hash = createHash("sha256").update(readFileSync(new URL(file, folder))).digest("hex");

    expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| \`${file}\` \\|[^\\n]*\`${hash}\``, "m"));
  });

  it("o PostgreSQL é o arquivo do fabricante (o Slonik da página de marca), desenhado como está; os outros são os glifos do Simple Icons, na cor que ele dá à marca", () => {
    expect(databaseLogos.postgresql).toMatchObject({ kind: "image", color: null });
    for (const brand of ["clickhouse", "duckdb", "mariadb", "mysql", "sqlite"] as const) {
      const logo = databaseLogos[brand];
      expect(logo.kind).toBe("glyph");
      expect(logo.color).toMatch(/^#[0-9A-F]{6}$/);
      // O glifo de uma cor só: o contorno é a própria cor; e a cor é a que o README anota do Simple Icons.
      expect(logo.edge).toBe(logo.color);
      expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| \`${brand}\\.svg\` \\|[^\\n]*\`${logo.color}\``, "m"));
    }
  });

  it("o glifo do Simple Icons é de uma cor só e não traz cor no arquivo: quem pinta é a grade, com a cor da marca", () => {
    for (const brand of ["clickhouse", "duckdb", "mariadb", "mysql", "sqlite"]) {
      const svg = readFileSync(new URL(`${brand}.svg`, folder), "utf8");
      expect(svg).toMatch(/^<svg role="img" viewBox="0 0 24 24" xmlns="http:\/\/www.w3.org\/2000\/svg"><title>[^<]+<\/title><path d="[^"]+"\/><\/svg>$/);
    }
  });

  it("as fichas: a clara nos temas escuros, a escura nos claros", () => {
    expect(logoChips).toEqual({ dark: "#FFFFFF", light: "#1B2027" });
  });

  describe("cada logo se vê nos seis temas (3:1, o mínimo de um gráfico): sobre a grade, ou sobre a ficha onde ela some", () => {
    const cases = Object.entries(databaseLogos).flatMap(([brand, logo]) => themes.map((theme) => [brand, theme, logo] as const));

    it.each(cases)("%s no tema %s", (_brand, theme, logo) => {
      const scheme = themeSchemes[theme];
      const grounds = logo.chip === scheme ? [logoChips[scheme]] : surfacesOf(theme);

      for (const ground of grounds) expect(contrast(logo.edge, ground)).toBeGreaterThanOrEqual(3);
    });
  });

  it("a ficha só entra onde a logo some: em algum tema daquele esquema, sem ela, a logo fica abaixo de 3:1", () => {
    for (const logo of Object.values(databaseLogos)) {
      if (logo.chip === null) continue;
      const vanishes = themes.filter((theme) => themeSchemes[theme] === logo.chip).some((theme) => surfacesOf(theme).some((ground) => contrast(logo.edge, ground) < 3));
      expect(vanishes).toBe(true);
    }
  });

  it("o README diz de quem são as marcas, que não estão sob a GPLv3, que não indicam apoio nem parceria, e como se atende um pedido de retirada", () => {
    expect(readme).toContain("As marcas e as logos são dos seus donos");
    expect(readme).toContain("não estão sob a GPLv3");
    expect(readme).toContain("não indicam apoio, patrocínio nem parceria");
    expect(readme).toMatch(/pedido de retirada/);
    expect(readme).toContain("Ruling 136");
  });

  it("o NOTICE da raiz tem a seção das logos dos bancos, com o mesmo aviso, e aponta este README", () => {
    const notice = readFileSync(new URL("../../../../../NOTICE", folder), "utf8");

    expect(notice).toMatch(/Logos dos bancos de dados/);
    expect(notice).toContain("src/client/src/assets/databases/README.md");
    expect(notice).toMatch(/não estão sob a GPLv3/);
    expect(notice).toMatch(/não indicam apoio, patrocínio nem parceria/);
  });
});
