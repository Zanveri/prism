import clickhouse from "./clickhouse.svg";
import duckdb from "./duckdb.svg";
import mariadb from "./mariadb.svg";
import mysql from "./mysql.svg";
import postgresql from "./postgresql.png";
import sqlite from "./sqlite.svg";

/** O esquema de cor do tema: o Prism Escuro, Monokai, Dracula e Nord são escuros; o Prism Claro e o GitHub Claro, claros. */
type Scheme = "dark" | "light";

/**
 * A ficha sobre a qual a logo fica onde ela some (RN-NAV-005): a clara nos temas escuros e a escura nos claros. A escura é a tinta do
 * Prism Claro; a clara, o branco.
 */
export const logoChips = { dark: "#FFFFFF", light: "#1B2027" } as const satisfies Record<Scheme, string>;

export type DatabaseLogo = {
  /** O arquivo, como veio da fonte (o README anota a origem, o dono da marca e o SHA-256). */
  src: string;
  /**
   * `image`: o arquivo do fabricante, desenhado como está. `glyph`: o glifo do Simple Icons, de uma cor só e sem cor no arquivo, pintado
   * na cor que o Simple Icons dá à marca (`color`).
   */
  kind: "image" | "glyph";
  /** A cor do glifo; nula na imagem, que traz as próprias cores. */
  color: string | null;
  /** A cor do contorno de fora do desenho: é ela que separa a logo do fundo, e é com ela que se mede o contraste. */
  edge: string;
  /** O esquema de cor em que a logo some sobre a grade (abaixo de 3:1) e vai sobre a ficha (`logoChips`); nulo, em nenhum. */
  chip: Scheme | null;
};

/**
 * As logos dos bancos do catálogo de drivers, por banco (RN-NAV-005, Ruling 136): a chave é a da marca (`postgresql`, e o id do driver nos
 * "em breve"). Só o tamanho muda; o desenho e as cores são os da fonte. O banco que não está aqui (Db2, Informix, SQL Server, Oracle e
 * Firebird) não tem logo em nenhuma das duas fontes e fica com a ficha de hoje. Um pedido de retirada de um fabricante é atendido apagando o
 * arquivo e a linha dele aqui: a grade volta à ficha sozinha.
 */
export const databaseLogos = {
  // O Slonik da página de marca do PostgreSQL; o contorno de fora é preto, e ele some nos temas escuros.
  postgresql: { src: postgresql, kind: "image", color: null, edge: "#000000", chip: "dark" },
  sqlite: { src: sqlite, kind: "glyph", color: "#003B57", edge: "#003B57", chip: "dark" },
  mysql: { src: mysql, kind: "glyph", color: "#4479A1", edge: "#4479A1", chip: "dark" },
  mariadb: { src: mariadb, kind: "glyph", color: "#003545", edge: "#003545", chip: "dark" },
  duckdb: { src: duckdb, kind: "glyph", color: "#FFF000", edge: "#FFF000", chip: "light" },
  clickhouse: { src: clickhouse, kind: "glyph", color: "#FFCC01", edge: "#FFCC01", chip: "light" },
} as const satisfies Record<string, DatabaseLogo>;

/** A logo de um banco, pela chave da marca; nula quando ele fica com a ficha. */
export function databaseLogoOf(brand: string): DatabaseLogo | null {
  return Object.hasOwn(databaseLogos, brand) ? databaseLogos[brand as keyof typeof databaseLogos] : null;
}
