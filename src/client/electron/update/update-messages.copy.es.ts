import type { UpdateMessagesCopy } from "./update-messages.copy";

export const updateMessagesCopyEs: UpdateMessagesCopy = {
  updater: {
    changed: "El archivo de la actualización cambió después de comprobarse.",
    serviceIsBack: ' Usa "Reiniciar" para recuperar el servicio.',
    serviceStoppedForInstall: " El servicio de Prism se detuvo para instalar.",
    packageKept: ' El paquete descargado sigue guardado: "Intentar de nuevo" lo comprueba otra vez, sin volver a descargarlo.',
    reopenToUpdate: " Para actualizar, cierra Prism y vuelve a abrirlo.",
    downloadAgain: " Descarga la actualización de nuevo.",
    dataFolderRefused: (code: string) => `El sistema no permitió escribir en la carpeta de datos de Prism (${code}).`,
    notJson: "La respuesta del servidor no es la lista de versiones (no es JSON).",
    notReleaseList: "La respuesta del servidor no es la lista de versiones.",
    diskWriteFailed: "Prism no pudo escribir la actualización en el disco.",
    removed: "Se eliminó.",
    notRemoved: "Prism no pudo eliminarlo ahora: no se usará, y se elimina la próxima vez que se abra Prism.",
    noPackage: "No hay paquete de esta versión para el sistema y la arquitectura de este equipo.",
    verifiedFileGone: (note: string) => `El archivo comprobado ya no está donde Prism lo dejó.${note} Descarga la actualización de nuevo.`,
    stopTimedOut: "El servicio de Prism no terminó a tiempo, y por eso no se inició el instalador.",
    stopFailed: "El servicio de Prism no terminó, y por eso no se inició el instalador.",
    installerFailed: (cause: string) => `No se pudo iniciar el instalador (${cause}).`,
    deliverFailed: (cause: string) => `No se pudo dejar el paquete en la carpeta de descargas (${cause}).`,
  },

  sums: {
    notesMissing: (fileName: string) => `Las notas de la versión no traen la suma SHA-256 de ${fileName}. Sin las dos sumas Prism no instala la actualización.`,
    fileMissing: (fileName: string) => `El SHA256SUMS de la versión no trae la suma de ${fileName}. Sin las dos sumas Prism no instala la actualización.`,
    mismatchBoth: (fileName: string) => `El archivo descargado (${fileName}) no coincide con la suma SHA-256 de las notas de la versión ni con la del SHA256SUMS.`,
    mismatchNotes: (fileName: string) => `El archivo descargado (${fileName}) no coincide con la suma SHA-256 de las notas de la versión.`,
    mismatchFile: (fileName: string) => `El archivo descargado (${fileName}) no coincide con la suma SHA-256 del SHA256SUMS de la versión.`,
  },

  download: {
    invalidSize: "El servidor declaró un tamaño no válido para la respuesta.",
    tooLarge: (kilobytes: number) => `La respuesta es demasiado grande: supera el límite de ${kilobytes.toLocaleString("es")} kB que Prism acepta.`,
    redirectNotFollowed: "El servidor respondió con una redirección que Prism no sigue (solo a https, y como máximo cinco seguidas).",
    redirectInQuery: "El servidor respondió con una redirección, y la consulta de versiones no sigue redirecciones.",
    status: (status: number) => `El servidor respondió ${status}.`,
    packageStatus: (status: number) => `El servidor respondió ${status} a la solicitud del paquete.`,
    canceled: "Descarga cancelada.",
    timedOut: (seconds: number) => `El servidor no respondió en el plazo de ${seconds.toLocaleString("es")} s.`,
    stalled: (seconds: number) => `El servidor dejó de responder: no llegó ningún dato en el plazo de ${seconds.toLocaleString("es")} s.`,
    moreThanDeclared: "El servidor envió más que el tamaño declarado del paquete.",
    lessThanDeclared: "La descarga terminó antes del tamaño declarado del paquete.",
  },

  install: {
    noFreeName: "La carpeta de descargas ya tiene cien archivos con el nombre del paquete.",
  },

  releases: {
    notesCut: "Las notas de esta versión se cortaron aquí: son más largas de lo que Prism muestra.",
  },
};
