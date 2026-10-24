import { syntaxTree } from "@codemirror/language";
import { EditorState, Transaction, type Extension } from "@codemirror/state";

import type { Engine } from "@/components/ui";

import { isInsideComment } from "./sql-statements";
import { scriptItemAt } from "./variables/script-items";

/**
 * As palavras que "converter palavras-chave para maiúsculas" (RN-CONFIG-004) escreve em maiúsculas: as reservadas e as que montam
 * o comando (SELECT, FROM, JOIN, ORDER BY, INSERT INTO, FETCH FIRST n ROWS ONLY…), em minúsculas aqui.
 *
 * É uma lista, e não "tudo o que o dialeto marca como palavra-chave", porque o `lang-sql` marca como palavra-chave também as
 * palavras que o banco só reserva em contexto: no dialeto do PostgreSQL, `id`, `name`, `type` e `count` são palavra-chave, e no SQL padrão,
 * `value`, `key`, `level` e `year`. Converter todas escreveria `SELECT ID, NAME, TYPE` por cima do nome das colunas do usuário. Um falso
 * negativo deixa a palavra como foi digitada; um falso positivo reescreve um nome dele. Por isso a lista é de palavras que ninguém usa
 * como nome sem aspas (e as que o dia a dia exige, como FIRST e ROWS), e fica de fora tudo o que é nome comum de coluna (`key`, `index`, `view`,
 * `open`, `close`, `text`…): `PRIMARY KEY` sai `PRIMARY key`, e é o preço.
 */
export const uppercaseWords: ReadonlySet<string> = new Set([
  // consulta
  ..."select from where group by order having limit offset fetch first next row rows only distinct all any some as with recursive union intersect except into values".split(" "),
  // alteração dos dados
  ..."insert update delete set returning using truncate".split(" "),
  // junção
  ..."join inner left right full outer cross natural on lateral".split(" "),
  // condição
  ..."and or not in is null like ilike between exists case when then else end true false asc desc".split(" "),
  // definição
  ..."create alter drop table add column constraint primary foreign references unique check default cascade restrict".split(" "),
  // transação e permissão
  ..."begin commit rollback savepoint grant revoke".split(" "),
  // janela, plano e o resto
  ..."over partition explain analyze cast for to if current_date current_time current_timestamp current_user".split(" "),
]);

/** Os nós da gramática em que a palavra pode ser convertida: a palavra-chave, `null` e `true`/`false`. Tipo, função e nome ficam de fora. */
const convertible = new Set(["Keyword", "Null", "Bool"]);

/**
 * Faz parte de um nome, em vez de terminá-lo: letra de qualquer alfabeto, marca de acento (o `é` escrito como `e` mais o acento), número,
 * sublinhado, cifrão, ponto (`t.order` é uma coluna) e o início de nomes do Db2 (`@`, `#`). Vale para o que vem depois da palavra (ela
 * continua) e para o que vem antes dela (ela é o fim de um nome maior).
 */
const nameChar = /[\p{L}\p{M}\p{N}_$.@#]/u;

/** Se `offset` está numa declaração ou numa reatribuição do script (RN-VAR-001): um texto sem `let` nem `const` não tem nenhuma. */
function insideDeclaration(sql: string, offset: number, engine: Engine | undefined, blankLines: () => boolean): boolean {
  if (!/\b(?:let|const)\b/.test(sql)) return false;
  const item = scriptItemAt(sql, offset, engine, { blankLines: blankLines() });
  return item !== null && item.kind !== "statement";
}

/**
 * Converte a palavra-chave que a pessoa acabou de digitar. Só age numa inserção pura que o teclado fez (`input.type`, e `input` do Enter e do
 * Tab) cujo primeiro caractere termina uma palavra: o espaço, a vírgula, o parêntese, o ponto e vírgula, a quebra de linha. Colar, aceitar uma
 * sugestão, desfazer e mudança feita por código passam sem ser tocados.
 *
 * A palavra é a do nó que termina onde a inserção começa, na gramática do dialeto da aba: nó de texto entre aspas, de comentário e de nome
 * entre aspas duplas nunca é `Keyword`. A exceção é o `{ ... }` do Informix, que a gramática não lê: o banco da aba (`engine`) diz se as
 * chaves abrem comentário, e a palavra dentro delas fica como foi digitada. A mudança entra na MESMA transação da tecla (um único desfazer
 * devolve a palavra e o caractere), tem o mesmo tamanho (o cursor não se mexe) e fica antes do ponto da inserção.
 *
 * Dentro de uma declaração (`let`, `const` e a reatribuição, seção 41) a palavra nunca é convertida (RN-CONFIG-004): `null`, `true` e `false` são da linguagem das
 * variáveis em minúsculas, e `NULL` e `TRUE` não existem nela. Quem diz onde há uma declaração é o leitor do script (`scriptItemAt`), no banco da aba; `blankLines` é a
 * preferência "A linha em branco separa os comandos", lida na hora (ela decide onde a reatribuição `b = 2` é um item).
 */
export function keywordCase(engine: Engine | undefined, blankLines: () => boolean = () => true): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    const event = transaction.annotation(Transaction.userEvent);
    if (!transaction.docChanged || (event !== "input" && event !== "input.type")) return transaction;

    const insertions: { at: number; first: string }[] = [];
    let changes = 0;
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes++;
      // O primeiro caractere (um par substituto, como o de um emoji, conta como um só).
      if (fromA === toA) insertions.push({ at: fromA, first: [...inserted.sliceString(0, 2)][0] ?? "" });
    });
    if (changes !== 1 || insertions.length !== 1 || insertions[0].first === "" || nameChar.test(insertions[0].first)) return transaction;

    const { at } = insertions[0];
    const word = syntaxTree(transaction.startState).resolve(at, -1);
    if (word.to !== at || !convertible.has(word.name)) return transaction;

    // O que vem ANTES da palavra: de nome (`papéis`, `pé_on`, `1select`), ela é o fim de um nome maior, e não uma palavra-chave. O `lang-sql` só
    // lê as letras ASCII num nome, e o `é` termina a palavra para ele. O caractere inteiro: um par substituto conta como um só.
    const before = [...transaction.startState.sliceDoc(Math.max(0, word.from - 2), word.from)].at(-1);
    if (before !== undefined && nameChar.test(before)) return transaction;

    const text = transaction.startState.sliceDoc(word.from, word.to);
    const upper = text.toUpperCase();
    if (text === upper || !uppercaseWords.has(text.toLowerCase())) return transaction;

    // A gramática do `lang-sql` não conhece o `{ ... }` do Informix: o que está escrito ali parece código a ela, e é texto de comentário.
    // Por último, porque é a única pergunta que lê o texto desde o começo.
    if (isInsideComment(transaction.startState.doc.toString(), word.from, engine)) return transaction;

    // A declaração: o texto que não tem `let` nem `const` nem chega a perguntar.
    if (insideDeclaration(transaction.startState.doc.toString(), word.from, engine, blankLines)) return transaction;

    // `sequential`: a posição é a do texto depois da tecla; a palavra fica antes dela, e a posição é a mesma nos dois.
    return [transaction, { changes: { from: word.from, to: word.to, insert: upper }, sequential: true }];
  });
}
