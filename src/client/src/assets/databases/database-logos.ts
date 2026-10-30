import bigquery from "./bigquery.png";
import clickhouse from "./clickhouse.png";
import databricks from "./databricks.png";
import db2 from "./db2.png";
import duckdb from "./duckdb.png";
import firebird from "./firebird.png";
import informix from "./informix.png";
import mariadb from "./mariadb.png";
import mysql from "./mysql.png";
import oracle from "./oracle.png";
import postgresql from "./postgresql.png";
import sqlServer from "./sql-server.png";
import sqlite from "./sqlite.png";

export type DatabaseLogo = {
  /** O arquivo PNG com fundo transparente (o README anota a origem, o dono da marca e o SHA-256). */
  src: string;
};

/**
 * As logos dos bancos do catálogo de drivers, por banco (RN-NAV-005, Ruling 136): a chave é a da marca, sempre em PNG sem fundo.
 * Um pedido de retirada de um fabricante é atendido apagando o arquivo e a linha dele aqui: a tela volta à etiqueta sozinha.
 */
export const databaseLogos = {
  postgresql: { src: postgresql },
  db2: { src: db2 },
  informix: { src: informix },
  sqlite: { src: sqlite },
  mysql: { src: mysql },
  mariadb: { src: mariadb },
  "sql-server": { src: sqlServer },
  oracle: { src: oracle },
  firebird: { src: firebird },
  duckdb: { src: duckdb },
  clickhouse: { src: clickhouse },
  bigquery: { src: bigquery },
  databricks: { src: databricks },
} as const satisfies Record<string, DatabaseLogo>;

/** Os bancos que o Prism conecta, pelo número da API (RN-CONN-010), com a chave da marca. */
export const engineBrands = {
  1: "postgresql",
  2: "db2",
  3: "informix",
  4: "sqlite",
  5: "mysql",
  6: "mariadb",
  7: "sql-server",
  8: "oracle",
  9: "firebird",
  10: "duckdb",
  11: "clickhouse",
  12: "bigquery",
  13: "databricks",
} as const satisfies Record<number, keyof typeof databaseLogos>;

/** A logo de um banco, pela chave da marca; nula quando ele fica com a etiqueta. */
export function databaseLogoOf(brand: string): DatabaseLogo | null {
  return Object.hasOwn(databaseLogos, brand) ? databaseLogos[brand as keyof typeof databaseLogos] : null;
}
