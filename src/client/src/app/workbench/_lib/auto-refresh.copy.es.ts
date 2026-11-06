import type { AutoRefreshCopy } from "./auto-refresh.copy";

export const autoRefreshCopyEs: AutoRefreshCopy = {
  menu: {
    label: "Actualizar automáticamente",
    every: (interval: string) => `Cada ${interval}`,
    custom: "Personalizado…",
    customChosen: (interval: string) => `Personalizado (${interval})…`,
    off: "Desactivar",
    notApplicable: (reason: string) => `No se aplica: ${reason}.`,
  },

  reasons: {
    busy: "hay una sentencia en curso en la pestaña",
    writes: "la sentencia escribe en la base de datos, y solo una lectura se actualiza sola",
    noRows: "no hay filas de una lectura en pantalla",
    disconnected: "la pestaña no está conectada; usa Actualizar (F5) para conectar",
  },

  bar: {
    button: "Actualizar automáticamente",
    unavailable: (reason: string) => `Actualizar automáticamente. No se aplica: ${reason}.`,
    group: "Actualización automática",
    every: (interval: string) => `Se actualiza cada ${interval}`,
    last: (time: string) => `última a las ${time}`,
    running: "actualizando…",
    paused: "en pausa mientras se usa la cuadrícula",
    change: "Cambiar el intervalo de la actualización automática",
    off: "Desactivar la actualización automática",
  },

  stopped: {
    failed: "La actualización automática se detuvo: la sentencia dio error.",
    cancelled: "La actualización automática se detuvo: la sentencia fue cancelada.",
    notRun: "La actualización automática se detuvo: la sentencia no se pudo ejecutar.",
    writes: "La actualización automática se detuvo: la sentencia escribió en la base de datos.",
    disconnected: "La actualización automática se detuvo: la sesión con la base de datos se cayó.",
  },

  dialog: {
    title: "Actualizar automáticamente",
    description: "La sentencia del resultado se ejecuta de nuevo en cada intervalo, mientras el resultado está a la vista. El intervalo va de 1 a 3.600 segundos (1 hora).",
    seconds: "Intervalo en segundos",
    invalid: "Usa un número entero de segundos, de 1 a 3.600.",
    submit: "Activar",
    cancel: "Cancelar",
  },
};
