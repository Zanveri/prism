/*
 * A lista fechada do que existe na linguagem (RN-VAR-003, 009 e 010) e a dos nomes que não podem ser nome de variável. Só nomes: o que cada função faz está em
 * `functions.ts`. A lista dos nomes faz parte do contrato da linguagem (RN-VERSAO-002): só cresce numa versão que quebra o contrato.
 */

/** As funções e as constantes de cada espaço de nomes (`Math.max`, `random.int`, `date.addDays`, `Date.now`, `Number.isInteger`). As tabelas são `Map`s (RN-VAR-014). */
export const namespaceMembers: ReadonlyMap<string, { functions: ReadonlySet<string>; constants: ReadonlySet<string> }> = new Map([
  ["Math", { functions: new Set(["abs", "ceil", "floor", "round", "trunc", "sign", "sqrt", "pow", "min", "max", "random"]), constants: new Set(["PI", "E"]) }],
  ["random", { functions: new Set(["int", "decimal", "bool", "uuid", "string", "pick", "date"]), constants: new Set<string>() }],
  ["date", { functions: new Set(["today", "of", "addDays", "addMonths", "addYears", "diffDays", "startOfMonth", "endOfMonth", "format"]), constants: new Set<string>() }],
  ["Date", { functions: new Set(["now"]), constants: new Set<string>() }],
  ["Number", { functions: new Set(["isInteger"]), constants: new Set<string>() }],
]);

/** As funções que se chamam pelo nome sozinho. */
export const directFunctions: ReadonlySet<string> = new Set(["Number", "String"]);

/** Os nomes da lista fechada: não são nome de variável nem valor (RN-VAR-003). */
export const closedNames: ReadonlySet<string> = new Set(["Math", "random", "date", "Date", "Number", "String"]);

/** As palavras reservadas do JavaScript (RN-VAR-003), mais `undefined`, `NaN` e `Infinity`. */
export const reservedWords: ReadonlySet<string> = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "await",
  "implements", "interface", "package", "private", "protected", "public", "static", "undefined", "NaN", "Infinity",
]);

/** Os nomes do ambiente (RN-VAR-003). */
export const environmentNames: ReadonlySet<string> = new Set([
  "window", "globalThis", "self", "document", "process", "require", "module", "eval", "Function", "Object", "Array", "JSON", "Reflect", "Proxy", "Symbol",
]);

/** As palavras que, no lugar de um valor, a linguagem recusa com "<palavra> não existe aqui: …" (RN-VAR-002 e 012). */
export const unsupportedWords: ReadonlySet<string> = new Set([
  "var", "function", "class", "if", "for", "while", "do", "switch", "return", "try", "throw", "import", "export", "await", "yield", "this", "super", "break", "case", "catch",
  "continue", "debugger", "default", "else", "enum", "extends", "finally", "with", "let", "const", "implements", "interface", "package", "private", "protected", "public",
  "static",
]);

/** Os operadores em forma de palavra, recusados com "O operador <op> não existe aqui.". */
export const unsupportedOperatorWords: ReadonlySet<string> = new Set(["typeof", "void", "delete", "in", "instanceof"]);
