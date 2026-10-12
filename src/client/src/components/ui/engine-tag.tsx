import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

import { StatusBadge } from "./status-badge";

/** A sigla de cada banco, como a etiqueta do canvas a escreve. */
export const engineTags = { 1: "PG", 2: "DB2", 3: "IFX" } as const;

/** O banco, como a API o numera: PostgreSQL 1, Db2 2, Informix 3 (RN-CONN-010). */
export type Engine = keyof typeof engineTags;

/** Um banco, uma cor (`globals.css`): é a única coisa que as três cores dos bancos dizem. */
const engineColors: Record<Engine, string> = {
  1: "border-postgres text-postgres",
  2: "border-db2 text-db2",
  3: "border-informix text-informix",
};

/** A etiqueta mono PG, DB2 ou IFX, com a cor do banco. Serve à lista, à árvore e à área de trabalho. */
export function EngineTag({ engine, className, ...props }: { engine: Engine } & ComponentProps<"span">) {
  return (
    <StatusBadge className={cn("min-w-8 justify-center font-semibold", engineColors[engine], className)} {...props}>
      {engineTags[engine]}
    </StatusBadge>
  );
}
