import type { QueryOutcomeCopy } from "./query-outcome.copy";

export const queryOutcomeCopyEs: QueryOutcomeCopy = {
  toasts: {
    unknown: "El resultado de la sentencia es incierto. Compruébalo en la base de datos antes de ejecutarla de nuevo.",
    partial: "Lo que la sentencia escribió hasta la cancelación se conservó. Compruébalo en la base de datos antes de ejecutarla de nuevo.",
  },
};
