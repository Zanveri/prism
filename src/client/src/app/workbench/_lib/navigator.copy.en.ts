import { formatCount } from "@/lib/utils/format";

import type { NavigatorCopy } from "./navigator.copy";

export const navigatorCopyEn: NavigatorCopy = {
  toolbar: {
    label: "Connection tree actions",
    newConnection: "New connection",
    newConnectionIn: (folder: string) => `New connection in ${folder}`,
    newFolder: "New folder",
    newFolderIn: (folder: string) => `New folder in ${folder}`,
    connect: "Connect",
    connectTo: (connection: string) => `Connect ${connection}`,
    disconnect: "Disconnect",
    disconnectFrom: (connection: string) => `Disconnect ${connection}`,
    refresh: "Refresh",
    refreshItem: (name: string) => `Refresh ${name}`,
    collapseAll: "Collapse all",
    hide: "Hide the navigator",
  },

  layout: {
    toggle: "Show the navigator",
    show: "Show the navigator",
    hide: "Hide the navigator",
  },

  firstUse: {
    title: "No saved connections",
    hint: "Create your first connection to browse database objects and run SQL. The form starts with the choice of database: PostgreSQL, Db2 or Informix.",
    action: "New connection",
  },

  empty: {
    hint: "Create the first one with “New connection” in the bar above. Folders organize connections.",
  },

  row: {
    connectionHint: (engine: string, host: string, port: number, database: string) => `${engine} · ${host}:${port} / ${database}`,
  },

  environmentFilter: {
    label: "Filter by environment",
    all: "All environments",
    none: "No environment",
    clear: "Clear the environment filter",
    nothingIn: (environment: string) => `No connections in ${environment}.`,
    nothingWithout: "No connections without an environment.",
  },

  connectedFilter: {
    label: "Connected only",
    count: (count: number) => (count === 0 ? "None connected" : formatCount(count, "connected", "connected")),
    showOnly: "Show only connected connections, with the folders on the way to them",
    showAll: "Show all connections",
    nothing: "No connected connections.",
    nothingIn: (environment: string) => `No connected connections in ${environment}.`,
    nothingWithout: "No connected connections without an environment.",
    clear: "Show all",
  },

  menu: {
    label: "Navigator actions",
    newConnection: "New connection",
    newFolder: "New folder",
    moveConnection: "Move",
    deleteConnection: "Delete",
    renameConnection: "Rename",
    duplicateConnection: "Duplicate connection",
  },

  typeAhead: {
    typed: (text: string) => `Go to: ${text}`,
    none: (text: string) => `No item starts with “${text}”`,
  },
};
