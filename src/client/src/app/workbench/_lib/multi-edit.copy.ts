import { formatCount } from "@/lib/utils/format";

const number = (count: number) => count.toLocaleString("pt-BR");
const lines = (count: number) => (count === 1 ? "1 linha" : `${number(count)} linhas`);

/** A lista dos nomes como a frase os junta: "preco", "preco e status", "preco, status e cor". */
function joined(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Os textos da edição de várias células de uma vez e da coluna inteira (seção 38: RN-EDIT-017 a 022). Os da edição de uma célula seguem em `records.copy.ts`, e
 * os da seleção em `grid-selection.copy.ts`.
 */
export const multiEditCopy = {
  // RN-EDIT-017: a dica do campo de edição, para quantas a edição vale.
  hint: {
    cells: (count: number, column: string) => `Vale para as ${number(count)} células escolhidas da coluna ${column}.`,
    all: (column: string) => `Vale para todas as linhas do resultado, também as que não foram carregadas (coluna ${column}).`,
  },
  // RN-EDIT-013: o "Editar célula" da barra diz para quantas a edição vale.
  bar: {
    cells: (count: number, column: string) => `Vale para as ${number(count)} células escolhidas da coluna ${column}.`,
    all: (column: string) => `Vale para todas as linhas do resultado (coluna ${column}).`,
  },
  // Confirmar o campo que valia para várias sem ter mexido no texto não aplica nada.
  untouched: "O valor não mudou: nada foi alterado. Para levar o valor desta célula às outras escolhidas, digite o valor por cima, ou mova o cursor e apague e escreva um caractere.",
  // O "Definir como nulo" diz para quantas vale.
  setNull: {
    cells: (count: number) => `Definir as ${number(count)} células como nulo`,
    all: "Definir a coluna inteira como nulo",
  },
  // A conferência de todas as células antes de o campo abrir: a primeira que não pode receber o valor, na ordem da grade, com o número da linha.
  refused: (reason: string) => `A edição não foi feita: ${reason}.`,
  reasons: {
    truncated: (row: string) => `a célula da ${row} chegou cortada`,
    deleted: (row: string) => `a ${row} está marcada para exclusão; Desfazer alteração a devolve`,
    keyTruncated: (row: string) => `a chave da ${row} chegou cortada`,
    keyGenerated: (row: string) => `a chave da ${row} foi gerada pelo banco; execute de novo para editá-la`,
    noRowHere: (row: string, table: string) => `na ${row}, ${table} não tem linha (a chave veio nula)`,
    generated: (row: string) => `a célula da ${row} foi preenchida pelo banco; execute de novo para vê-la`,
  },
  row: (row: number) => `linha ${number(row)}`,
  newRow: (position: number) => `linha nova ${number(position)}`,
  // O teto de células de uma vez (o mesmo das linhas que a grade carrega para copiar, RN-GRADE-023).
  tooMany: "A edição vale para até 100.000 células de uma vez: escolha menos células, ou escolha a coluna inteira pelo cabeçalho.",
  // A montagem das pendências de um grupo grande, em partes, com o "Cancelar".
  applying: (count: number) => `Aplicando o valor a ${formatCount(count, "célula", "células")}…`,
  applyingBusy: "Aplicando o valor às células escolhidas.",
  cancel: "Cancelar",

  // RN-EDIT-018: a coluna inteira, uma alteração só.
  unavailable: (reason: string) => `Indisponível: ${reason}.`,
  wholeReasons: {
    join: "num resultado de junção, a coluna inteira não se altera: escolha as células da coluna (arraste, ou Shift+clique), e a edição vale para elas",
    key: (column: string, table: string) => `${column} é da chave de ${table}: na coluna inteira, todas as linhas ficariam com a mesma chave`,
    repeatedKey: (column: string, table: string) => `${column}, da chave de ${table}, aparece com o mesmo nome em mais de uma coluna do resultado`,
    notRead: "a coluna inteira executa de novo o comando do resultado, e ele não é só de leitura",
    limit: "o comando limita as linhas sem uma ordem, e o banco pode escolher outras linhas ao executar de novo: acrescente um ORDER BY, ou escolha as células da coluna",
    sample: "o comando sorteia as linhas, e o banco escolheria outras ao executar de novo: escolha as células da coluna",
  },
  // A coluna inteira como a faixa e o cabeçalho a escrevem: "preco = 10.00", o valor como o "Ver SQL" o escreve.
  assignment: (column: string, literal: string) => `${column} = ${literal}`,
  allRows: (assignments: readonly string[]) => `Em todas as linhas do resultado: ${assignments.join("; ")}.`,
  headerPending: (assignment: string) => `Alteração pendente em todas as linhas: ${assignment}`,
  headerMark: "alteração pendente em todas as linhas",
  // RN-EDIT-012: no Informix sem log, a faixa diz também que a coluna inteira é um comando só, gravado primeiro.
  oneAtATime: "A da coluna inteira é um comando só, gravado primeiro, e não há como desfazê-lo.",
  // A célula da linha lida com o valor da coluna inteira, e a com pendência própria por cima dela.
  wholeTitle: (read: string) => `Valor lido: ${read}`,
  ownTitle: (whole: string) => `Valor da coluna inteira: ${whole}`,
  // RN-EDIT-021: no Informix sem log, a coluna que falhou no meio pode ter ficado gravada em parte das linhas.
  uncertain: "o valor desta coluna pode estar gravado em parte das linhas",
  // O "Desfazer alteração" com a coluna escolhida inteira diz a conta; com só algumas células dela, a da coluna inteira não se desfaz.
  undo: {
    columns: (names: readonly string[], cells: number) =>
      `Desfazer a alteração ${names.length === 1 ? `da coluna ${names[0]}` : `das colunas ${joined(names)}`}${cells === 0 ? "" : ` e de ${cells === 1 ? "1 célula" : `${number(cells)} células`}`}`,
    wholeOnly: "A alteração desta coluna vale para todas as linhas: escolha a coluna inteira, pelo cabeçalho, para desfazê-la.",
  },

  // RN-EDIT-019: contar e confirmar.
  counting: "Contando as linhas do resultado…",
  countFailed: "Não foi possível contar as linhas do resultado.",
  tooLarge: "O Salvar passa de 32 MiB de alterações: salve em partes, ou use a coluna inteira pelo cabeçalho.",
  question: {
    title: (columns: readonly string[], rows: number, table: string) =>
      `Alterar ${columns.length <= 2 ? joined(columns) : `${number(columns.length)} colunas`} em ${lines(rows)} de ${table}?`,
    none: (table: string) => `Nenhuma linha de ${table} será alterada`,
    goesTo: "O valor vai para todas as linhas que o comando do resultado devolve agora, também as que a grade não carregou:",
    noRows: "O comando do resultado não devolve nenhuma linha agora: a alteração da coluna inteira não muda nada.",
    changed: (grid: number, counted: number) => `A grade tem ${lines(grid)}, e o comando devolve ${number(counted)} agora: o resultado mudou desde que foi lido.`,
    kept: "Este resultado é de um comando anterior do script. O banco o executa de novo agora, depois dos comandos que vieram depois dele.",
    ties: "O comando limita as linhas: se a ordem tiver empates, o banco pode escolher outras linhas que as da grade.",
    triggers: "Gatilhos e chaves estrangeiras com ON UPDATE agem sobre essas linhas, e o número acima conta só as da tabela.",
    others: (count: number) => (count === 1 ? "O Salvar grava também a outra alteração não salva." : `O Salvar grava também as outras ${number(count)} alterações não salvas.`),
    after: { result: "Depois, a aba executa o comando de novo, para mostrar o que o banco tem.", table: "Depois, os registros são lidos de novo.", kept: "Depois, esta aba fica com as linhas que leu, com o valor novo; Executar este comando lê todas de novo." },
    oneAtATime: "Este banco não tem log de transação: a alteração é gravada na hora, e não há como desfazê-la; se o banco recusar no meio, parte das linhas fica alterada.",
    why: "Você vê este aviso sempre que uma alteração vale para a coluna inteira.",
    confirm: (rows: number) => (rows === 0 ? "Salvar" : `Alterar ${lines(rows)}`),
    viewSql: "Ver SQL",
  },

  // RN-EDIT-021: o "Salvar" com a coluna inteira, o cancelamento e o Informix sem log.
  savingFor: (seconds: number) => `Salvando… ${number(seconds)} s`,
  failed: (columns: readonly string[]) => `A alteração ${columns.length === 1 ? `da coluna ${columns[0]}` : `das colunas ${joined(columns)}`} falhou. Nada foi gravado.`,
  cancelled: "Salvar cancelado: nada foi gravado.",
  cancelledPartly: (applied: number, left: number) =>
    `Salvar cancelado: ${applied === 1 ? "1 alteração já estava gravada" : `${number(applied)} alterações já estavam gravadas`}; ${left === 1 ? "a outra continua pendente" : `as outras ${number(left)} continuam pendentes`}.`,
  unknown: "Não se sabe se o Salvar terminou: a sessão com o banco caiu sem responder ao cancelamento. Execute o comando de novo para ver o que o banco tem.",
  writtenAnyway: (columns: readonly string[], affected: number, counted: number, left: number) =>
    `${columns.length === 1 ? `A coluna ${columns[0]} foi alterada` : `As colunas ${joined(columns)} foram alteradas`} em ${lines(affected)}, e não ${counted === 1 ? "na 1 contada" : `nas ${number(counted)} contadas`}: o resultado mudou desde a contagem. Este banco não tem log de transação, e a alteração ficou gravada${left === 0 ? "." : `; ${left === 1 ? "a outra continua pendente" : `as outras ${number(left)} continuam pendentes`}.`}`,
  failedMidway: (columns: readonly string[]) =>
    `A alteração ${columns.length === 1 ? `da coluna ${columns[0]}` : `das colunas ${joined(columns)}`} falhou no meio. Este banco não tem log de transação: parte das linhas pode ter sido alterada. Execute o comando de novo para ver o que o banco tem.`,
  otherRows: "Execute o comando de novo para ver o que o banco tem nas outras linhas.",

  // RN-EDIT-022: o aviso do "Salvar" que terminou, e a nota da aba guardada do script, que não lê de novo.
  saved: (columns: readonly string[], rows: number, others: number) =>
    `${columns.length === 1 ? `Coluna ${columns[0]} atualizada` : `Colunas ${joined(columns)} atualizadas`} em ${lines(rows)}${others === 0 ? "" : `, e mais ${others === 1 ? "1 alteração salva" : `${number(others)} alterações salvas`}`}.`,
  keptNote: (columns: readonly string[], rows: number) =>
    `${columns.length === 1 ? `Coluna ${columns[0]} atualizada` : `Colunas ${joined(columns)} atualizadas`} em ${lines(rows)}; esta aba mostra só as que leu. Executar este comando lê todas de novo.`,
} as const;
