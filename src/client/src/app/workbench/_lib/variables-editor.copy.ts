/*
 * As frases do editor para as variáveis (RN-VAR-025): as dicas, a dica do ponteiro e o autocompletar. Cada dica é a frase da especificação, palavra por palavra. Os erros
 * não estão aqui: são os da conferência da linguagem (`variables/variables.copy.ts`), mostrados como vieram.
 */

export const variablesEditorCopy = {
  hint: {
    /** O `@nome` onde seria variável e não foi declarado (RN-VAR-015). */
    undeclared: (name: string) => `@${name} não é uma variável deste script, e vai ao banco como está.`,
    /** O `@nome` que só difere de uma declarada pelas maiúsculas. */
    differentCase: (suggestion: string) => `Você quis dizer @${suggestion}? Os nomes das variáveis diferenciam maiúsculas, como no JavaScript.`,
    /** O `LET` ou `CONST` onde uma declaração valeria: em maiúsculas, ou com outra mistura de caixa. */
    wrongCaseKeyword: (word: string, lower: string) => (word === word.toUpperCase() ? `${word} em maiúsculas não declara variável: escreva ${lower}.` : `${word} não declara variável: escreva ${lower}, em minúsculas.`),
    queryInList: (name: string) => `A consulta pode devolver uma linha só, e ${name} vira um valor e não uma lista: anote ${name}: number[].`,
    definitionCommand: (name: string) => `Comandos CREATE, ALTER, DROP e GRANT não costumam aceitar parâmetros, e o banco pode recusar @${name}. Para um nome, use uma variável sql.`,
    operator: (name: string) => `Aqui o @${name} é o operador do PostgreSQL (como <@); para a variável, escreva um espaço antes: < @${name}.`,
    /** `clause` diz o que a cláusula faria com um nome: "o ORDER BY @x não ordena por coluna". */
    expectsName: (name: string, clause: string) => `Aqui o banco espera um nome, e @${name} vai como valor: ${clause}. Para um nome, use uma variável sql.`,
    notInNull: () => "NOT IN com null nunca é verdadeiro.",
    commentInValue: () => "-- e // começam um comentário aqui.",
    slashesInSql: () => "// não é comentário no SQL: use --.",
    letInBlock: () => "let dentro do bloco é SQL: declare as variáveis antes do bloco.",
    inRoutineBody: (name: string) => `Dentro do corpo de uma rotina o @${name} vai ao banco como está.`,
  },
  /** As cláusulas em que o banco espera um nome (RN-VAR-025): o que cada uma faria com o valor. */
  clauses: {
    orderBy: (name: string) => `o ORDER BY @${name} não ordena por coluna`,
    groupBy: (name: string) => `o GROUP BY @${name} não agrupa por coluna`,
    table: (word: string, name: string) => `o ${word} @${name} não acha uma tabela`,
  },
  /** A dica do ponteiro sobre um `@nome` ou o nome numa declaração. */
  tip: {
    withValue: (name: string, type: string, value: string, stale: boolean) => `${name}: ${type} = ${value}${stale ? " · desatualizado" : ""}`,
    withoutValue: (name: string, type: string | null) => `${type === null ? name : `${name}: ${type}`} · ainda sem valor. Alt+X, ou Ctrl+Enter na declaração, calcula.`,
  },
  /** O autocompletar: o que a sugestão diz de si. */
  completion: {
    variable: "variável",
    namespace: "nome do Prism",
    function: "função",
    constant: "constante",
    method: "método",
    listLabel: "Variáveis",
  },
} as const;
