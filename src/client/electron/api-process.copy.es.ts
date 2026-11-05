import type { ApiProcessCopy } from "./api-process.copy";

export const apiProcessCopyEs: ApiProcessCopy = {
  notAnnounced: (seconds: number) => `La API no anunció el puerto en ${seconds.toLocaleString("es")} s.`,
  notStarted: (command: string, message: string) => `No se pudo iniciar la API (${command}): ${message}`,
  exitedEarly: (code: number | null) => `La API salió con el código ${code} antes de anunciar el puerto.`,
  exited: (code: number | null) => `El proceso de la API terminó (código ${code}).`,
  notRunning: "La API de Prism no se está ejecutando.",
};
