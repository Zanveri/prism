import type { UpdateCopy } from "./update.copy";

export const updateCopyEs: UpdateCopy = {
  check: "Buscar actualizaciones",
  checking: "Buscando…",
  version: (version: string) => `versión ${version}`,

  toasts: {
    upToDate: "Prism está actualizado.",
    upToDateDetail: (version: string) => `La versión instalada, ${version}, es la más reciente.`,
    upToDateWithoutPackage: (version: string, newer: string) => `La versión instalada, ${version}, es la más reciente que tiene paquete para este sistema. La versión ${newer} salió sin él; Prism ofrece la siguiente que lo tenga.`,
    noSource: "Este Prism no busca actualizaciones.",
    noSourceDetail: "Se generó sin el origen de las actualizaciones (paquete de desarrollo o generado a mano).",
    checkFailed: "No se pudo buscar actualizaciones.",
    busy: "Hay una actualización en curso.",
    blocked: "Las actualizaciones están desactivadas en esta apertura.",
    blockedDetail: "Prism se abrió con un argumento de línea de comandos que omite la comprobación del certificado o cambia la dirección de los servidores. Abre Prism sin ese argumento para actualizar.",
    requestFailed: "La actualización no pudo continuar.",
  },

  dialog: {
    title: "Nueva versión de Prism",
    installed: "Versión instalada",
    latest: "Nueva versión",
    releasedOn: (date: string) => `del ${date}`,
    notesOf: (version: string) => `Versión ${version}`,
    noNotes: "Esta versión no trae notas.",
    omitted: (count: number) => (count === 1 ? "1 versión anterior más no aparece en esta lista." : `${count} versiones anteriores más no aparecen en esta lista.`),
    sums: "Sumas de verificación",
    noSums: "Las notas de esta versión no traen sumas SHA-256: Prism no instala una actualización sin ellas.",
    trust: "La actualización se descarga de las releases del proyecto en GitHub y se comprueba con dos sumas SHA-256, y una release publicada no se puede reemplazar. Los paquetes aún no tienen la firma de un desarrollador identificado.",
    noStartupCheck: "No buscar al abrir",

    update: "Actualizar ahora",
    later: "Después",
    skip: "Omitir esta versión",
    cancel: "Cancelar",
    retry: "Intentar de nuevo",
    close: "Cerrar",
    install: "Instalar ahora",
    reveal: "Mostrar en la carpeta de descargas",

    next: {
      nsis: "Tras descargar y comprobar, Prism se cierra, instala la versión nueva y se abre de nuevo. El texto de las pestañas de SQL abiertas no se guarda.",
      nsisForAll: "Prism está instalado para todos los usuarios: tras descargar y comprobar, se cierra y Windows pide el permiso de administrador. Con él, se instala la versión nueva y Prism se abre de nuevo. Sin él, no cambia nada y se abre en la versión actual. El texto de las pestañas de SQL abiertas no se guarda.",
      manual: "Prism descarga y comprueba el paquete y, cuando lo indiques, lo deja en tu carpeta de descargas y lo muestra. La instalación la haces tú.",
      unavailable: "No hay paquete de esta versión para el sistema y la arquitectura de este equipo.",
    },

    downloading: "Descargando la actualización…",
    downloadProgress: "Progreso de la descarga de la actualización",
    received: (received: string) => `${received} recibidos`,
    receivedOf: (received: string, total: string) => `${received} de ${total}`,

    ready: "Actualización descargada y comprobada.",
    readyNsis: "Prism se cerrará para instalar la versión nueva y se abrirá de nuevo.",
    readyManual: "Falta dejar el paquete en tu carpeta de descargas: es el botón de abajo.",

    installing: "Instalando la versión nueva.",
    installingDetail: "Prism se cerrará y se abrirá de nuevo solo. No hace falta hacer nada.",
    installingDetailForAll: "Prism se cerrará y Windows pedirá el permiso de administrador. Con él, se instala la versión nueva y Prism se abre de nuevo.",

    failed: "La actualización no se completó.",

    delivered: (fileName: string) => `El paquete comprobado está en tu carpeta de descargas: ${fileName}`,
  },

  notice: {
    title: (version: string) => `La versión ${version} no se instaló.`,
    forAll: (current: string) => `Prism sigue en la versión ${current}. Está instalado para todos los usuarios, y la actualización pide el permiso de administrador de Windows. Para intentarlo de nuevo, usa “Buscar actualizaciones”.`,
    forMe: (current: string) => `Prism sigue en la versión ${current}. El instalador terminó sin actualizarlo. Para intentarlo de nuevo, usa “Buscar actualizaciones”.`,
  },

  beta: {
    label: "Recibir versiones beta",
    hint: "Una versión beta sale con cada cambio aceptado en el proyecto, antes de la estable, y puede tener defectos. Desactivado, Prism ofrece solo las versiones estables. Activarlo o desactivarlo vale desde la próxima búsqueda y no instala nada.",
    badge: "beta",
    offered: "(beta)",
    warning: "Versión beta: llega antes que la estable y puede tener defectos.",
    warningDetail: "Para recibir solo las versiones estables, desactiva “Recibir versiones beta” en Configuración › Actualizaciones.",
    macHint: "En macOS las betas no tienen paquete: las actualizaciones llegan con las versiones estables, y activar esta opción no cambia lo que Prism ofrece aquí.",
  },

  instructions: {
    AppImage: "Cierra Prism, da permiso de ejecución al archivo y ábrelo en lugar del AppImage anterior.",
    deb: "Cierra Prism e instala el paquete con el gestor del sistema (por ejemplo, sudo apt install ./ seguido del nombre del archivo).",
    rpm: "Cierra Prism e instala el paquete con el gestor del sistema (por ejemplo, sudo dnf install ./ seguido del nombre del archivo).",
    "tar.gz": "Cierra Prism y extrae el archivo sobre la carpeta donde está Prism.",
    dmg: "Cierra Prism, abre el archivo y arrastra Prism a la carpeta Aplicaciones, reemplazando el actual.",
    zip: "Cierra Prism y extrae el archivo sobre la carpeta donde está Prism.",
    nsis: "Cierra Prism y abre el instalador.",
  },
};
