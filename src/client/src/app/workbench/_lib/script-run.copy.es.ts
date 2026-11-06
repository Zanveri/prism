import { formatCount, formatElapsed } from "@/lib/utils/format";

import type { ScriptRunCopy } from "./script-run.copy";

const inTab = (tab: string | null) => (tab === null ? "" : ` en la pestaña ${tab}`);

export const scriptRunCopyEs: ScriptRunCopy = {
  editor: {
    run: "Ejecutar script",
    shortcut: "Alt+X",
    shortcutMac: "Cmd+Option+X",
    title: (shortcut: string) => `Ejecuta las sentencias de la selección o, sin selección, de todo el texto, una tras otra (${shortcut})`,
    withValues: "Ejecutar con valores…",
    withValuesTitle: (shortcut: string) => `Ejecutar con valores… (${shortcut})`,
    withValuesShortcut: "Shift+Alt+X",
    withValuesShortcutMac: "Shift+Cmd+Option+X",
  },

  tabs: {
    label: "Resultados del script",
    result: (number: number, head: string) => `${number} · ${head}`,
    statistics: "Estadísticas",
    variables: "Variables",
  },

  progress: (current: number, total: number) => `Ejecutando ${current.toLocaleString("es")} de ${total.toLocaleString("es")}…`,
  paused: (current: number, total: number) => `Detenido en la sentencia ${current.toLocaleString("es")} de ${total.toLocaleString("es")}`,

  statistics: {
    label: "Estadísticas del script",
    caption: "Las sentencias del script, en orden",
    number: "Nº",
    command: "Sentencia",
    status: "Estado",
    rows: "Filas",
    time: "Tiempo",
    statuses: { pending: "en cola", running: "ejecutando…", ok: "ok", error: "error", skipped: "omitido", cancelled: "cancelado", notRun: "no ejecutado" },
    read: (count: number, more: boolean) => (more ? `primeras ${formatCount(count, "fila", "filas")}` : formatCount(count, "fila", "filas")),
    returned: (total: number) => formatCount(total, "fila devuelta", "filas devueltas"),
    affected: (count: number) => (count < 0 ? "—" : formatCount(count, "fila afectada", "filas afectadas")),
    notKept: "resultado no guardado",
    elapsed: (elapsedMs: number) => formatElapsed(elapsedMs),
    sqlState: "SQLSTATE",
    executed: (ok: number, total: number) => `Sentencias ejecutadas: ${ok.toLocaleString("es")} de ${total.toLocaleString("es")}`,
    declarationsEvaluated: (ok: number, total: number) => `Declaraciones evaluadas: ${ok.toLocaleString("es")} de ${total.toLocaleString("es")}`,
    declaration: "declaración",
    withErrors: (count: number) => `Con error: ${count.toLocaleString("es")}`,
    changed: (count: number, returning = 0) =>
      `Filas modificadas: ${count.toLocaleString("es")}${returning === 0 ? "" : ` (sin contar ${returning === 1 ? "1 sentencia que escribió y devolvió filas" : `${returning.toLocaleString("es")} sentencias que escribieron y devolvieron filas`})`}`,
    totalTime: (elapsedMs: number) => `Tiempo total: ${formatElapsed(elapsedMs)}`,
    dropped: (count: number, cap: number) =>
      `${count === 1 ? "El resultado de 1 sentencia no se guardó" : `Los resultados de ${count.toLocaleString("es")} sentencias no se guardaron`}: el script guarda las pestañas de las ${cap} primeras sentencias que devuelven filas, y la de la última.`,
    before: (count: number) => `${formatCount(count, "sentencia", "sentencias")} antes de estas, que aparecen cuando el script termine.`,
    after: (count: number) => `${formatCount(count, "sentencia más", "sentencias más")} en cola.`,
  },

  kept: {
    note: "El cursor de este resultado se cerró cuando se ejecutó la sentencia siguiente. Cargar más, Contar total, el filtro y la actualización automática valen en el resultado de la última sentencia.",
    runAlone: "Ejecutar esta sentencia",
    runAloneBusy: "Ejecutar esta sentencia. No disponible: hay una sentencia en curso en la pestaña.",
  },

  error: {
    title: (number: number, total: number) => `La sentencia ${number.toLocaleString("es")} de ${total.toLocaleString("es")} falló`,
    description: "El script se detuvo en esta sentencia. Elige cómo seguir.",
    command: "Sentencia",
    stop: "Detener",
    retry: "Intentar de nuevo",
    skip: "Omitir",
    skipAll: "Omitir todos los errores",
    sessionLost: "La sesión con la base de datos se cayó en medio del script, y Prism no la reabre: lo que las sentencias anteriores dejaron en ella se perdió. Ejecuta el script de nuevo.",
    waiting: "El script se detuvo en un error y espera la respuesta",
  },

  toasts: {
    done: (tab: string | null, total: number, declarations = 0) =>
      `Script ejecutado${inTab(tab)}: ${[...(total === 0 && declarations > 0 ? [] : [formatCount(total, "sentencia", "sentencias")]), ...(declarations === 0 ? [] : [formatCount(declarations, "declaración evaluada", "declaraciones evaluadas")])].join(" y ")}.`,
    doneWithErrors: (tab: string | null, errors: number, ok: number, total: number) =>
      `Script ejecutado${inTab(tab)} con ${formatCount(errors, "error", "errores")}: ${ok.toLocaleString("es")} de ${formatCount(total, "sentencia ejecutada", "sentencias ejecutadas")}.`,
    stopped: (tab: string | null, ok: number, total: number) => `Script detenido${inTab(tab)}: ${ok.toLocaleString("es")} de ${formatCount(total, "sentencia ejecutada", "sentencias ejecutadas")}.`,
    cancelled: (tab: string | null, ok: number, total: number) => `Script cancelado${inTab(tab)}: ${ok.toLocaleString("es")} de ${formatCount(total, "sentencia ejecutada", "sentencias ejecutadas")}.`,
  },
};
