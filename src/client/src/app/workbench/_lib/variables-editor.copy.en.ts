import type { VariablesEditorCopy } from "./variables-editor.copy";

export const variablesEditorCopyEn: VariablesEditorCopy = {
  hint: {
    undeclared: (name: string) => `@${name} is not a variable of this script, and goes to the database as is.`,
    differentCase: (suggestion: string) => `Did you mean @${suggestion}? Variable names are case-sensitive, as in JavaScript.`,
    wrongCaseKeyword: (word: string, lower: string) => (word === word.toUpperCase() ? `${word} in uppercase does not declare a variable: write ${lower}.` : `${word} does not declare a variable: write ${lower}, in lowercase.`),
    queryInList: (name: string) => `The query may return a single row, and ${name} becomes a value and not a list: annotate ${name}: number[].`,
    definitionCommand: (name: string) => `CREATE, ALTER, DROP and GRANT statements usually do not accept parameters, and the database may refuse @${name}. For a name, use an sql variable.`,
    operator: (name: string) => `Here @${name} is the PostgreSQL operator (like <@); for the variable, write a space before it: < @${name}.`,
    expectsName: (name: string, clause: string) => `Here the database expects a name, and @${name} goes as a value: ${clause}. For a name, use an sql variable.`,
    notInNull: () => "NOT IN with null is never true.",
    commentInValue: () => "-- and // start a comment here.",
    slashesInSql: () => "// is not a comment in SQL: use --.",
    letInBlock: () => "let inside the block is SQL: declare the variables before the block.",
    inRoutineBody: (name: string) => `Inside a routine body, @${name} goes to the database as is.`,
  },
  clauses: {
    orderBy: (name: string) => `the ORDER BY @${name} does not sort by column`,
    groupBy: (name: string) => `the GROUP BY @${name} does not group by column`,
    table: (word: string, name: string) => `the ${word} @${name} does not find a table`,
  },
  tip: {
    withValue: (name: string, type: string, value: string, stale: boolean, from?: string) => `${name}: ${type} = ${value}${from === undefined ? "" : ` · ${from}`}${stale ? " · outdated" : ""}`,
    withoutValue: (name: string, type: string | null) => `${type === null ? name : `${name}: ${type}`} · no value yet. Alt+X, or Ctrl+Enter on the declaration, computes it.`,
  },
  completion: {
    variable: "variable",
    namespace: "Prism name",
    function: "function",
    constant: "constant",
    method: "method",
    listLabel: "Variables",
  },
};
