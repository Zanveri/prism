import { formatCount } from "@/lib/utils/format";

import type { VariableRunCopy } from "./variable-run.copy";

export const variableRunCopyEn: VariableRunCopy = {
  errors: {
    title: "Variable errors",
    line: (line: number) => `Line ${line.toLocaleString("en")}`,
    hint: "Enter or a click takes the cursor to the error.",
    list: "The errors found in the variables",
  },
  refused: {
    script: (count: number) => `The script was not run: ${formatCount(count, "error", "errors")} in the variables.`,
    command: (count: number) => `The statement was not run: ${formatCount(count, "error", "errors")} in the variables.`,
    declaration: (count: number) => `The declaration was not evaluated: ${formatCount(count, "error", "errors")} in the variables.`,
  },
  skipDisabled: (name: string) => `Without the value of ${name}, the statements that use it cannot run.`,
  declaration: "Declaration",
  declarationTitle: (number: number, total: number) => `Declaration ${number.toLocaleString("en")} of ${total.toLocaleString("en")} failed`,
};
