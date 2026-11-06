import type { FileTransferCopy } from "./file-transfer.copy";

export const fileTransferCopyEn: FileTransferCopy = {
  allFiles: "All files",

  source: {
    dialogTitle: "Import data",
    filters: {
      data: "Data files (*.csv, *.tsv, *.tab, *.txt, *.json, *.xlsx, *.xlsm)",
      delimited: "CSV and TSV (*.csv, *.tsv, *.tab, *.txt)",
      json: "JSON (*.json)",
      excel: "Excel (*.xlsx, *.xlsm)",
    },
    unreadable: {
      permission: "the system does not allow reading the file",
      busy: "the file is in use by another program",
      missing: "the file no longer exists",
      io: "the disk had a read error",
      other: (code: string | undefined) => `error ${code ?? "without a code"}`,
    },
    failure: {
      diskFull: "There is no space in the Prism data folder to copy the file.",
      tooLarge: "The file grew past 2 GB during the copy.",
      unreadable: (reason: string) => `Could not read the file: ${reason}.`,
      other: (code: string | undefined) => `Could not copy the file (${code ?? "without a code"}).`,
    },
  },

  desk: {
    formats: { csv: "CSV", tsv: "TSV", php: "PHP", xml: "XML", html: "HTML", json: "JSON", md: "Markdown", sql: "SQL", txt: "Text", xlsx: "Excel", zip: "ZIP" },
    delivery: {
      diskFull: "there is no space on the destination disk",
      notWritable: "no permission to write to the chosen folder",
      folderMissing: "the chosen folder no longer exists",
      inUse: "the file is open in another program",
      other: (code: string | undefined) => `the system refused the write (${code ?? "without a code"})`,
    },
    clipboardReadFailed: (code: string | undefined) => `Could not read the exported text (${code ?? "without a code"}).`,
  },
};
