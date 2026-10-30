import type { ComponentProps } from "react";

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

/** A etiqueta mono do banco, com a cor dele. Serve à lista, à árvore e à área de trabalho. */
export function EngineTag({ engine, className, ...props }: { engine: Engine } & ComponentProps<"span">) {
  return (
    <StatusBadge className={cn("min-w-8 justify-center font-semibold", engineColors[engine], className)} {...props}>
      {engineTags[engine]}
    </StatusBadge>
  );
}
