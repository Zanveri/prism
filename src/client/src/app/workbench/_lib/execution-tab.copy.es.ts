import type { ExecutionTabCopy } from "./execution-tab.copy";

export const executionTabCopyEs: ExecutionTabCopy = {
  hint: (name: string, connection: string | null, database: string | undefined) => `Ejecución de ${name}${connection === null ? "" : ` en ${connection}`}${database === undefined ? "" : ` · ${database}`}`,
  label: (name: string) => `Ejecución de ${name}`,
  ranAt: (time: string) => `Ejecutado a las ${time}`,
  rerun: "Ejecutar de nuevo",
  rerunLabel: "Ejecutar el script de nuevo",
  rerunHint: (shortcut: string) => `Ejecutar el script de nuevo, con los mismos valores (${shortcut})`,
  change: "Cambiar los valores…",
  changeHint: (shortcut: string) => `Cambiar los valores… (${shortcut})`,
  openScript: "Abrir el script",
  cancel: "Cancelar",
  values: "Valores usados",
  sqlChip: "Entra en la sentencia tal como está, sin comillas.",
  missing: (name: string) => `El script ${name} ya no existe.`,
  newTab: "Ejecutar en una pestaña nueva",
};
