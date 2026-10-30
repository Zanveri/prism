import type { CSSProperties, ComponentProps } from "react";

import { databaseLogoOf, logoChips, type DatabaseLogo } from "@/assets/databases/database-logos";
import { cn } from "@/lib/utils/cn";

import { StatusBadge } from "./status-badge";

/** A sigla de cada banco, como a etiqueta do canvas a escreve. */
export const engineTags = {
  1: "PG",
  2: "DB2",
  3: "IFX",
  4: "SQLITE",
  5: "MYSQL",
  6: "MARIA",
  7: "MSSQL",
  8: "ORA",
  9: "FB",
  10: "DUCK",
  11: "CH",
  12: "BQ",
  13: "DBX",
} as const;

/** O banco, como a API o numera (RN-CONN-010). */
export type Engine = keyof typeof engineTags;

/** A chave da marca de cada banco para buscar a logo do fabricante. */
const engineBrands: Record<Engine, string> = {
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
};

/** Um banco, uma cor (`globals.css`). */
const engineColors: Record<Engine, string> = {
  1: "border-postgres text-postgres",
  2: "border-db2 text-db2",
  3: "border-informix text-informix",
  4: "border-postgres text-postgres",
  5: "border-db2 text-db2",
  6: "border-informix text-informix",
  7: "border-db2 text-db2",
  8: "border-informix text-informix",
  9: "border-informix text-informix",
  10: "border-db2 text-db2",
  11: "border-db2 text-db2",
  12: "border-postgres text-postgres",
  13: "border-informix text-informix",
};

function chipBackground(chip: DatabaseLogo["chip"]): string | undefined {
  if (chip === "both") return `light-dark(${logoChips.light}, ${logoChips.dark})`;
  if (chip === "dark") return `light-dark(transparent, ${logoChips.dark})`;
  return chip === "light" ? `light-dark(${logoChips.light}, transparent)` : undefined;
}

/** A marca do banco, com a logo do fabricante (ou a etiqueta mono como reserva). Serve à lista, à árvore e à área de trabalho. */
export function EngineTag({ engine, className, style, ...props }: { engine: Engine } & ComponentProps<"span">) {
  const logo = databaseLogoOf(engineBrands[engine]);
  if (logo !== null) {
    const glyph: CSSProperties = {
      backgroundColor: logo.color ?? undefined,
      maskImage: `url("${logo.src}")`,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
    };

    return (
      <span
        aria-label={engineTags[engine]}
        className={cn(
          "inline-flex h-5 w-6 flex-none items-center justify-center rounded-sm border border-border-strong p-0.5 align-middle",
          className,
        )}
        style={{ backgroundColor: chipBackground(logo.chip), ...style }}
        {...props}
      >
        {logo.kind === "image" ? (
          <img src={logo.src} alt="" draggable={false} className="size-full object-contain" />
        ) : (
          <span className="size-full" style={glyph} />
        )}
      </span>
    );
  }

  return (
    <StatusBadge className={cn("min-w-8 justify-center font-semibold", engineColors[engine], className)} style={style} {...props}>
      {engineTags[engine]}
    </StatusBadge>
  );
}
