import type { Confirmation } from "@/app/connections/_lib/connections.schema";
import { formatCount } from "@/lib/utils/format";

import type { CommandConfirmationCopy } from "./command-confirmation.copy";
import type { Irreversible } from "./irreversible";

const levelName: Record<Confirmation, string> = { irreversible: "Irreversible statements only", all: "All statements" };

const ofTarget = (target: string | null, fallback: string) => (target === null ? fallback : target);

export const commandConfirmationCopyEn: CommandConfirmationCopy = {
  environment: (name: string) => `Environment: ${name}`,
  place: (connection: string, database: string) => `${connection} / ${database}`,

  titles: {
    irreversible: "Run irreversible statement?",
    command: "Run statement?",
    scriptIrreversible: "Run script with irreversible statements?",
    script: "Run script?",
    save: "Save the changes?",
    autoRefresh: "Turn on automatic refresh?",
  },

  does: (irreversible: Irreversible): string => {
    const target = irreversible.target;
    switch (irreversible.kind) {
      case "delete":
        return `This DELETE has no WHERE: it deletes all rows of ${ofTarget(target, "a table")}.`;
      case "update":
        return `This UPDATE has no WHERE: it changes all rows of ${ofTarget(target, "a table")}.`;
      case "truncate":
        return `This TRUNCATE deletes all rows of ${ofTarget(target, "a table")}.`;
      case "drop":
        return `This DROP deletes ${ofTarget(target, "a database object")}, and what it deletes does not come back.`;
      case "alterDrop":
        return `This ALTER has a DROP: it deletes a part of ${ofTarget(target, "a database object")} that does not come back.`;
      case "sqlVariable":
        return `This statement uses ${ofTarget(target, "an sql variable")}, whose text goes into the statement as is and can remove a WHERE: it may change or delete more rows than it seems.`;
    }
  },

  script: {
    all: (total: number) =>
      total === 1
        ? "The script’s statement asks for confirmation. Once confirmed, it runs without asking again."
        : `All ${formatCount(total, "statement", "statements")} of the script ask for confirmation. Once confirmed, the script runs to the end without asking again.`,
    some: (count: number, total: number) =>
      `${count === 1 ? "One statement" : `${count.toLocaleString("en")} statements`} of ${total.toLocaleString("en")} ${count === 1 ? "is irreversible" : "are irreversible"}. Once confirmed, the script runs to the end without asking again.`,
    number: (number: number) => `Statement ${number.toLocaleString("en")}`,
  },

  filter: (filter: string) => `With the result filter: ${filter}`,

  save: {
    description: (count: number) => `${formatCount(count, "change goes", "changes go")} to the database, in a transaction. Before saving, you can view the statements.`,
    viewSql: "View SQL",
  },

  autoRefresh: "Once on, it runs this statement again at each interval, without asking, until it is turned off.",

  why: (connection: string, level: Confirmation, folder: string | null): string =>
    folder === null ? `You see this warning because the connection ${connection} has the protection “${levelName[level]}”.` : `You see this warning because the connection ${connection} inherits the protection “${levelName[level]}” from the folder ${folder}.`,

  confirm: { command: "Run anyway", script: "Run script", save: "Save anyway", autoRefresh: "Turn on anyway" },
  cancel: "Cancel",
};
