import { formatElapsed } from "@/lib/utils/format";

import { clockOf } from "./connection-checks.clock";
import type { ConnectionChecksCopy } from "./connection-checks.copy";

export const connectionChecksCopyEs: ConnectionChecksCopy = {
  state: {
    waiting: "Conectada, aún sin verificar",
    ok: "Respondió en la última verificación",
    failed: "No respondió",
    notConnected: "Sin sesión abierta",
  },
  tip: {
    waiting: "Conectada. La primera verificación llega después de su intervalo.",
    ok: (checkedAt: string, elapsedMs: number) => `Respondió a las ${clockOf(checkedAt)}, en ${formatElapsed(elapsedMs)}`,
    failed: (checkedAt: string, message: string, sqlState: string | null) => `No respondió a las ${clockOf(checkedAt)}${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}:\n${message}`,
    notConnected: "Sin sesión abierta: la próxima acción en el árbol o en la pestaña abre la sesión de nuevo.",
    busy: "Ocupada: se verifica en la siguiente",
  },
  failure: {
    open: (connection: string) => `Ver por qué ${connection} no respondió`,
    title: (connection: string) => `${connection} no respondió a la verificación`,
    when: (checkedAt: string, elapsedMs: number | null) => `A las ${clockOf(checkedAt)}${elapsedMs === null ? "" : `, después de ${formatElapsed(elapsedMs)}`}. El mensaje es el de la base de datos, tal como llegó.`,
    sqlState: "SQLSTATE",
    hint: "Prism no se reconecta solo: la próxima verificación lo intenta de nuevo en su intervalo, y “Desconectar” y “Conectar” abren otra sesión.",
    close: "Cerrar",
  },
  toasts: {
    failed: (connection: string) => `${connection} no respondió a la verificación`,
    recovered: (connection: string) => `${connection} volvió a responder a la verificación`,
  },
};
