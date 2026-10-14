import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";

import type { Engine } from "@/components/ui/engine-tag";

import { gridFilterCopy } from "./grid-filter.copy";
import { completionCopy } from "./sql-completion.copy";
import { sqlName } from "./sql-completion";
import { quoteIdentifier } from "./table-sql";

const copy = gridFilterCopy.completion;

/** Uma coluna que o campo de filtro sugere: o nome como o banco o devolve e o tipo, que a lista mostra ao lado. */
export type FilterColumn = { name: string; type?: string };

/** As palavras do filtro (RN-TABELA-011), na ordem em que a lista as mostra depois das colunas. */
export const filterKeywords = ["AND", "OR", "NOT", "IS NULL", "IS NOT NULL", "LIKE", "IN", "BETWEEN", "ORDER BY", "ASC", "DESC"] as const;

/** A palavra em que o cursor está: letras (com acento ou não), números, `_` e `$`. */
const wordBeforeCursor = /[\p{L}\p{N}_$]+/u;
const wordChars = /^[\p{L}\p{N}_$]*$/u;
/** O começo de uma palavra do filtro de mais de uma palavra, já com o espaço: `is `, `is n`, `is not nu`, `order b`. */
const phraseBeforeCursor = /(?<![\p{L}\p{N}_$])(?:is(?:\s+not)?|order)\s+\p{L}*/iu;
const phraseChars = /^[\p{L} ]*$/u;

/** O nó da árvore do `lang-sql` em que o cursor está é texto entre aspas simples ou comentário: ali não se sugere nada. */
const quiet = new Set(["String", "LineComment", "BlockComment"]);

/**
 * As sugestões do campo de filtro (RN-TABELA-011): os nomes das colunas (nos Registros, as da tabela; no resultado da aba de consulta, as do resultado) e
 * as palavras do filtro (`AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL`, `LIKE`, `IN`, `BETWEEN`, `ORDER BY`, `ASC`, `DESC`). O nome é escrito como o banco
 * pede (`sqlName`, a regra do autocompletar do editor: cru só quando o banco o lê como está, e entre aspas em todo outro caso); com as aspas já abertas
 * (`"Cod`), o nome inteiro entre aspas (`quoteIdentifier`), sem palavras. Dentro de texto entre aspas simples, de comentário e depois de um ponto, nada.
 * As colunas e o banco são lidos na hora do pedido: a lista de colunas muda com o resultado na tela.
 */
export function filterCompletionSource(columns: () => readonly FilterColumn[], engine: () => Engine | undefined): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (quiet.has(node.name)) return null;

    if (node.name === "QuotedIdentifier" && context.state.sliceDoc(node.from, node.from + 1) === '"') {
      const options = columns().map((column): Completion => ({ label: quoteIdentifier(column.name), type: "property", ...(column.type === undefined ? {} : { detail: column.type }) }));
      return { from: node.from, to: context.pos, options, filter: true };
    }

    // A palavra de duas ou três (`is n`, `is not n`, `order b`): a lista continua com as que começam assim (`IS NULL`, `IS NOT NULL`, `ORDER BY`).
    const phrase = context.matchBefore(phraseBeforeCursor);
    if (phrase !== null) {
      const typed = phrase.text.toLowerCase().replace(/\s+/g, " ");
      const options = filterKeywords.filter((keyword) => keyword.includes(" ") && keyword.toLowerCase().startsWith(typed)).map((keyword): Completion => ({ label: keyword, type: "keyword", detail: copy.keyword }));
      if (options.length > 0) return { from: phrase.from, options, validFor: phraseChars };
    }

    const word = context.matchBefore(wordBeforeCursor);
    if (word === null && !context.explicit) return null;
    const from = word?.from ?? context.pos;
    // Depois de um ponto o nome seria de outra coisa (`t.coluna`): o campo não sabe de qual.
    if (from > 0 && context.state.sliceDoc(from - 1, from) === ".") return null;

    const written = (name: string) => sqlName(name, engine());
    const options: Completion[] = [
      ...columns().map((column): Completion => {
        const apply = written(column.name);
        return { label: column.name, type: "property", boost: 1, ...(apply === column.name ? {} : { apply }), detail: column.type ?? copy.column };
      }),
      ...filterKeywords.map((keyword): Completion => ({ label: keyword, type: "keyword", boost: -1, detail: copy.keyword })),
    ];
    return { from, options, validFor: wordChars };
  };
}

type FilterCompletionOptions = {
  columns: () => readonly FilterColumn[];
  engine: () => Engine | undefined;
  /** A chave do autocompletar do editor (RN-CONFIG-004): ligada, a lista abre ao digitar; desligada, só com Ctrl+Espaço. */
  activateOnTyping: boolean;
};

/**
 * O autocompletar do campo de filtro (RN-TABELA-011), no molde do editor (RN-CONFIG-004): a lista abre sem nada escolhido (Enter segue aplicando o filtro até
 * a pessoa descer com as setas), filtra por prefixo, Esc a fecha, e Ctrl+Espaço a abre sempre, também com o autocompletar ao digitar desligado.
 */
export function filterCompletion({ columns, engine, activateOnTyping }: FilterCompletionOptions): Extension {
  return [
    autocompletion({
      override: [filterCompletionSource(columns, engine)],
      activateOnTyping,
      selectOnOpen: false,
      filterStrict: true,
      icons: false,
      optionClass: (completion) => (completion.type === "keyword" ? "cm-completion-keyword" : ""),
      addToOptions: [{ position: 79, render: (completion) => (completion.detail === undefined ? null : document.createTextNode(" ")) }],
    }),
    EditorState.phrases.of({ Completions: completionCopy.listLabel }),
  ];
}
