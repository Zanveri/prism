import { formatCount } from "@/lib/utils/format";

import type { NavigatorCopy } from "./navigator.copy";

export const navigatorCopyEs: NavigatorCopy = {
  toolbar: {
    label: "Acciones del árbol de conexiones",
    newConnection: "Nueva conexión",
    newConnectionIn: (folder: string) => `Nueva conexión en ${folder}`,
    newFolder: "Nueva carpeta",
    newFolderIn: (folder: string) => `Nueva carpeta en ${folder}`,
    connect: "Conectar",
    connectTo: (connection: string) => `Conectar ${connection}`,
    disconnect: "Desconectar",
    disconnectFrom: (connection: string) => `Desconectar ${connection}`,
    refresh: "Actualizar",
    refreshItem: (name: string) => `Actualizar ${name}`,
    collapseAll: "Contraer todo",
    hide: "Ocultar el navegador",
  },

  layout: {
    toggle: "Mostrar el navegador",
    show: "Mostrar el navegador",
    hide: "Ocultar el navegador",
  },

  firstUse: {
    title: "Ninguna conexión guardada",
    hint: "Crea la primera conexión para navegar por los objetos de la base de datos y ejecutar SQL. El formulario empieza por la elección de la base de datos: PostgreSQL, Db2 o Informix.",
    action: "Nueva conexión",
  },

  empty: {
    hint: "Crea la primera con “Nueva conexión” en la barra de arriba. Las carpetas organizan las conexiones.",
  },

  row: {
    connectionHint: (engine: string, host: string, port: number, database: string) => `${engine} · ${host}:${port} / ${database}`,
  },

  environmentFilter: {
    label: "Filtrar por entorno",
    all: "Todos los entornos",
    none: "Sin entorno",
    clear: "Quitar el filtro de entorno",
    nothingIn: (environment: string) => `Ninguna conexión en ${environment}.`,
    nothingWithout: "Ninguna conexión sin entorno.",
  },

  connectedFilter: {
    label: "Solo las conectadas",
    count: (count: number) => (count === 0 ? "Ninguna conectada" : formatCount(count, "conectada", "conectadas")),
    showOnly: "Mostrar solo las conexiones conectadas, con las carpetas del camino hasta ellas",
    showAll: "Mostrar todas las conexiones",
    nothing: "Ninguna conexión conectada.",
    nothingIn: (environment: string) => `Ninguna conexión conectada en ${environment}.`,
    nothingWithout: "Ninguna conexión conectada sin entorno.",
    clear: "Mostrar todas",
  },

  menu: {
    label: "Acciones del navegador",
    newConnection: "Nueva conexión",
    newFolder: "Nueva carpeta",
    moveConnection: "Mover",
    deleteConnection: "Eliminar",
    renameConnection: "Renombrar",
    duplicateConnection: "Duplicar conexión",
  },

  typeAhead: {
    typed: (text: string) => `Ir a: ${text}`,
    none: (text: string) => `Ningún elemento empieza por “${text}”`,
  },
};
