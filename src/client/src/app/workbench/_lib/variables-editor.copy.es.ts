import type { VariablesEditorCopy } from "./variables-editor.copy";

export const variablesEditorCopyEs: VariablesEditorCopy = {
  hint: {
    undeclared: (name: string) => `@${name} no es una variable de este script, y va a la base de datos tal cual.`,
    differentCase: (suggestion: string) => `¿Querías decir @${suggestion}? Los nombres de las variables distinguen mayúsculas de minúsculas, como en JavaScript.`,
    wrongCaseKeyword: (word: string, lower: string) => (word === word.toUpperCase() ? `${word} en mayúsculas no declara una variable: escribe ${lower}.` : `${word} no declara una variable: escribe ${lower}, en minúsculas.`),
    queryInList: (name: string) => `La consulta puede devolver una sola fila, y ${name} pasa a ser un valor y no una lista: anota ${name}: number[].`,
    definitionCommand: (name: string) => `Las sentencias CREATE, ALTER, DROP y GRANT no suelen aceptar parámetros, y la base de datos puede rechazar @${name}. Para un nombre, usa una variable sql.`,
    operator: (name: string) => `Aquí @${name} es el operador de PostgreSQL (como <@); para la variable, escribe un espacio antes: < @${name}.`,
    expectsName: (name: string, clause: string) => `Aquí la base de datos espera un nombre, y @${name} va como valor: ${clause}. Para un nombre, usa una variable sql.`,
    notInNull: () => "NOT IN con null nunca es verdadero.",
    commentInValue: () => "-- y // empiezan un comentario aquí.",
    slashesInSql: () => "// no es un comentario en SQL: usa --.",
    letInBlock: () => "let dentro del bloque es SQL: declara las variables antes del bloque.",
    inRoutineBody: (name: string) => `Dentro del cuerpo de una rutina, @${name} va a la base de datos tal cual.`,
  },
  clauses: {
    orderBy: (name: string) => `el ORDER BY @${name} no ordena por columna`,
    groupBy: (name: string) => `el GROUP BY @${name} no agrupa por columna`,
    table: (word: string, name: string) => `el ${word} @${name} no encuentra una tabla`,
  },
  tip: {
    withValue: (name: string, type: string, value: string, stale: boolean, from?: string) => `${name}: ${type} = ${value}${from === undefined ? "" : ` · ${from}`}${stale ? " · desactualizado" : ""}`,
    withoutValue: (name: string, type: string | null) => `${type === null ? name : `${name}: ${type}`} · todavía sin valor. Alt+X, o Ctrl+Enter en la declaración, lo calcula.`,
  },
  completion: {
    variable: "variable",
    namespace: "nombre de Prism",
    function: "función",
    constant: "constante",
    method: "método",
    listLabel: "Variables",
  },
};
