import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { databaseLogoOf, databaseLogos, engineBrands } from "./database-logos";

const folder = new URL("./", import.meta.url);
const readme = readFileSync(new URL("README.md", folder), "utf8");

/** O catálogo de drivers da API (RN-DRIVER-002): é dele que sai a grade de bancos. */
const catalog = JSON.parse(readFileSync(new URL("../../../../api/Prism.Infrastructure/Drivers/drivers.catalog.json", folder), "utf8")) as { drivers: { id: string; engines?: number[]; kind?: string }[] };
/** Cada banco da grade: os que o Prism conecta (pelo número) e os "em breve" (pelo id do driver). */
const catalogBrands = catalog.drivers.flatMap((driver) => (driver.kind === "comingSoon" ? [driver.id] : (driver.engines ?? []).map((engine) => engineBrands[engine as keyof typeof engineBrands])));

const withLogo = ["bigquery", "clickhouse", "databricks", "db2", "duckdb", "firebird", "informix", "mariadb", "mysql", "oracle", "postgresql", "sql-server", "sqlite"];
const withoutLogo: string[] = [];

describe("as logos dos bancos de dados (RN-NAV-005, Ruling 136)", () => {
  it("o catálogo de drivers tem os treze bancos de que o README fala", () => {
    expect([...catalogBrands].sort()).toEqual([...withLogo, ...withoutLogo].sort());
  });

  it("cada banco do catálogo está no README com o arquivo PNG da logo", () => {
    for (const brand of withLogo) expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| \`${brand}\\.png\``, "m"));
  });

  it("a pasta tem só as treze logos em PNG, o README, o registro e o teste dele, e o .gitattributes", () => {
    expect(readdirSync(folder).sort()).toEqual([
      ".gitattributes",
      "README.md",
      "bigquery.png",
      "clickhouse.png",
      "database-logos.test.ts",
      "database-logos.ts",
      "databricks.png",
      "db2.png",
      "duckdb.png",
      "firebird.png",
      "informix.png",
      "mariadb.png",
      "mysql.png",
      "oracle.png",
      "postgresql.png",
      "sql-server.png",
      "sqlite.png",
    ]);
  });

  it("o registro tem uma logo para cada arquivo, e nenhuma para quem fica com a etiqueta", () => {
    expect(Object.keys(databaseLogos).sort()).toEqual(withLogo);
    for (const brand of withLogo) expect(databaseLogoOf(brand)).toBe(databaseLogos[brand as keyof typeof databaseLogos]);
    for (const brand of [...withoutLogo, "outro-banco"]) expect(databaseLogoOf(brand)).toBeNull();
  });

  it.each(withLogo)("o arquivo %s.png é um PNG RGBA com fundo transparente e o SHA-256 é o que o README registra", (brand) => {
    const file = `${brand}.png`;
    const bytes = readFileSync(new URL(file, folder));
    const hash = createHash("sha256").update(bytes).digest("hex");

    // Assinatura PNG (8 bytes) e cabeçalho IHDR: byte 25 é o color type (6 = RGBA com canal alfa).
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes[25]).toBe(6);
    expect(readme).toMatch(new RegExp(`^\\| [^|]+ \\| \`${file}\` \\|[^\\n]*\`${hash}\``, "m"));
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
