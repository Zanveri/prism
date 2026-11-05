/*
 * As frases da linguagem das variáveis (seção 41). Cada função é uma frase da especificação, palavra por palavra, ou a mais próxima dela quando a especificação só
 * diz o que a frase tem de dizer. Nenhuma traz texto do JavaScript da tela (a pilha, o nome de uma classe, um `[object Object]`, RN-VAR-012).
 */

/** Os limites da RN-VAR-013 e os das outras regras que as frases citam. */
export const limits = {
  declarationsPerScript: 500,
  nameLength: 64,
  declarationBytes: 64 * 1024,
  depth: 64,
  stepsPerDeclaration: 100_000,
  stepsPerRun: 1_000_000,
  millisecondsPerDeclaration: 250,
  millisecondsPerRun: 5_000,
  textLength: 1_000_000,
  listItems: 10_000,
  objectFields: 100,
  sqlLength: 10_000,
  parameters: 10_000,
  parameterBytes: 4 * 1024 * 1024,
  requestBodyBytes: 30_000_000,
  /** O corpo das rotas `transfers` (a exportação e a cópia levam o comando e os parâmetros em `source`): 16 MiB. */
  transferBodyBytes: 16 * 1024 * 1024,
  /** Os dígitos do `DECIMAL` do Db2 e do Informix, e os caracteres de um `number` no pedido (RN-VAR-032). */
  decimalDigits: 31,
  numberCharacters: 100,
  tabValuesBytes: 128 * 1024 * 1024,
  /** A consulta de uma variável (RN-VAR-013 e 034): as linhas e as colunas que a API lê antes de recusar. */
  queryRows: 10_000,
  queryColumns: 100,
} as const;

/** O número de `n` com milhares separados por ponto, como a especificação escreve os limites. */
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const phrase = {
  // Os limites (RN-VAR-013).
  tooManyDeclarations: () => `O script passou de ${group(limits.declarationsPerScript)} declarações.`,
  nameTooLong: () => `O nome pode ter até ${limits.nameLength} caracteres.`,
  declarationTooBig: (name: string) => `A declaração de ${name} passou de 64 KiB.`,
  tooDeep: (name: string) => `A expressão de ${name} passou de ${limits.depth} níveis.`,
  tooManySteps: (name: string) => `A expressão de ${name} passou de ${group(limits.stepsPerDeclaration)} passos e foi parada.`,
  tooManyStepsInRun: () => `O script passou de ${group(limits.stepsPerRun)} de passos e foi parado.`,
  tooSlow: (name: string) => `A expressão de ${name} levou mais de ${limits.millisecondsPerDeclaration} ms e foi parada.`,
  runTooSlow: () => `As expressões do script levaram mais de ${limits.millisecondsPerRun / 1000} s e foram paradas.`,
  textTooLong: () => `O texto passou de ${group(limits.textLength)} de caracteres.`,
  listTooLong: () => `A lista passou de ${group(limits.listItems)} itens.`,
  objectTooBig: () => `O objeto passou de ${limits.objectFields} campos.`,
  tooManyParameters: (count: number) => `O comando passaria de ${group(limits.parameters)} parâmetros (${group(count)}): divida a lista ou use uma tabela temporária.`,
  parametersTooBig: () => "Os valores do comando passariam de 4 MiB.",
  requestTooBig: () => "Os valores do comando passam do tamanho que o Prism manda de uma vez: use menos valores.",
  tabValuesTooBig: () => "Os valores da aba passaram de 128 MiB: tire uma variável grande.",
  internal: (name: string) => `Erro interno do Prism ao avaliar ${name}.`,

  // Os textos e as datas (RN-VAR-006 e 007).
  textHasNul: () => "O texto não pode ter o caractere U+0000.",
  textHasHalfPair: (unit: string) => `O texto tem um caractere incompleto (\\u${unit}).`,
  dateDoesNotExist: (text: string) => `A data ${text} não existe.`,
  dateOutOfRange: () => "A data passou do ano 9999 (ou ficou antes do ano 1).",
  dateForm: (text: string) => `new Date(${JSON.stringify(text).replaceAll('"', "'")}) não é uma data: use 'aaaa-mm-dd' ou 'aaaa-mm-ddThh:mm:ss'.`,
  dateMonthFrom1: () => "Use date.of(2026, 10, 20): o mês vai de 1 a 12.",

  // Os números (RN-VAR-005).
  notANumberResult: () => "A conta deu um número que não existe (divisão por zero?).",
  inexactInteger: (text: string) => `${text} passa do que o JavaScript conta sem perder precisão (9.007.199.254.740.991).`,
  inexactDecimal: (text: string) => `${text} tem mais dígitos do que o JavaScript conta sem perder precisão.`,

  // Os nomes (RN-VAR-003).
  reservedName: (name: string) => `${name} não pode ser nome de variável: escolha outro.`,
  prismName: (name: string) => (name === "date" ? "date é um nome do Prism; escolha outro, por exemplo data ou dia." : `${name} é um nome do Prism; escolha outro.`),
  unicodeEscapeInName: () => "Escapes \\u não valem em nomes.",
  formatCharacterInName: (code: string) => `O caractere ${code} muda o que se vê sem mudar o nome, e não vale em nomes.`,
  alreadyDeclared: (name: string, line: number) => `${name} já foi declarada na linha ${line}.`,
  usedBeforeDeclared: (name: string, line: number) => `${name} é usada antes de ser declarada, na linha ${line}.`,
  notDeclared: (name: string) => `${name} não foi declarada.`,
  notDeclaredAssign: (name: string, rest: string) => `${name} não foi declarada: escreva let ${name} = ${rest}.`,
  constReassigned: (name: string, line: number) => `${name} é const e não pode receber outro valor (linha ${line}).`,

  // A gramática (RN-VAR-002 e 012).
  expectedName: () => "Esperava o nome da variável depois de let.",
  expectedEqualsOrColon: (name: string) => `Esperava = ou : depois de ${name}.`,
  expectedType: () => "Esperava o tipo depois de :.",
  expectedValue: () => "Esperava um valor depois de =.",
  expectedClose: (line: number) => `Esperava ) para fechar o ( da linha ${line}.`,
  expectedCloseBracket: (line: number) => `Esperava ] para fechar o [ da linha ${line}.`,
  expectedCloseBrace: (line: number) => `Esperava } para fechar o { da linha ${line}.`,
  expectedEnd: (name: string, found: string) => `Esperava ; ou o fim da linha depois do valor de ${name}, e veio ${found}.`,
  expectedExpression: (found: string) => `Esperava um valor, e veio ${found}.`,
  expectedMemberName: () => "Esperava o nome do membro depois do ponto.",
  expectedFieldName: () => "Esperava o nome do campo.",
  expectedColonInObject: () => "Esperava : depois do nome do campo.",
  expectedTernaryColon: () => "Esperava : na saída do ? :.",
  textNotClosed: () => "O texto não terminou: falta a aspa de fechar.",
  templateNotClosed: () => "O modelo não terminou: falta a crase de fechar.",
  commentNotClosed: () => "O comentário /* não terminou: falta o */.",
  oneVariablePerLet: () => "Uma variável por let: let a = 1; let b = 2.",
  notInLanguage: (word: string) => `${word} não existe aqui: as variáveis do Prism não têm laços, funções nem import.`,
  operatorNotInLanguage: (operator: string) => `O operador ${operator} não existe aqui.`,
  mixedNullish: () => "?? não se mistura com && nem com || sem parênteses.",
  unaryBeforePower: () => "Use parênteses: (-x) ** 2 ou -(x ** 2).",
  looseEquality: () => "Use === ou !==: o == do JavaScript converte os tipos antes de comparar.",
  unknownType: (type: string) =>
    `O tipo ${type} não existe. Os tipos são number, string, boolean, Date, sql, a lista (number[]), o | null, o de uma coluna (tabela.coluna) e os do script (interface e type).`,
  noGenerics: (type: string) => `${type}<…> não existe: os tipos não levam parâmetros, e a lista se anota number[].`,
  listOfList: () => "Lista de lista não existe aqui: anote uma lista de valores simples.",
  memberNotInType: (member: string, type: string) => `${member} não existe em ${type}.`,
  memberForbidden: (member: string) => `${member} não pode ser lido.`,
  keyForbidden: (key: string) => `${key} não pode ser chave de objeto.`,
  octalEscape: (text: string) => `${text} é um escape octal, que não existe aqui: use \\x ou \\u.`,
  badEscape: (text: string) => `O escape ${text} está incompleto ou não existe.`,
  badNumber: (text: string) => `${text} não é um número.`,
  leadingZero: (text: string) => `${text} não existe: escreva ${text.replace(/^0+(?=\d)/, "")}.`,
  numberForm: (text: string) => `${text} não existe aqui: os números são escritos em decimal, como 255 ou 1.5e3.`,
  bigint: (text: string) => `${text} não existe aqui: o bigint (${text}) não é um tipo. Escreva o número sem o n.`,
  badUnderscore: (text: string) => `${text}: o _ só separa dígitos, um por vez.`,
  unexpectedCharacter: (character: string) => `O caractere ${character} não existe aqui.`,
  taggedTemplate: () => "O modelo com etiqueta não existe aqui.",
  newOnlyDate: () => "new só existe com Date: new Date(…).",
  expectedOpenParenAfterNewDate: () => "Esperava ( depois de new Date: new Date(…).",
  regularExpression: () => "A expressão regular não existe aqui.",
  expectedColumn: () => "Esperava a coluna, como pedido.id: tabela.coluna ou esquema.tabela.coluna.",
  sampleNeedsColumn: () => "Esperava ( depois de random.of: random.of(pedido.id).",
  notAFunction: (callee: string) => `${callee} não é uma função: as funções são as da lista da RN-VAR-009.`,
  functionIsNotAValue: (name: string) => `${name} é uma função, e funções não são valores aqui: chame-a, como ${name}(…).`,
  namespaceIsNotAValue: (name: string) => `${name} é um nome do Prism, e não um valor: use ${name}.nome(…), como ${name === "Math" ? "Math.max(…)" : name === "random" ? "random.int(…)" : name === "Date" ? "Date.now()" : "date.today()"}.`,
  queryOnlyWhole: () => "Uma consulta só pode ser o valor inteiro da variável: let x = (SELECT …)",
  sampleOnlyWhole: () => "random.of só pode ser o valor inteiro da variável: let x = random.of(pedido.id).",
  queryNotClosed: (line: number) => `A consulta não terminou: falta o ) que fecha o ( da linha ${line}.`,
  noVarOrFunctionHere: (what: string) => `${what} não existe aqui.`,

  // Os tipos (RN-VAR-004).
  emptyListNeedsType: (name: string) => `Anote o tipo da lista vazia: let ${name}: number[] = []`,
  mixedList: (a: string, b: string) => `A lista mistura ${a} e ${b}.`,
  notFit: (name: string, type: string, shown: string) => `${name} é ${type}, mas recebeu ${shown}.`,
  nullOnlyNullable: (name: string) => `${name} é null: para guardar outro valor, anote o tipo, como let ${name}: number | null = null`,
  constNeedsValue: (name: string) => `const ${name} precisa de um valor: const ${name} = …`,
  letNeedsType: (name: string) => `Anote o tipo de ${name}, que não tem valor: let ${name}: number`,
  sqlMustBeConst: (name: string) => `A variável sql ${name} tem de ser const.`,
  sqlFromQuery: () => "Um valor sql não pode vir de uma consulta.",
  sqlNoListOrNull: () => "O tipo sql não tem lista nem | null.",
  sqlTooLong: () => `O valor sql passou de ${group(limits.sqlLength)} caracteres.`,
  sqlNeedsText: (shown: string) => `Uma variável sql guarda um texto, e recebeu ${shown}.`,
  sqlEndsInside: (name: string, what: string) => `O valor de ${name} (sql) termina dentro de ${what} e engoliria o resto do comando.`,
  sqlHasNul: () => "Um valor sql não pode ter o caractere U+0000.",
  sqlUnbalanced: (name: string) => `O valor de ${name} (sql) não tem os parênteses equilibrados e engoliria o resto do comando.`,
  sqlVariableInExpression: (name: string) => `${name} é sql, e uma variável sql só entra no SQL (@${name}).`,

  // As interfaces e os `type` (RN-VAR-002 a 004): a forma conferida contra os valores, com a semântica do TypeScript.
  typeNameReserved: (name: string) => `${name} não pode ser nome de tipo: escolha outro.`,
  expectedTypeName: () => "Esperava o nome do tipo.",
  expectedOpenBrace: (name: string) => `Esperava { depois de ${name}: interface ${name} { campo: tipo }.`,
  expectedColonInMember: (name: string) => `Esperava : depois do campo ${name}, como ${name}: string.`,
  duplicateMember: (name: string) => `O campo ${name} aparece duas vezes.`,
  sqlNotInType: () => "O tipo sql não entra numa interface nem num type: declare const nome: sql.",
  expectedEndOfType: (name: string, found: string) => `Esperava ; ou o fim da linha depois do tipo ${name}, e veio ${found}.`,
  typeAlreadyDeclared: (name: string, line: number) => `O tipo ${name} já foi declarado na linha ${line}.`,
  typeCycle: (path: readonly string[]) => `O tipo ${path[0]} se refere a si mesmo: ${path.join(" → ")}.`,
  typeTooDeep: (name: string) => `O tipo ${name} passou de ${limits.depth} níveis de tipos com nome.`,
  extendsNotObject: (base: string, type: string) => `Uma interface só estende uma interface ou um type de objeto, e ${base} é ${type}.`,
  extendsConflict: (name: string, base: string, field: string) => `${name} não pode estender ${base}: o campo ${field} tem outro tipo em ${base}.`,
  typeHasError: (name: string, line: number) => `O tipo ${name} tem um erro (linha ${line}).`,
  excessField: (field: string, type: string) => `O campo ${field} não existe em ${type}.`,
  missingFields: (name: string, fields: readonly string[], type: string) =>
    fields.length === 1 ? `${name} não tem o campo ${fields[0]}, que ${type} pede.` : `${name} não tem os campos ${fields.slice(0, -1).join(", ")} e ${fields[fields.length - 1]}, que ${type} pede.`,
  queryNullColumn: (column: string, name: string, type: string, field: string, fieldType: string) => `A coluna ${column} de ${name} veio nula, e ${type}.${field} é ${fieldType}.`,

  // O `random.of` (RN-VAR-010): `written` é a chamada como está no script, `random.of(cliente.id)` ou `random.of(cliente.id, 10)`.
  sampleEmpty: (written: string) => `${written}: a coluna não tem valores.`,
  sampleTooFew: (written: string, total: number) => `${written}: a coluna só tem ${total === 1 ? "1 valor" : `${group(total)} valores`}.`,
  sampleCountInvalid: (shown: string) => `random.of: quantos tem de ser um inteiro de 1 a 100, e recebeu ${shown}.`,
  sampleTruncated: (written: string) => `${written}: o valor sorteado passa de 10.000 caracteres e não vem inteiro do banco.`,
  sampleChanged: (written: string) => `${written}: a coluna mudou durante o sorteio; execute de novo.`,
  sampleNotEvaluatedHere: (name: string) => `O random.of de ${name} roda no banco, na vez dele no script.`,

  // O tipo de uma coluna (RN-VAR-004).
  columnMissing: (written: string) => `A coluna ${written} não existe.`,
  columnIsList: (column: string) => `A coluna ${column} é uma lista do banco, e o tipo de coluna não guarda lista.`,
  /** A coluna que a execução não leu antes de avaliar: o executor da aba lê todas as do que vai (RN-VAR-019). */
  columnNotRead: (written: string) => `O tipo da coluna ${written} não foi lido do catálogo.`,

  // A variável de consulta (RN-VAR-011 e 013).
  queryTooManyRows: (name: string, rows: number, type: string) => `A consulta de ${name} devolveu ${group(rows)} linhas, e ${name} é ${type}: anote ${type}[] para uma lista.`,
  queryBinaryColumn: (column: string) => `A coluna ${column} é binária, e variável não guarda binário.`,
  queryNotJsNumber: (value: string, column: string) => `O valor ${value} da coluna ${column} não é um número do JavaScript.`,
  queryDuplicateColumn: (name: string, column: string) => `A consulta de ${name} tem duas colunas chamadas ${column}: dê um apelido a uma delas.`,
  queryForbiddenColumn: (column: string) => `A coluna ${column} não pode ser campo de uma variável: dê outro apelido a ela.`,
  queryTooLarge: (name: string, reason: "rows" | "columns" | "bytes") =>
    `A consulta de ${name} passou de ${reason === "rows" ? `${group(limits.queryRows)} linhas` : reason === "columns" ? `${limits.queryColumns} colunas` : "16 MiB"}.`,
  queryNotEvaluatedHere: (name: string) => `A consulta de ${name} roda no banco, na vez dela no script.`,
  /** O Worker foi pedido a avaliar uma declaração sem valor: quem pergunta os valores (RN-VAR-021) não a mandou. */
  answerMissing: (name: string) => `${name} não tem valor: escreva o valor na pergunta.`,

  // Os operadores (RN-VAR-008).
  plusOperands: (shown: string) => `+ soma números ou junta textos; ${shown} não é nenhum dos dois.`,
  nullInText: () => "Não dá para juntar null a um texto: use nome ?? ''.",
  numbersOnly: (operator: string, shown: string, type: string) => `${operator} é só para números; ${shown} é ${type}.`,
  compareKinds: (operator: string) => `${operator} compara números com números, textos com textos e datas com datas.`,
  equalityKinds: (operator: string) => `${operator} não compara listas nem objetos.`,
  ternaryTypes: (a: string, b: string) => `As duas saídas de ? : têm de ter o mesmo tipo: ${a} e ${b}.`,
  logicalTypes: (a: string, b: string) => `Os dois lados de && e || têm de ter o mesmo tipo: ${a} e ${b}.`,
  objectNoField: (name: string, field: string, fields: readonly string[]) => `${/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(name) ? `O objeto ${name}` : "O objeto"} não tem o campo ${field}. Os campos são: ${fields.join(", ")}.`,
  indexOutOfList: (name: string, length: number) => `${name} não existe: a lista tem ${length} ${length === 1 ? "item" : "itens"}.`,
  indexOutOfText: (name: string, length: number) => `${name} não existe: o texto tem ${length} ${length === 1 ? "caractere" : "caracteres"}.`,
  negativeIndex: (name: string) => `Use ${name}.at(-1) para contar do fim.`,
  indexNotInteger: () => "O índice tem de ser um número inteiro.",
  readFieldOfNull: (field: string) => `Não dá para ler ${field} de null.`,
  notIndexable: (type: string) => `${type} não tem itens nem campos para ler.`,
  indexKind: () => "Entre [ ] vai um número (lista e texto) ou um texto (objeto).",
  spreadNotList: (shown: string) => `... espalha uma lista, e ${shown} não é uma.`,
  objectToText: () => "Um objeto não vira texto: use um campo, como p.id.",

  // As funções (RN-VAR-009 e 010).
  argCount: (fn: string, expected: string, received: number) => `${fn} espera ${expected}, e recebeu ${received}.`,
  argType: (fn: string, type: string, position: number, shown: string) => `${fn} espera ${type} no argumento ${position}, e recebeu ${shown}.`,
  numberNotParsed: (text: string) => `Number(${shown(text)}) não é um número.`,
  fixedDigits: () => "toFixed aceita de 0 a 20 casas.",
  replaceAllEmpty: () => "replaceAll não aceita um texto vazio em de.",
  splitTooMany: () => `split passaria de ${group(limits.listItems)} pedaços.`,
  dateAddInteger: (fn: string) => `${fn} espera um número inteiro em n.`,
  dateOfInvalid: (text: string) => `A data ${text} não existe.`,
  randomMinMax: (min: string, max: string) => `random.int: min (${min}) é maior que max (${max}).`,
  randomIntRange: () => "random.int: max - min passa de 9.007.199.254.740.991.",
  randomIntegers: (fn: string) => `${fn}: min e max têm de ser números inteiros.`,
  randomDecimalMinMax: (min: string, max: string) => `random.decimal: min (${min}) é maior que max (${max}).`,
  randomDecimalPlaces: () => "random.decimal: casas vai de 0 a 10.",
  randomDecimalRange: () => "random.decimal: o intervalo é grande demais para essas casas.",
  randomStringLength: () => "random.string: o tamanho vai de 0 a 10.000.",
  randomStringLetters: () => "random.string: as letras vão de 1 a 256 caracteres.",
  randomPickEmpty: () => "random.pick recebeu uma lista vazia.",
  randomDateOrder: () => "random.date: a primeira data vem depois da segunda.",
  unknownMember: (member: string, owner: string) => `${member} não existe em ${owner}.`,

  // O @nome (RN-VAR-015 a 017).
  objectWithoutField: (name: string, field: string) => `${name} é uma linha (objeto): use um campo, como @${name}.${field}.`,
  listOfObjects: (name: string) => `${name} é uma lista de linhas, que não vai para o SQL: faça a consulta com uma coluna só.`,
  fieldOfNullPlain: (name: string, field: string) => `${name} é null, e não tem o campo ${field}.`,
  fieldOfNonObject: (name: string, type: string) => `${name} é ${type}, e não tem campos.`,
  listOutsideParentheses: (name: string) => `@${name} é uma lista e só entra numa lista entre parênteses, como IN (@${name}).`,
  listAfterAny: (name: string) => `Use IN (@${name}): a lista vira vários valores, e o ANY do PostgreSQL espera uma lista do banco.`,
  emptyList: (name: string) => `@${name} está vazia, e IN () não existe em SQL: nada foi executado.`,
  nullInList: (name: string) => `@${name} é null, e IN (null) nunca acha nada: anote ${name}: number[] para ter a lista, ou trate o caso.`,
  markerAlreadyThere: (marker: string) => `O comando já tem um marcador de parâmetro (${marker}), e o Prism numera os das variáveis: tire o ${marker} do texto.`,
  sqlMadeSeveral: (name: string, count: number) => `O valor de ${name} (sql) fez o comando virar ${count} comandos: nada foi executado.`,
  sqlHasMarker: (name: string) => `O valor de ${name} (sql) tem um marcador de parâmetro (? ou $1), que o Prism não sabe numerar.`,
  numberTooManyDigits: (digits: number, engine: "Db2" | "Informix", max: number) => `O número tem ${digits} dígitos, e o ${engine} guarda até ${max}${engine === "Informix" ? " pelo driver" : ""}.`,
  numberTooLong: (length: number) => `O número tem ${length} caracteres, e o Prism manda até ${limits.numberCharacters}.`,
  noValue: (name: string) => `${name} não tem valor.`,
  valueNotInText: (name: string, type: string) => `${name} é ${type}, que não vai para o SQL.`,
  sentWithoutLiteral: (markers: string) => `-- Sem literal (ficam como marcador): ${markers}`,
  sentSqlNote: (name: string) => `sql: @${name} (texto entrou no comando)`,
} as const;

/** O texto de uma frase de erro entre aspas simples, para citar um valor. */
function shown(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
