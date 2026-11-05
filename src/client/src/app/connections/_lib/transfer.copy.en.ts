import { formatCount } from "@/lib/utils/format";

import type { TransferCopy } from "./transfer.copy";

const connections = (count: number) => formatCount(count, "connection", "connections");
const folders = (count: number) => formatCount(count, "folder", "folders");

export const transferCopyEn: TransferCopy = {
  export: {
    title: "Export connections",
    description: "Choose the connections and what goes with each one. The file is encrypted with an export password, which you create here.",
    tree: "Vault folders and connections",
    noUser: "no user",
    user: (userName: string) => `user ${userName}`,
    credentials: {
      label: (name: string) => `What goes with ${name}`,
      none: "No user or password",
      user: "User only",
      userAndPassword: "User and password",
      noUserHint: "The connection has no saved user.",
      noPasswordHint: "The connection has no saved password.",
      bulk: "For the checked ones:",
      bulkSearching: "For the checked ones the search shows:",
    },
    passwordsWarning: (count: number) =>
      `The database passwords of ${connections(count)} go in the file. Whoever has the file and the export password can enter those databases with them. To export them, Prism asks for your Prism password.`,
    passphrase: "Export password",
    passphraseAgain: "Repeat the export password",
    showPassphrase: "Show password",
    passphraseHint: "It is not your Prism password. Whoever imports the file will need it: pass it along by another channel, and never in the same message as the file. Without it the file does not open, and there is no way to recover it.",
    passphraseErrors: {
      required: "Create an export password.",
      tooShort: "The export password must be at least 12 characters long.",
      tooLong: "The export password can be up to 128 characters long.",
      edgeSpace: "The export password cannot start or end with a space.",
      control: "The export password cannot contain a control character.",
      mismatch: "The two passwords do not match.",
      samePrismPassword: "Use an export password different from your Prism password.",
    },
    limits:
      "The file would exceed the import limits: up to 2,000 connections, 2,000 folders, 5 MiB and 32 folder levels from the root. Export in parts; whatever is more than 32 levels from the root only goes out if it is moved closer to it.",
    counter: (marked: number, withPassword: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nothing checked";
      const connectionPart =
        marked === 0 ? "No connection checked" : `${formatCount(marked, "connection checked", "connections checked")}${withPassword === 0 ? "" : marked === 1 ? ", with password" : `, ${withPassword} with password`}`;
      return inFile === 0 ? connectionPart : `${connectionPart} · ${folders(inFile)} in the file`;
    },
    nothingMarked: "Check at least one connection or folder.",
    cancel: "Cancel",
    submit: "Export…",
    submitting: "Exporting…",
    userPassword: {
      description: "To export the database passwords, enter your Prism password.",
      change: (count: number, name: string | null) => (count === 1 && name !== null ? `Export ${name} with the password` : `Export ${connections(count)} with the password`),
      submit: "Confirm and export",
    },
    gone: "A checked folder or connection no longer exists. The list was read again: check what is checked and export again.",
    toast: (result: { folders: number; connections: number; withPassword: number }) => {
      if (result.connections === 0) return `${formatCount(result.folders, "folder exported", "folders exported")}, no connections.`;
      const exported = formatCount(result.connections, "connection exported", "connections exported");
      if (result.withPassword === 0) return `${exported}.`;
      if (result.connections === 1) return `${exported}, with password.`;
      return result.withPassword === result.connections ? `${exported}, all with password.` : `${exported}, ${result.withPassword} with password.`;
    },
  },

  tree: {
    search: "Search folders and connections",
    markAll: "Check all",
    unmarkAll: "Uncheck all",
    contents: (name: string) => `Contents of ${name}`,
    inFolder: (path: string) => `In the folder ${path}`,
    nothingFound: (query: string) => `Nothing found for “${query}”.`,
    noName: "(no name)",
  },

  import: {
    title: "Import connections",
    description: "Choose a file exported by Prism and enter the export password that whoever exported it gave you.",
    file: "File",
    chooseFile: "Choose file…",
    noFile: "No file chosen",
    chosen: (name: string, size: string) => `${name}, ${size}`,
    fileRequired: "Choose the exported file.",
    unreadable: "Could not read this file.",
    passphrase: "Export password",
    showPassphrase: "Show password",
    passphraseErrors: {
      required: "Enter the export password.",
      tooLong: "The export password is up to 128 characters long.",
      wrong: "The export password does not match, or the file was changed.",
    },
    destination: "Where to put it",
    root: "At the navigator root",
    destinationGone: "The chosen folder no longer exists. Choose another place.",
    open: "Open file",
    opening: "Opening…",
    refreshing: "Refreshing the preview…",
    placeholder: "Choose the file and enter the password to see what it brings.",
    fileErrors: {
      limits: "This file exceeds the import limits: up to 5 MiB, 2,000 connections, 2,000 folders and 32 folder levels.",
      invalid: "This file is not a Prism connections export, or it is damaged.",
      newer: "This file was exported by a newer version of Prism. Update Prism to import it.",
    },
    preview: {
      label: "What the file brings",
      tree: "Folders and connections in the file",
      summary: (summary: { connections: number; folders: number; withUser: number; withPassword: number }) => {
        if (summary.connections === 0 && summary.folders === 0) return "The file has no folders or connections.";
        if (summary.connections === 0) return `The file has ${folders(summary.folders)}, no connections.`;
        const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} in ${folders(summary.folders)}`;
        if (summary.withUser === 0 && summary.withPassword === 0) return `The file has ${where}, without user or password.`;
        const parts = [summary.withUser === 0 ? null : `${summary.withUser} with user`, summary.withPassword === 0 ? null : `${summary.withPassword} with password`].filter((part) => part !== null);
        return `The file has ${where}: ${parts.join(", ")}.`;
      },
      servers: "Check the servers before importing. The password you enter on one of these connections goes to the server that the file points to.",
      address: (host: string, port: string, database: string) => `${host}:${port} / ${database}`,
      user: (userName: string) => `user ${userName}`,
      withPassword: "with password",
      withoutPassword: "without password",
      noCredentials: "no user or password",
      tags: {
        existing: "already exists",
        existingFolder: "A folder with this name already exists here: what is inside it goes into it, and it stays as it is, with its color, environment and protections.",
        existingConnection: "A connection with this name already exists here. The import never changes or overwrites a connection that already exists.",
        renamed: (copyName: string) => `comes in as ${copyName}`,
        skipped: "will not be imported",
        readOnly: "becomes read-only",
        irreversible: "confirms irreversible statements",
        all: "confirms all statements",
        environment: (name: string) => `environment ${name}`,
        ownQuery: "own query",
        ownQueryDropped: "own query, not kept",
        invalid: "cannot be imported",
      },
      why: {
        by: (folder: string | null) => (folder === null ? "" : ` by the folder ${folder}`),
        readOnly: (by: string) => `In the file it was read-only${by}. In the chosen place nothing would protect it: the import saves read-only on the connection itself.`,
        irreversible: (by: string) => `In the file it confirmed irreversible statements${by}. In the chosen place the confirmation would be weaker: the import saves the source's on the connection itself.`,
        all: (by: string) => `In the file it confirmed all statements${by}. In the chosen place the confirmation would be weaker: the import saves the source's on the connection itself.`,
        environment: (name: string, by: string) => `In the file it showed the environment ${name}${by}. In the chosen place it would show another, or none: the import saves the environment ${name} on the connection itself.`,
      },
      query: (query: { text: string; interval: number; enabled: boolean; postgres: boolean }) => {
        const when = query.enabled
          ? `Prism runs this query on its own, every ${query.interval} seconds, while the connection is connected, and also on “Test connection”: ${query.text}.`
          : `Prism runs this query on “Test connection”, and on its own, every ${query.interval} seconds, if the check is turned on: ${query.text}.`;
        return query.postgres ? `${when} Check it before importing.` : `${when} Prism only checks the text: a function called inside a SELECT can write without the text showing it. Check it before importing.`;
      },
      invalidFolder: (name: string) => `The folder ${name} cannot be imported.`,
    },
    conflicts: {
      legend: "When a connection with the same name already exists in the same place:",
      rename: "Import with another name",
      skip: "Do not import",
      count: (count: number) => (count === 1 ? "1 connection already exists in the chosen place." : `${connections(count)} already exist in the chosen place.`),
    },
    queries: {
      keep: "Keep the file's check queries",
      hint: (count: number) =>
        count === 1
          ? "1 connection brings its own check query, which Prism runs on its own. If unchecked, it comes in with the database's query."
          : `${connections(count)} bring their own check query, which Prism runs on its own. If unchecked, they come in with the database's query.`,
    },
    counter: (marked: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nothing checked";
      if (marked === 0) return formatCount(inFile, "folder checked", "folders checked");
      if (inFile === 0) return formatCount(marked, "connection checked", "connections checked");
      return `${connections(marked)} and ${folders(inFile)} checked`;
    },
    cancel: "Cancel",
    submit: "Import",
    submitting: "Importing…",
    toasts: {
      imported: (result: { connections: number; folders: number; renamed: number }) => {
        const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
        return `${parts.join(" and ")} imported${result.renamed === 0 ? "" : `, ${result.renamed} with another name`}.`;
      },
      skipped: (count: number) => (count === 1 ? "1 connection not imported: it already existed in the chosen place." : `${connections(count)} not imported: they already existed in the chosen place.`),
      nothing: "Nothing was imported: everything that was checked already existed in the chosen place.",
    },
  },

  menu: {
    exportConnection: "Export connection…",
    exportConnections: "Export connections…",
    importHere: "Import connections here…",
    importConnections: "Import connections…",
    nothingToExport: "There are no folders or connections to export.",
  },

  credentials: {
    rowNoCredentials: " · no user or password",
    rowNoPassword: " · no password",
    noticeNoUser: "This connection arrived without a user and password. Fill them in to connect.",
    noticeNoPassword: "This connection arrived without the password. Fill it in to connect.",
  },
};
