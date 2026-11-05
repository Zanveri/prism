import { formatCount } from "@/lib/utils/format";

import type { DbeaverCopy } from "./dbeaver.copy";

const connections = (count: number) => formatCount(count, "connection", "connections");
const folders = (count: number) => formatCount(count, "folder", "folders");

export const dbeaverCopyEn: DbeaverCopy = {
  outside: "Importing from DBeaver only works in the Prism app.",

  menu: {
    importDbeaver: "Import from DBeaver…",
    importDbeaverHere: "Import from DBeaver here…",
  },

  source: {
    searching: "Looking for DBeaver on this computer…",
    notFound: "We did not find DBeaver in the usual places.",
    notDbeaver: "This folder has no DBeaver connections. Choose the DBeaverData folder, the workspace or a project.",
    tooLarge:
      "DBeaver has more than Prism imports at once: up to 50 projects, 5 MB per file and 32 MB of configuration. With many projects, use “Choose the DBeaver folder…” and pick a project's folder.",
    notWritable: "Could not write to Prism's data folder to read DBeaver.",
    noSpace: "There is no space in Prism's data folder to copy the DBeaver connections.",
    bridge: "Could not look for DBeaver.",
    invalid: "Prism could not read the connections of this DBeaver.",
    missing: "The DBeaver copy no longer exists. Look for DBeaver again.",
    unknown: "Could not read the DBeaver connections.",
    limits: (several: boolean) => `DBeaver has more than Prism imports at once: up to 2,000 connections, 2,000 folders and 32 folder levels.${several ? " Choose a single project." : ""}`,
    projectGone: "The chosen project no longer exists in DBeaver, or is protected by a project password. Choose another.",
    none: "No folder chosen.",
    chooseFolder: "Choose the DBeaver folder…",
    retry: "Try again",
    where: {
      standard: "DBeaver on this computer",
      flatpak: "DBeaver (Flatpak) on this computer",
      snap: "DBeaver (Snap) on this computer",
      env: "DBeaver from the DBEAVER_DATA folder",
      chosen: "Chosen folder",
    },
  },

  startHere: {
    title: "Start here",
    hint: "Bring the connections you already have, or create the first one.",
    dbeaver: {
      title: "Import from DBeaver",
      action: "Import from DBeaver…",
      found: (count: number, where: "standard" | "flatpak" | "snap" | "env" | "chosen") => {
        const place = where === "flatpak" ? " (Flatpak)" : where === "snap" ? " (Snap)" : "";
        return `We found DBeaver${place} on this computer: ${connections(count)}.`;
      },
      noneImportable: "We found DBeaver on this computer, but with no PostgreSQL, Db2 or Informix connections.",
      notFound: "We did not find DBeaver in the usual places. If it keeps the workspace somewhere else, choose the folder.",
    },
    prism: { title: "Import Prism connections", hint: "A .prismconexoes file that someone exported from Prism.", action: "Import connections…" },
    create: { title: "New connection", hint: "Enter the server, port and user of a database.", action: "New connection" },
    later: "Not now",
  },

  empty: { importPrism: "Import connections…", importDbeaver: "Import from DBeaver…" },

  dialog: {
    title: "Import from DBeaver",
    description: "Prism reads the connections, folders and connection types from DBeaver. Nothing is changed in DBeaver.",
    origin: "Source",
    project: "Project",
    allProjects: "All projects",
    projectLabel: (name: string, importable: number) => `${name}, ${importable === 0 ? "no connection that Prism imports" : connections(importable)}`,
    projectProtected: "protected by a project password",
    projectNameInvalid: "This project's name in DBeaver has a character that Prism does not accept.",
    projectPosition: (position: number) => `Project ${position}`,
    withPasswords: "Bring the passwords",
    withPasswordsHelp: "When off, the connections come with the user only, and Prism asks for the password the first time you connect.",
    cancel: "Cancel",
    later: "Not now",
    submit: "Import",
    submitting: "Importing…",
    refreshing: "Refreshing the preview…",
    placeholder: "Looking for what DBeaver has…",
    previewLabel: "What DBeaver brings",
    tree: "DBeaver folders and connections",
    existingInCounter: (count: number) => `, ${count} already ${count === 1 ? "exists" : "exist"} in Prism`,
  },

  preview: {
    summary: (summary: { scope: string | null; connections: number; folders: number; importable: number; withUser: number; withPassword: number; withPasswords: boolean }) => {
      const subject = summary.scope === null ? "DBeaver has" : `The project ${summary.scope} has`;
      const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} in ${folders(summary.folders)}`;
      const parts = [summary.withUser === 0 ? null : `${summary.withUser} with user`, summary.withPasswords && summary.withPassword > 0 ? `${summary.withPassword} with password` : null].filter(
        (part) => part !== null,
      );
      return `${subject} ${where}; Prism imports ${summary.importable}${parts.length === 0 ? ", without user or password" : `: ${parts.join(", ")}`}.`;
    },
    nothingImportable: "DBeaver has no connections that Prism imports (PostgreSQL, Db2 or Informix).",
    empty: "DBeaver has no folders or connections.",
    servers: "Check the servers before importing. The password you enter on one of these connections goes to the server that the folder points to.",
    server: (server: string) => `server ${server}`,
    notes: {
      protectedProject: (name: string) => `The project ${name} is protected by a project password and was not read.`,
      unreadableFiles: (name: string) => `A connections file of the project ${name} could not be read.`,
      unreadableProject: (name: string) => `The connections files of the project ${name} could not be read.`,
      credentialsUnreadable: (project: string | null) =>
        `${project === null ? "The DBeaver passwords could not be read" : `In the project ${project}, the passwords could not be read`}: the file is not in a format Prism knows (DBeaver may be keeping the passwords in the system's secure storage). The connections come with the user only.`,
      credentialsProtected: (project: string) => `The passwords of the project ${project} are protected by a project password and were not read. The connections come without a password.`,
      savedPasswordMissing: (count: number) =>
        `${count} ${count === 1 ? "connection has" : "connections have"} “Save password” in DBeaver, but the file does not include the password (DBeaver may be keeping the passwords in the system's secure storage). ${count === 1 ? "It comes" : "They come"} with the user only.`,
      withoutSavedPassword: (count: number) => `${count} ${count === 1 ? "connection is" : "connections are"} without “Save password” in DBeaver and ${count === 1 ? "comes" : "come"} with the user only.`,
    },
    tags: {
      existsInPrism: "already exists in Prism",
      dbeaverPort: "DBeaver port",
      leftOut: "left out",
      folderCut: "name truncated",
      environmentCut: "type name truncated",
      noEnvironment: "no environment",
    },
    hints: {
      existsInPrism: (path: string | null, name: string) =>
        `This connection was already imported from DBeaver: it is in ${path === null || path === "" ? "(the root)" : path}, named ${name}. If it stays checked, you choose when importing whether it is overwritten.`,
      dbeaverPort: (port: number | null) =>
        `DBeaver talks to Informix over the SQLI protocol, and Prism over the DRDA port, which is usually a different one (the suggested one is 9089). If connecting fails, change the port in Edit connection: DBeaver's was ${port ?? "the one on the row"}.`,
      confirmAll: (type: string | null) =>
        `In DBeaver, ${type === null ? "this connection's type" : `the type ${type}`} asks before every statement that is not a SELECT. Prism does not have that choice: “Irreversible statements only” would let INSERT and UPDATE with WHERE through, so the connection comes with “All statements”, which also asks before SELECT. Change it in Edit connection if it is too much.`,
      folderCut: "The folder name was truncated to 60 characters.",
      environmentCut: "The connection type name was truncated to 30 characters.",
      noEnvironment: "The connection type has a character that Prism does not accept: the connection comes without an environment.",
      leftOut: (items: string[], tunnel: boolean) => `Left out: ${items.join("; ")}.${tunnel ? " Without the tunnel or the proxy, the connection may not reach the server." : ""}`,
    },
    leftOut: {
      informixServer: (server: string | null) => (server === null ? "the Informix server" : `the Informix server (${server})`),
      sshTunnel: "the SSH tunnel",
      proxy: "the proxy",
      ssl: "SSL (set it up in Edit connection)",
      driverProperties: "the driver properties",
      bootstrap: "the initialization statements, the default database and schema",
      autocommitOff: "auto-commit off (new tabs follow Settings › Transactions)",
      events: "the statements before and after connecting",
      authModel: (model: string | null) => (model === null ? "the DBeaver login" : `the DBeaver login (${model})`),
      confirmDataChange: "the confirmation before saving edits",
      permissions: "the permission restrictions (they became read-only)",
      navigatorFilters: "the navigator filters",
    },
  },

  drda: {
    title: "Informix DRDA port",
    help: "Prism connects to Informix over the DRDA port, and DBeaver keeps the SQLI one. If you know the server's DRDA port, enter it: it applies to that server's connections being imported now. If empty, the port is DBeaver's.",
    table: "DRDA port of each Informix server",
    server: "DBeaver server",
    field: (host: string) => `DRDA port of ${host}`,
    placeholder: "optional",
    invalid: "Enter a port from 1 to 65535.",
    sqli: (port: number) => `SQLI ${port}`,
  },

  overwrite: {
    title: "Overwrite?",
    question: (count: number) => (count === 1 ? "1 DBeaver connection already exists in Prism. Overwrite?" : `${count} DBeaver connections already exist in Prism. Overwrite?`),
    what: "Overwriting replaces their name, server (host and port), database, user, password and environment with what is in DBeaver; in Informix, the port stays Prism's. The folder, the check and the protections you turned on in Prism stay.",
    whatDrda: " In Informix, the DRDA port you entered also applies to those that already exist.",
    connected: (count: number) =>
      count === 1
        ? "One of them is connected: the new server, user and password apply on the next connection; the protection and environment apply right away, on the next statement."
        : `${count} of them are connected: the new server, user and password apply on the next connection; the protection and environment apply right away, on the next statement.`,
    all: "Overwrite all",
    choose: "Choose which…",
    none: "Do not overwrite any",
    cancel: "Cancel",
    submitChosen: "Import and overwrite the checked ones",
    list: "Connections that already exist",
    rowConnected: "This connection is connected: the new server, user and password apply on the next connection.",
    nothingChanges: "nothing changes",
    change: {
      name: "name",
      engine: "database",
      host: (from: string | null, to: string | null) => (from !== null && to !== null ? `host ${from} → ${to}` : "host"),
      port: (from: number | null, to: number | null) => (from !== null && to !== null ? `port ${from} → ${to}` : "port"),
      database: (from: string | null, to: string | null) => (from !== null && to !== null ? `database ${from} → ${to}` : "database"),
      userName: (from: string | null, to: string | null) => (from !== null && to !== null && to !== "" ? `user ${from === "" ? "(none)" : from} → ${to}` : "user"),
      password: "password",
      environment: (from: string | null, to: string | null) => (from !== null && to !== null ? `environment ${from} → ${to}` : "environment"),
    },
    keepsName: (name: string) => `the name stays: there is already a ${name} in this folder`,
    dropsPassword: {
      host: "the host changes and the password does not come: it is left without a password",
      port: "the port changes and the password does not come: it is left without a password",
      userName: "the user changes and the password does not come: it is left without a password",
    },
  },

  toasts: {
    imported: (result: { connections: number; folders: number; renamed: number; updated: number }) => {
      const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
      const extras = [result.renamed === 0 ? null : `${result.renamed} with another name`, result.updated === 0 ? null : `${result.updated} updated`].filter((part) => part !== null);
      return `${parts.join(" and ")} imported from DBeaver${extras.length === 0 ? "" : `, ${extras.join(", ")}`}.`;
    },
    updated: (count: number) => `${connections(count)} updated from DBeaver.`,
    nothing: "Nothing was imported from DBeaver: everything that was checked already existed.",
  },

  settings: {
    title: "Import",
    description: "Bring the connections from another program.",
    dbeaver: "Import from DBeaver…",
    prism: "Import Prism connections…",
    last: (when: string) => `Last DBeaver import: ${when}.`,
    never: "You have not imported from DBeaver yet.",
  },
};
