import type { ApiProcessCopy } from "./api-process.copy";

export const apiProcessCopyEn: ApiProcessCopy = {
  notAnnounced: (seconds: number) => `The API did not announce its port within ${seconds.toLocaleString("en")} s.`,
  notStarted: (command: string, message: string) => `Could not start the API (${command}): ${message}`,
  exitedEarly: (code: number | null) => `The API exited with code ${code} before announcing its port.`,
  exited: (code: number | null) => `The API process ended (code ${code}).`,
  notRunning: "The Prism API is not running.",
};
