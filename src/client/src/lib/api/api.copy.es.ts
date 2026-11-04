import type { ApiCopy } from "./api.copy";

export const apiCopyEs: ApiCopy = {
  noResponse: "Sin respuesta de la API.",
  invalidResponse: "La API respondió en un formato inesperado.",
  unexpectedError: "Error inesperado.",
  vaultLocked: "Caja fuerte bloqueada. Inicia sesión de nuevo.",
  outsideElectron: {
    export: "Exportar solo funciona en la app de Prism.",
    import: "Importar solo funciona en la app de Prism.",
    dbeaver: "Importar desde DBeaver solo funciona en la app de Prism.",
  },
};
