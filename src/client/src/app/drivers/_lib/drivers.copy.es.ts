import type { DriversCopy } from "./drivers.copy";

export const driversCopyEs: DriversCopy = {
  title: "Drivers",
  subtitle: "Prism incluye solo el driver de PostgreSQL. Los de las otras bases de datos los descargas cuando los necesites, aceptando la licencia del fabricante.",
  loading: "Cargando los drivers…",
  loadFailed: "No se pudieron cargar los drivers.",
  retry: "Intentar de nuevo",
  stalled: { message: "La lista de drivers dejó de actualizarse.", action: "Actualizar la lista" },
  empty: { title: "Ningún driver en la lista.", hint: "Cierra y vuelve a abrir Prism. Si sigue igual, la API no trajo el catálogo de drivers." },

  groups: {
    installed: "Instalados e incluidos",
    available: "Disponibles para descargar",
    unavailable: "Sin driver para esta plataforma",
    comingSoon: "Próximamente",
  },

  states: {
    bundled: "Incluido",
    installed: "Instalado",
    available: "Disponible",
    installing: "Descargando…",
    installingPercent: (percent: number) => `Descargando… ${percent}%`,
    failed: "Falló",
    unavailable: "Sin driver para esta plataforma",
    comingSoon: "Próximamente",
  },

  row: {
    version: (version: string) => `Versión ${version}`,
    restartPending: "Reinicio pendiente",
    progress: (name: string) => `Progreso de la descarga del driver ${name}`,
    progressOf: (received: string, total: string) => `${received} de ${total}`,
    failedBecause: "Causa:",
    failedWithoutDetail: "La API no indicó la causa.",
    install: "Descargar",
    retry: "Intentar de nuevo",
    cancel: "Cancelar",
    cancelling: "Cancelando…",
    remove: "Quitar",
    installLabel: (name: string) => `Descargar el driver ${name}`,
    retryLabel: (name: string) => `Intentar de nuevo la descarga del driver ${name}`,
    cancelLabel: (name: string) => `Cancelar la descarga del driver ${name}`,
    removeLabel: (name: string) => `Quitar el driver ${name}`,
  },

  install: {
    title: (name: string) => `Descargar el driver ${name}`,
    description: "Prism descarga el driver de nuget.org, comprueba su hash y lo guarda en tu equipo. Lee la licencia del fabricante antes de aceptar.",
    vendor: "Fabricante",
    license: "Licencia",
    licenseUrl: "Texto oficial de la licencia",
    licenseUrlHint: "Prism no abre enlaces. Copia la dirección y lee el texto en tu navegador.",
    noLicense: "El catálogo no trajo un texto de licencia que Prism pueda mostrar (su dirección debe empezar por https://), por eso este driver no se puede instalar.",
    copyLink: "Copiar enlace",
    size: "Tamaño de la descarga",
    restartNotice: "Después de instalar, Prism reinicia el servicio y te pide la contraseña de nuevo. Las pestañas de SQL abiertas se cerrarán.",
    accept: "He leído y acepto la licencia del fabricante",
    cancel: "Cancelar",
    submit: "Descargar e instalar",
    submitting: "Iniciando…",
  },

  restart: {
    title: "Reinicio necesario",
    description: "Driver instalado. Prism reiniciará el servicio y te pedirá la contraseña de nuevo. Las pestañas de SQL abiertas se cerrarán.",
    removedDescription: "Driver quitado. Prism reiniciará el servicio y te pedirá la contraseña de nuevo. Las pestañas de SQL abiertas se cerrarán.",
    submit: "Reiniciar ahora",
    later: "Después",
    banner: "Prism necesita reiniciar el servicio para aplicar el cambio en los drivers. Te pide la contraseña de nuevo, y las pestañas de SQL abiertas se cerrarán.",
    bannerAction: "Reiniciar ahora",
    topBarBadge: "Reinicio pendiente",
    topBarHint: "Un driver espera el reinicio del servicio para tener efecto. Abre Configuración › Drivers.",
  },

  removeConfirm: {
    title: "Quitar driver",
    description: (name: string) =>
      `El driver ${name} se quitará de tu equipo. La eliminación surte efecto cuando Prism reinicie el servicio (te pide la contraseña de nuevo, y las pestañas de SQL abiertas se cerrarán), y las conexiones que dependen de él dejarán de abrirse.`,
    submit: "Quitar driver",
    submitting: "Quitando…",
  },

  toasts: {
    installStarted: (name: string) => `Descarga del driver ${name} iniciada.`,
    installFailed: (name: string) => `La descarga del driver ${name} falló.`,
    cancelled: (name: string) => `Descarga del driver ${name} cancelada.`,
    removed: (name: string) => `Driver ${name} quitado.`,
    inUse: "Cierra las conexiones de esa base de datos antes de quitar el driver.",
    linkCopied: "Enlace copiado.",
    linkNotCopied: "No se pudo copiar. Selecciona la dirección y cópiala con Ctrl+C.",
  },

  installDriver: "Instalar driver",
};
