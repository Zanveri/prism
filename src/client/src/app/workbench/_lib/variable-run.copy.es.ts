import { formatCount } from "@/lib/utils/format";

import type { VariableRunCopy } from "./variable-run.copy";

export const variableRunCopyEs: VariableRunCopy = {
  errors: {
    title: "Errores en las variables",
    line: (line: number) => `Línea ${line.toLocaleString("es")}`,
    hint: "Enter o el clic lleva el cursor al lugar del error.",
    list: "Los errores encontrados en las variables",
  },
  refused: {
    script: (count: number) => `El script no se ejecutó: ${formatCount(count, "error", "errores")} en las variables.`,
    command: (count: number) => `La sentencia no se ejecutó: ${formatCount(count, "error", "errores")} en las variables.`,
    declaration: (count: number) => `La declaración no se evaluó: ${formatCount(count, "error", "errores")} en las variables.`,
  },
  skipDisabled: (name: string) => `Sin el valor de ${name}, las sentencias que la usan no pueden ejecutarse.`,
  declaration: "Declaración",
  declarationTitle: (number: number, total: number) => `La declaración ${number.toLocaleString("es")} de ${total.toLocaleString("es")} falló`,
};
