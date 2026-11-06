import { formatCount } from "@/lib/utils/format";

import type { DbeaverCopy } from "./dbeaver.copy";

const connections = (count: number) => formatCount(count, "conexión", "conexiones");
const folders = (count: number) => formatCount(count, "carpeta", "carpetas");

export const dbeaverCopyEs: DbeaverCopy = {
  outside: "Importar desde DBeaver solo funciona en la app de Prism.",

  menu: {
    importDbeaver: "Importar desde DBeaver…",
    importDbeaverHere: "Importar desde DBeaver aquí…",
  },

  source: {
    searching: "Buscando DBeaver en este equipo…",
    notFound: "No encontramos DBeaver en los lugares habituales.",
    notDbeaver: "Esta carpeta no tiene conexiones de DBeaver. Elige la carpeta DBeaverData, el workspace o un proyecto.",
    tooLarge:
      "DBeaver tiene más de lo que Prism importa de una vez: hasta 50 proyectos, 5 MB por archivo y 32 MB de configuración. Con muchos proyectos, usa “Elegir la carpeta de DBeaver…” y elige la carpeta de un proyecto.",
    notWritable: "No se pudo escribir en la carpeta de datos de Prism para leer DBeaver.",
    noSpace: "No hay espacio en la carpeta de datos de Prism para copiar las conexiones de DBeaver.",
    bridge: "No se pudo buscar DBeaver.",
    invalid: "Prism no pudo leer las conexiones de este DBeaver.",
    missing: "La copia de DBeaver ya no existe. Busca DBeaver de nuevo.",
    unknown: "No se pudieron leer las conexiones de DBeaver.",
    limits: (several: boolean) => `DBeaver tiene más de lo que Prism importa de una vez: hasta 2.000 conexiones, 2.000 carpetas y 32 niveles de carpetas.${several ? " Elige un solo proyecto." : ""}`,
    projectGone: "El proyecto elegido ya no existe en DBeaver, o está protegido con contraseña de proyecto. Elige otro.",
    none: "Ninguna carpeta elegida.",
    chooseFolder: "Elegir la carpeta de DBeaver…",
    retry: "Intentar de nuevo",
    where: {
      standard: "DBeaver en este equipo",
      flatpak: "DBeaver (Flatpak) en este equipo",
      snap: "DBeaver (Snap) en este equipo",
      env: "DBeaver de la carpeta de DBEAVER_DATA",
      chosen: "Carpeta elegida",
    },
  },

  startHere: {
    title: "Empieza aquí",
    hint: "Trae las conexiones que ya tienes, o crea la primera.",
    dbeaver: {
      title: "Importar desde DBeaver",
      action: "Importar desde DBeaver…",
      found: (count: number, where: "standard" | "flatpak" | "snap" | "env" | "chosen") => {
        const place = where === "flatpak" ? " (Flatpak)" : where === "snap" ? " (Snap)" : "";
        return `Encontramos DBeaver${place} en este equipo: ${connections(count)}.`;
      },
      noneImportable: "Encontramos DBeaver en este equipo, pero sin conexiones de PostgreSQL, Db2 ni Informix.",
      notFound: "No encontramos DBeaver en los lugares habituales. Si guarda el workspace en otro lugar, elige la carpeta.",
    },
    prism: { title: "Importar conexiones de Prism", hint: "Un archivo .prismconexoes que alguien exportó de Prism.", action: "Importar conexiones…" },
    create: { title: "Nueva conexión", hint: "Indica el servidor, el puerto y el usuario de una base de datos.", action: "Nueva conexión" },
    later: "Ahora no",
  },

  empty: { importPrism: "Importar conexiones…", importDbeaver: "Importar desde DBeaver…" },

  dialog: {
    title: "Importar desde DBeaver",
    description: "Prism lee las conexiones, las carpetas y los tipos de conexión de DBeaver. No se cambia nada en DBeaver.",
    origin: "Origen",
    project: "Proyecto",
    allProjects: "Todos los proyectos",
    projectLabel: (name: string, importable: number) => `${name}, ${importable === 0 ? "ninguna conexión que Prism importe" : connections(importable)}`,
    projectProtected: "protegido con contraseña de proyecto",
    projectNameInvalid: "El nombre de este proyecto en DBeaver tiene un carácter que Prism no acepta.",
    projectPosition: (position: number) => `Proyecto ${position}`,
    withPasswords: "Traer las contraseñas",
    withPasswordsHelp: "Desactivada, las conexiones vienen solo con el usuario, y Prism pide la contraseña la primera vez que te conectes.",
    cancel: "Cancelar",
    later: "Ahora no",
    submit: "Importar",
    submitting: "Importando…",
    refreshing: "Actualizando la vista previa…",
    placeholder: "Buscando lo que tiene DBeaver…",
    previewLabel: "Lo que trae DBeaver",
    tree: "Carpetas y conexiones de DBeaver",
    existingInCounter: (count: number) => `, ${count} ${count === 1 ? "ya existe" : "ya existen"} en Prism`,
  },

  preview: {
    summary: (summary: { scope: string | null; connections: number; folders: number; importable: number; withUser: number; withPassword: number; withPasswords: boolean }) => {
      const subject = summary.scope === null ? "DBeaver tiene" : `El proyecto ${summary.scope} tiene`;
      const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} en ${folders(summary.folders)}`;
      const parts = [summary.withUser === 0 ? null : `${summary.withUser} con usuario`, summary.withPasswords && summary.withPassword > 0 ? `${summary.withPassword} con contraseña` : null].filter(
        (part) => part !== null,
      );
      return `${subject} ${where}; Prism importa ${summary.importable}${parts.length === 0 ? ", sin usuario ni contraseña" : `: ${parts.join(", ")}`}.`;
    },
    nothingImportable: "DBeaver no tiene conexiones que Prism importe (PostgreSQL, Db2 o Informix).",
    empty: "DBeaver no tiene carpetas ni conexiones.",
    servers: "Revisa los servidores antes de importar. La contraseña que escribas en una de estas conexiones va al servidor que indica la carpeta.",
    server: (server: string) => `servidor ${server}`,
    notes: {
      protectedProject: (name: string) => `El proyecto ${name} está protegido con contraseña de proyecto y no se leyó.`,
      unreadableFiles: (name: string) => `No se pudo leer un archivo de conexiones del proyecto ${name}.`,
      unreadableProject: (name: string) => `No se pudieron leer los archivos de conexiones del proyecto ${name}.`,
      credentialsUnreadable: (project: string | null) =>
        `${project === null ? "No se pudieron leer las contraseñas de DBeaver" : `En el proyecto ${project}, no se pudieron leer las contraseñas`}: el archivo no está en un formato que Prism conozca (puede que DBeaver guarde las contraseñas en el almacenamiento seguro del sistema). Las conexiones vienen solo con el usuario.`,
      credentialsProtected: (project: string) => `Las contraseñas del proyecto ${project} están protegidas con contraseña de proyecto y no se leyeron. Las conexiones vienen sin contraseña.`,
      savedPasswordMissing: (count: number) =>
        `${count} ${count === 1 ? "conexión tiene" : "conexiones tienen"} “Guardar contraseña” en DBeaver, pero el archivo no trae la contraseña (puede que DBeaver guarde las contraseñas en el almacenamiento seguro del sistema). ${count === 1 ? "Viene" : "Vienen"} solo con el usuario.`,
      withoutSavedPassword: (count: number) => `${count} ${count === 1 ? "conexión está" : "conexiones están"} sin “Guardar contraseña” en DBeaver y ${count === 1 ? "viene" : "vienen"} solo con el usuario.`,
    },
    tags: {
      existsInPrism: "ya existe en Prism",
      dbeaverPort: "puerto de DBeaver",
      leftOut: "quedó fuera",
      folderCut: "nombre recortado",
      environmentCut: "nombre del tipo recortado",
      noEnvironment: "sin entorno",
    },
    hints: {
      existsInPrism: (path: string | null, name: string) =>
        `Esta conexión ya se importó desde DBeaver: está en ${path === null || path === "" ? "(la raíz)" : path}, con el nombre ${name}. Si queda marcada, eliges al importar si se sobrescribe.`,
      dbeaverPort: (port: number | null) =>
        `DBeaver habla con Informix por el protocolo SQLI, y Prism por el puerto DRDA, que suele ser otro (el sugerido es 9089). Si falla al conectar, cambia el puerto en Editar conexión: el de DBeaver era ${port ?? "el que está en la fila"}.`,
      confirmAll: (type: string | null) =>
        `En DBeaver, ${type === null ? "el tipo de esta conexión" : `el tipo ${type}`} pregunta antes de toda sentencia que no sea un SELECT. Prism no tiene esa opción: “Solo sentencias irreversibles” dejaría pasar el INSERT y el UPDATE con WHERE, así que la conexión viene con “Todas las sentencias”, que pregunta también antes del SELECT. Cámbialo en Editar conexión si te parece demasiado.`,
      folderCut: "El nombre de la carpeta se recortó a 60 caracteres.",
      environmentCut: "El nombre del tipo de conexión se recortó a 30 caracteres.",
      noEnvironment: "El tipo de conexión tiene un carácter que Prism no acepta: la conexión viene sin entorno.",
      leftOut: (items: string[], tunnel: boolean) => `Quedó fuera: ${items.join("; ")}.${tunnel ? " Sin el túnel o el proxy, la conexión puede no llegar al servidor." : ""}`,
    },
    leftOut: {
      informixServer: (server: string | null) => (server === null ? "el servidor Informix" : `el servidor Informix (${server})`),
      sshTunnel: "el túnel SSH",
      proxy: "el proxy",
      ssl: "el SSL (configúralo en Editar conexión)",
      driverProperties: "las propiedades del driver",
      bootstrap: "las sentencias de inicialización, la base de datos y el esquema predeterminados",
      autocommitOff: "el auto-commit desactivado (las pestañas nuevas siguen Configuración › Transacciones)",
      events: "las sentencias antes y después de conectar",
      authModel: (model: string | null) => (model === null ? "el inicio de sesión de DBeaver" : `el inicio de sesión de DBeaver (${model})`),
      confirmDataChange: "la confirmación antes de guardar las ediciones",
      permissions: "las restricciones de permisos (pasaron a solo lectura)",
      navigatorFilters: "los filtros del navegador",
    },
  },

  drda: {
    title: "Puerto DRDA de Informix",
    help: "Prism se conecta a Informix por el puerto DRDA, y DBeaver guarda el SQLI. Si conoces el DRDA del servidor, escríbelo: vale para las conexiones de ese servidor que entran ahora. Vacío, el puerto es el de DBeaver.",
    table: "Puerto DRDA de cada servidor de Informix",
    server: "Servidor de DBeaver",
    field: (host: string) => `Puerto DRDA de ${host}`,
    placeholder: "opcional",
    invalid: "Escribe un puerto de 1 a 65535.",
    sqli: (port: number) => `SQLI ${port}`,
  },

  overwrite: {
    title: "¿Sobrescribir?",
    question: (count: number) => (count === 1 ? "1 conexión de DBeaver ya existe en Prism. ¿Sobrescribir?" : `${count} conexiones de DBeaver ya existen en Prism. ¿Sobrescribir?`),
    what: "Sobrescribir cambia su nombre, servidor (host y puerto), base de datos, usuario, contraseña y entorno por lo que hay en DBeaver; en Informix, el puerto queda el de Prism. La carpeta, la verificación y las protecciones que activaste en Prism se mantienen.",
    whatDrda: " En Informix, el puerto DRDA que escribiste vale también para las que ya existen.",
    connected: (count: number) =>
      count === 1
        ? "Una de ellas está conectada: el servidor, el usuario y la contraseña nuevos valen en la próxima conexión; la protección y el entorno valen ya, en la próxima sentencia."
        : `${count} de ellas están conectadas: el servidor, el usuario y la contraseña nuevos valen en la próxima conexión; la protección y el entorno valen ya, en la próxima sentencia.`,
    all: "Sobrescribir todas",
    choose: "Elegir cuáles…",
    none: "No sobrescribir ninguna",
    cancel: "Cancelar",
    submitChosen: "Importar y sobrescribir las marcadas",
    list: "Conexiones que ya existen",
    rowConnected: "Esta conexión está conectada: el servidor, el usuario y la contraseña nuevos valen en la próxima conexión.",
    nothingChanges: "no cambia nada",
    change: {
      name: "nombre",
      engine: "base de datos",
      host: (from: string | null, to: string | null) => (from !== null && to !== null ? `host ${from} → ${to}` : "host"),
      port: (from: number | null, to: number | null) => (from !== null && to !== null ? `puerto ${from} → ${to}` : "puerto"),
      database: (from: string | null, to: string | null) => (from !== null && to !== null ? `base de datos ${from} → ${to}` : "base de datos"),
      userName: (from: string | null, to: string | null) => (from !== null && to !== null && to !== "" ? `usuario ${from === "" ? "(ninguno)" : from} → ${to}` : "usuario"),
      password: "contraseña",
      environment: (from: string | null, to: string | null) => (from !== null && to !== null ? `entorno ${from} → ${to}` : "entorno"),
    },
    keepsName: (name: string) => `el nombre se mantiene: ya hay una ${name} en esta carpeta`,
    dropsPassword: {
      host: "el host cambia y la contraseña no viene: queda sin contraseña",
      port: "el puerto cambia y la contraseña no viene: queda sin contraseña",
      userName: "el usuario cambia y la contraseña no viene: queda sin contraseña",
    },
  },

  toasts: {
    imported: (result: { connections: number; folders: number; renamed: number; updated: number }) => {
      const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
      const word = result.connections + result.folders === 1 ? "importada" : "importadas";
      const extras = [result.renamed === 0 ? null : `${result.renamed} con otro nombre`, result.updated === 0 ? null : `${result.updated} ${result.updated === 1 ? "actualizada" : "actualizadas"}`].filter((part) => part !== null);
      return `${parts.join(" y ")} ${word} desde DBeaver${extras.length === 0 ? "" : `, ${extras.join(", ")}`}.`;
    },
    updated: (count: number) => `${connections(count)} ${count === 1 ? "actualizada" : "actualizadas"} desde DBeaver.`,
    nothing: "No se importó nada desde DBeaver: todo lo que estaba marcado ya existía.",
  },

  settings: {
    title: "Importar",
    description: "Trae las conexiones de otro programa.",
    dbeaver: "Importar desde DBeaver…",
    prism: "Importar conexiones de Prism…",
    last: (when: string) => `Última importación de DBeaver: ${when}.`,
    never: "Aún no has importado desde DBeaver.",
  },
};
