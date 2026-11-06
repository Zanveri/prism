import type { ModeMenuCopy } from "./mode-menu.copy";

export const modeMenuCopyEn: ModeMenuCopy = {
  label: "Mode",
  workbench: {
    label: "Workspace",
    hint: "Browse databases, run SQL and edit data",
  },
  build: {
    label: "Build",
    hint: "Design tables, relationships and indexes and generate the DDL",
    badge: "beta",
  },
};
