import type { DbeaverSourceCopy } from "./dbeaver-source.copy";

export const dbeaverSourceCopyEs: DbeaverSourceCopy = {
  dialogTitle: "Elegir la carpeta de DBeaver",
  symlink: "DBeaver guarda esta carpeta detrás de un acceso directo (enlace simbólico), y Prism no sigue accesos directos. Elige la carpeta real.",
  unreadable: (reason: string) => `No se pudieron leer los archivos de DBeaver: ${reason}.`,
  swapped: "el archivo se reemplazó durante la copia",
};
