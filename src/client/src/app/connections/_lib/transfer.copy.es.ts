import { formatCount } from "@/lib/utils/format";

import type { TransferCopy } from "./transfer.copy";

const connections = (count: number) => formatCount(count, "conexión", "conexiones");
const folders = (count: number) => formatCount(count, "carpeta", "carpetas");

export const transferCopyEs: TransferCopy = {
  export: {
    title: "Exportar conexiones",
    description: "Elige las conexiones y lo que va de cada una. El archivo sale cifrado con una contraseña de exportación, que creas aquí.",
    tree: "Carpetas y conexiones de la caja fuerte",
    noUser: "sin usuario",
    user: (userName: string) => `usuario ${userName}`,
    credentials: {
      label: (name: string) => `Lo que va de ${name}`,
      none: "Sin usuario ni contraseña",
      user: "Solo el usuario",
      userAndPassword: "Usuario y contraseña",
      noUserHint: "La conexión no tiene usuario guardado.",
      noPasswordHint: "La conexión no tiene contraseña guardada.",
      bulk: "Para las marcadas:",
      bulkSearching: "Para las marcadas que muestra la búsqueda:",
    },
    passwordsWarning: (count: number) =>
      `Las contraseñas de base de datos de ${connections(count)} van en el archivo. Quien tenga el archivo y la contraseña de exportación entra con ellas en esas bases de datos. Para exportarlas, Prism te pide tu contraseña de Prism.`,
    passphrase: "Contraseña de exportación",
    passphraseAgain: "Repite la contraseña de exportación",
    showPassphrase: "Mostrar contraseña",
    passphraseHint: "No es tu contraseña de Prism. Quien importe el archivo la va a necesitar: pásala por otro medio, y nunca en el mismo mensaje que el archivo. Sin ella el archivo no se abre, y no hay forma de recuperarla.",
    passphraseErrors: {
      required: "Crea una contraseña de exportación.",
      tooShort: "La contraseña de exportación debe tener al menos 12 caracteres.",
      tooLong: "La contraseña de exportación puede tener hasta 128 caracteres.",
      edgeSpace: "La contraseña de exportación no puede empezar ni terminar con espacio.",
      control: "La contraseña de exportación no puede tener caracteres de control.",
      mismatch: "Las dos contraseñas no son iguales.",
      samePrismPassword: "Usa una contraseña de exportación distinta de tu contraseña de Prism.",
    },
    limits:
      "El archivo superaría los límites de la importación: hasta 2.000 conexiones, 2.000 carpetas, 5 MiB y 32 niveles de carpetas desde la raíz. Exporta por partes; lo que está a más de 32 niveles de la raíz solo sale si se mueve más cerca de ella.",
    counter: (marked: number, withPassword: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nada marcado";
      const connectionPart =
        marked === 0 ? "Ninguna conexión marcada" : `${formatCount(marked, "conexión marcada", "conexiones marcadas")}${withPassword === 0 ? "" : marked === 1 ? ", con contraseña" : `, ${withPassword} con contraseña`}`;
      return inFile === 0 ? connectionPart : `${connectionPart} · ${folders(inFile)} en el archivo`;
    },
    nothingMarked: "Marca al menos una conexión o carpeta.",
    cancel: "Cancelar",
    submit: "Exportar…",
    submitting: "Exportando…",
    userPassword: {
      description: "Para exportar las contraseñas de base de datos, escribe tu contraseña de Prism.",
      change: (count: number, name: string | null) => (count === 1 && name !== null ? `Exportar ${name} con la contraseña` : `Exportar ${connections(count)} con la contraseña`),
      submit: "Confirmar y exportar",
    },
    gone: "Una carpeta o conexión marcada ya no existe. La lista se leyó de nuevo: revisa lo que está marcado y exporta otra vez.",
    toast: (result: { folders: number; connections: number; withPassword: number }) => {
      if (result.connections === 0) return `${formatCount(result.folders, "carpeta exportada", "carpetas exportadas")}, sin conexiones.`;
      const exported = formatCount(result.connections, "conexión exportada", "conexiones exportadas");
      if (result.withPassword === 0) return `${exported}.`;
      if (result.connections === 1) return `${exported}, con contraseña.`;
      return result.withPassword === result.connections ? `${exported}, todas con contraseña.` : `${exported}, ${result.withPassword} con contraseña.`;
    },
  },

  tree: {
    search: "Buscar carpetas y conexiones",
    markAll: "Marcar todas",
    unmarkAll: "Desmarcar todas",
    contents: (name: string) => `Contenido de ${name}`,
    inFolder: (path: string) => `En la carpeta ${path}`,
    nothingFound: (query: string) => `No se encontró nada para “${query}”.`,
    noName: "(sin nombre)",
  },

  import: {
    title: "Importar conexiones",
    description: "Elige un archivo exportado por Prism y escribe la contraseña de exportación que quien lo exportó te pasó.",
    file: "Archivo",
    chooseFile: "Elegir archivo…",
    noFile: "Ningún archivo elegido",
    chosen: (name: string, size: string) => `${name}, ${size}`,
    fileRequired: "Elige el archivo exportado.",
    unreadable: "No se pudo leer este archivo.",
    passphrase: "Contraseña de exportación",
    showPassphrase: "Mostrar contraseña",
    passphraseErrors: {
      required: "Escribe la contraseña de exportación.",
      tooLong: "La contraseña de exportación tiene hasta 128 caracteres.",
      wrong: "La contraseña de exportación no coincide, o el archivo fue modificado.",
    },
    destination: "Dónde colocar",
    root: "En la raíz del navegador",
    destinationGone: "La carpeta elegida ya no existe. Elige otro lugar.",
    open: "Abrir archivo",
    opening: "Abriendo…",
    refreshing: "Actualizando la vista previa…",
    placeholder: "Elige el archivo y escribe la contraseña para ver lo que trae.",
    fileErrors: {
      limits: "Este archivo supera los límites de la importación: hasta 5 MiB, 2.000 conexiones, 2.000 carpetas y 32 niveles de carpetas.",
      invalid: "Este archivo no es una exportación de conexiones de Prism, o está dañado.",
      newer: "Este archivo fue exportado por una versión más nueva de Prism. Actualiza Prism para importarlo.",
    },
    preview: {
      label: "Lo que trae el archivo",
      tree: "Carpetas y conexiones del archivo",
      summary: (summary: { connections: number; folders: number; withUser: number; withPassword: number }) => {
        if (summary.connections === 0 && summary.folders === 0) return "El archivo no tiene carpetas ni conexiones.";
        if (summary.connections === 0) return `El archivo tiene ${folders(summary.folders)}, sin conexiones.`;
        const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} en ${folders(summary.folders)}`;
        if (summary.withUser === 0 && summary.withPassword === 0) return `El archivo tiene ${where}, sin usuario ni contraseña.`;
        const parts = [summary.withUser === 0 ? null : `${summary.withUser} con usuario`, summary.withPassword === 0 ? null : `${summary.withPassword} con contraseña`].filter((part) => part !== null);
        return `El archivo tiene ${where}: ${parts.join(", ")}.`;
      },
      servers: "Revisa los servidores antes de importar. La contraseña que escribas en una de estas conexiones va al servidor que indica el archivo.",
      address: (host: string, port: string, database: string) => `${host}:${port} / ${database}`,
      user: (userName: string) => `usuario ${userName}`,
      ssh: (server: string) => `vía SSH ${server}`,
      ssl: (mode: string | null) => (mode === null ? "SSL" : `SSL ${mode}`),
      proxy: (server: string) => `proxy ${server}`,
      withPassword: "con contraseña",
      withoutPassword: "sin contraseña",
      noCredentials: "sin usuario ni contraseña",
      tags: {
        existing: "ya existe",
        existingFolder: "Ya existe una carpeta con este nombre en este lugar: lo que viene dentro entra en ella, y ella se queda como está, con su color, entorno y protecciones.",
        existingConnection: "Ya existe una conexión con este nombre en este lugar. La importación nunca cambia ni sobrescribe una conexión que ya existe.",
        renamed: (copyName: string) => `entra como ${copyName}`,
        skipped: "no se importará",
        readOnly: "queda en solo lectura",
        irreversible: "confirma las irreversibles",
        all: "confirma todas las sentencias",
        environment: (name: string) => `entorno ${name}`,
        ownQuery: "consulta propia",
        ownQueryDropped: "consulta propia, no se mantiene",
        invalid: "no se puede importar",
      },
      why: {
        by: (folder: string | null) => (folder === null ? "" : ` por la carpeta ${folder}`),
        readOnly: (by: string) => `En el archivo era de solo lectura${by}. En el lugar elegido nada la protegería: la importación guarda el solo lectura en ella misma.`,
        irreversible: (by: string) => `En el archivo confirmaba las sentencias irreversibles${by}. En el lugar elegido la confirmación sería más débil: la importación guarda la del origen en ella misma.`,
        all: (by: string) => `En el archivo confirmaba todas las sentencias${by}. En el lugar elegido la confirmación sería más débil: la importación guarda la del origen en ella misma.`,
        environment: (name: string, by: string) => `En el archivo mostraba el entorno ${name}${by}. En el lugar elegido mostraría otro, o ninguno: la importación guarda el entorno ${name} en ella misma.`,
      },
      query: (query: { text: string; interval: number; enabled: boolean; postgres: boolean }) => {
        const when = query.enabled
          ? `Prism ejecuta esta consulta por sí solo, cada ${query.interval} segundos, mientras la conexión esté conectada, y también en “Probar conexión”: ${query.text}.`
          : `Prism ejecuta esta consulta en “Probar conexión”, y por sí solo, cada ${query.interval} segundos, si se activa la verificación: ${query.text}.`;
        return query.postgres ? `${when} Revísala antes de importar.` : `${when} Prism solo revisa el texto: una función llamada dentro de un SELECT puede escribir sin que el texto lo muestre. Revísala antes de importar.`;
      },
      invalidFolder: (name: string) => `La carpeta ${name} no se puede importar.`,
    },
    conflicts: {
      legend: "Cuando ya exista una conexión con el mismo nombre en el mismo lugar:",
      rename: "Importar con otro nombre",
      skip: "No importar",
      count: (count: number) => (count === 1 ? "1 conexión ya existe en el lugar elegido." : `${connections(count)} ya existen en el lugar elegido.`),
    },
    queries: {
      keep: "Mantener las consultas de verificación del archivo",
      hint: (count: number) =>
        count === 1
          ? "1 conexión trae una consulta de verificación propia, que Prism ejecuta por sí solo. Desmarcada, entra con la consulta de la base de datos."
          : `${connections(count)} traen una consulta de verificación propia, que Prism ejecuta por sí solo. Desmarcada, entran con la consulta de la base de datos.`,
    },
    counter: (marked: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nada marcado";
      if (marked === 0) return formatCount(inFile, "carpeta marcada", "carpetas marcadas");
      if (inFile === 0) return formatCount(marked, "conexión marcada", "conexiones marcadas");
      return `${connections(marked)} y ${folders(inFile)} marcadas`;
    },
    cancel: "Cancelar",
    submit: "Importar",
    submitting: "Importando…",
    toasts: {
      imported: (result: { connections: number; folders: number; renamed: number }) => {
        const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
        const word = result.connections + result.folders === 1 ? "importada" : "importadas";
        return `${parts.join(" y ")} ${word}${result.renamed === 0 ? "" : `, ${result.renamed} con otro nombre`}.`;
      },
      skipped: (count: number) => (count === 1 ? "1 conexión no importada: ya existía en el lugar elegido." : `${connections(count)} no importadas: ya existían en el lugar elegido.`),
      nothing: "No se importó nada: todo lo que estaba marcado ya existía en el lugar elegido.",
    },
  },

  menu: {
    exportConnection: "Exportar conexión…",
    exportConnections: "Exportar conexiones…",
    importHere: "Importar conexiones aquí…",
    importConnections: "Importar conexiones…",
    nothingToExport: "No hay carpetas ni conexiones para exportar.",
  },

  credentials: {
    rowNoCredentials: " · sin usuario ni contraseña",
    rowNoPassword: " · sin contraseña",
    notice: {
      userName: "Esta conexión llegó sin usuario ni contraseña. Rellénalos para conectar.",
      password: "Esta conexión llegó sin la contraseña. Rellénala para conectar.",
    },
  },
};
