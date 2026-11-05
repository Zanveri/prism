import type { Confirmation } from "@/app/connections/_lib/connections.schema";
import { formatCount } from "@/lib/utils/format";

import type { CommandConfirmationCopy } from "./command-confirmation.copy";
import type { Irreversible } from "./irreversible";

const levelName: Record<Confirmation, string> = { irreversible: "Solo sentencias irreversibles", all: "Todas las sentencias" };

const ofTarget = (target: string | null, fallback: string) => (target === null ? fallback : target);

export const commandConfirmationCopyEs: CommandConfirmationCopy = {
  environment: (name: string) => `Entorno: ${name}`,
  place: (connection: string, database: string) => `${connection} / ${database}`,

  titles: {
    irreversible: "¿Ejecutar sentencia irreversible?",
    command: "¿Ejecutar sentencia?",
    scriptIrreversible: "¿Ejecutar script con sentencias irreversibles?",
    script: "¿Ejecutar script?",
    save: "¿Guardar los cambios?",
    autoRefresh: "¿Activar la actualización automática?",
  },

  does: (irreversible: Irreversible): string => {
    const target = irreversible.target;
    switch (irreversible.kind) {
      case "delete":
        return `Este DELETE no tiene WHERE: elimina todas las filas de ${ofTarget(target, "una tabla")}.`;
      case "update":
        return `Este UPDATE no tiene WHERE: modifica todas las filas de ${ofTarget(target, "una tabla")}.`;
      case "truncate":
        return `Este TRUNCATE elimina todas las filas de ${ofTarget(target, "una tabla")}.`;
      case "drop":
        return `Este DROP elimina ${ofTarget(target, "un objeto de la base de datos")}, y lo que elimina no vuelve.`;
      case "alterDrop":
        return `Este ALTER tiene un DROP: elimina una parte de ${ofTarget(target, "un objeto de la base de datos")} que no vuelve.`;
      case "sqlVariable":
        return `Esta sentencia usa ${ofTarget(target, "una variable sql")}, cuyo texto entra en la sentencia tal cual y puede quitar un WHERE: puede modificar o eliminar más filas de lo que parece.`;
    }
  },

  script: {
    all: (total: number) =>
      total === 1
        ? "La sentencia del script pide confirmación. Una vez confirmada, se ejecuta sin preguntar de nuevo."
        : `Todas las ${formatCount(total, "sentencia", "sentencias")} del script piden confirmación. Una vez confirmado, el script se ejecuta hasta el final sin preguntar de nuevo.`,
    some: (count: number, total: number) =>
      `${count === 1 ? "Una sentencia" : `${count.toLocaleString("es")} sentencias`} de ${total.toLocaleString("es")} ${count === 1 ? "es irreversible" : "son irreversibles"}. Una vez confirmado, el script se ejecuta hasta el final sin preguntar de nuevo.`,
    number: (number: number) => `Sentencia ${number.toLocaleString("es")}`,
  },

  filter: (filter: string) => `Con el filtro del resultado: ${filter}`,
  queries: (count: number) => (count === 1 ? "Antes, se ejecuta la consulta de la variable:" : "Antes, se ejecutan las consultas de las variables:"),

  save: {
    description: (count: number) => `${formatCount(count, "cambio va", "cambios van")} a la base de datos, en una transacción. Antes de guardar, puedes ver las sentencias.`,
    viewSql: "Ver SQL",
  },

  autoRefresh: "Una vez activada, ejecuta esta sentencia de nuevo en cada intervalo, sin preguntar, hasta que se desactive.",

  why: (connection: string, level: Confirmation, folder: string | null): string =>
    folder === null ? `Ves este aviso porque la conexión ${connection} tiene la protección “${levelName[level]}”.` : `Ves este aviso porque la conexión ${connection} hereda de la carpeta ${folder} la protección “${levelName[level]}”.`,

  confirm: { command: "Ejecutar de todos modos", script: "Ejecutar script", save: "Guardar de todos modos", autoRefresh: "Activar de todos modos" },
  cancel: "Cancelar",
};
