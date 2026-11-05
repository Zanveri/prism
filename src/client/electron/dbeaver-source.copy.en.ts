import type { DbeaverSourceCopy } from "./dbeaver-source.copy";

export const dbeaverSourceCopyEn: DbeaverSourceCopy = {
  dialogTitle: "Choose the DBeaver folder",
  symlink: "DBeaver keeps this folder behind a shortcut (symbolic link), and Prism does not follow shortcuts. Choose the real folder.",
  unreadable: (reason: string) => `Could not read the DBeaver files: ${reason}.`,
  swapped: "the file was replaced during the copy",
};
