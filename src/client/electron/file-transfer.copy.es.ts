import type { FileTransferCopy } from "./file-transfer.copy";

export const fileTransferCopyEs: FileTransferCopy = {
  allFiles: "Todos los archivos",

  source: {
    dialogTitle: "Importar datos",
    filters: {
      data: "Archivos de datos (*.csv, *.tsv, *.tab, *.txt, *.json, *.xlsx, *.xlsm)",
      delimited: "CSV y TSV (*.csv, *.tsv, *.tab, *.txt)",
      json: "JSON (*.json)",
      excel: "Excel (*.xlsx, *.xlsm)",
    },
    unreadable: {
      permission: "el sistema no da permiso para leer el archivo",
      busy: "el archivo está en uso por otro programa",
      missing: "el archivo ya no existe",
      io: "el disco dio un error de lectura",
      other: (code: string | undefined) => `error ${code ?? "sin código"}`,
    },
    failure: {
      diskFull: "No hay espacio en la carpeta de datos de Prism para copiar el archivo.",
      tooLarge: "El archivo superó los 2 GB durante la copia.",
      unreadable: (reason: string) => `No se pudo leer el archivo: ${reason}.`,
      other: (code: string | undefined) => `No se pudo copiar el archivo (${code ?? "sin código"}).`,
    },
  },

  desk: {
    formats: { csv: "CSV", tsv: "TSV", php: "PHP", xml: "XML", html: "HTML", json: "JSON", md: "Markdown", sql: "SQL", txt: "Texto", xlsx: "Excel", zip: "ZIP" },
    delivery: {
      diskFull: "no hay espacio en el disco de destino",
      notWritable: "sin permiso para escribir en la carpeta elegida",
      folderMissing: "la carpeta elegida ya no existe",
      inUse: "el archivo está abierto en otro programa",
      other: (code: string | undefined) => `el sistema rechazó la escritura (${code ?? "sin código"})`,
    },
    clipboardReadFailed: (code: string | undefined) => `No se pudo leer el texto exportado (${code ?? "sin código"}).`,
  },
};
