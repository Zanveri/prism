import type { HistoryCopy } from "./history.copy";

export const historyCopyEs: HistoryCopy = {
  title: "Historial",
  toolbarButton: "Historial",
  toolbarTooltip: "Historial (Ctrl+Shift+H)",
  close: "Cerrar historial",
  searchPlaceholder: "Buscar en la sentencia…",
  clearSearch: "Borrar búsqueda",
  scopeAria: "Alcance del historial",
  scopeThisConnection: "Esta conexión",
  scopeAllConnections: "Todas las conexiones",
  today: "Hoy",
  yesterday: "Ayer",
  outcomes: {
    ok: "completado",
    succeeded: "completado",
    error: "error",
    cancelled: "cancelado",
    interrupted: "interrumpido",
    refused: "rechazado",
    inProgress: "interrumpido",
    running: "interrumpido"
  },
  rowsFormat: (count: number) =>
    count === 1 ? "1 fila" : `${count.toLocaleString("es")} filas`,
  durationFormat: (ms: number | null) => {
    if (ms === null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  },
  moreLines: (extra: number) => (extra === 1 ? "+1 línea" : `+${extra} líneas`),
  repeatBadge: (repeat: number) => `×${repeat}`,
  repeatTitle: (repeat: number) => `Ejecutado ${repeat} veces seguidas`,
  empty: "Aún no hay sentencias registradas.",
  emptyFiltered: "No se encontró ninguna sentencia para esta búsqueda.",
  loading: "Cargando historial…",
  loadMore: "Cargar más",
  insertAtCursor: "Insertar en el cursor",
  insertAtCursorHint: "Insertar en el cursor (Enter)",
  openInNewTab: "Abrir en una pestaña nueva",
  openInNewTabHint: "Abrir en una pestaña nueva (Shift+Enter)",
  copy: "Copiar",
  copied: "Copiado",
  copyHint: "Copiar (Ctrl+C)",
  removeFromHistory: "Quitar del historial",
  removeFromHistoryHint: "Quitar del historial (Delete)",
  clearConnectionTrigger: "Borrar el historial de esta conexión",
  clearConnectionConfirmTitle: (name: string) =>
    `¿Borrar el historial de ${name}?`,
  clearConnectionConfirmNote:
    "Los registros siguen en la Auditoría.",
  clearConnectionConfirmButton: "Borrar historial",
  clearConnectionCancelButton: "Cancelar"
};
