import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { EditorState, Text } from "@codemirror/state";

import type { Engine } from "@/components/ui/engine-tag";

import { visitCode } from "./sql-statements";
import { allowedBefore } from "./variables/at-names";
import { closedNames, namespaceMembers } from "./variables/catalog";
import { methodNames } from "./variables/functions";
import { readScript, type ModelItem, type ScriptModel } from "./variables/script";
import { analysisMaxChars } from "./variables-analysis";
import { variablesEditorCopy as copy } from "./variables-editor.copy";
import type { VariableEntry } from "./variables-extension";

/*
 * O autocompletar das variáveis (RN-CONFIG-004 e RN-VAR-025). Depois de um `@` no SQL completa os nomes declarados acima do cursor; dentro das declarações, os nomes
 * declarados, os da lista fechada (`Math.`, `random.`, `date.`, `Date.now`, `Number`, `String`) e, depois de um `.`, os métodos da espécie do valor quando ela se
 * sabe. Nunca consulta o banco. Lê o script de novo a cada pedido (uma vez por versão do texto): o nome que a pessoa acabou de declarar tem de aparecer, e a leitura
 * em segundo plano do editor ainda pode não ter rodado.
 */

/** Acima disto o autocompletar não lê o script para as variáveis: cada pedido leria o texto inteiro. */
const completionMaxChars = Math.min(analysisMaxChars, 200_000);

export type VariablesCompletionOptions = {
  engine: () => Engine | undefined;
  blankLines: () => boolean;
  /** Os valores da aba (o tipo de cada variável que já foi avaliada), ou nulo sem armazém. */
  values: () => ReadonlyMap<string, VariableEntry> | null;
};

/** A espécie do valor de um tipo escrito como o painel o escreve (`number`, `string[]`, `Date (dia)`, `number | null`), ou nula quando não se sabe. */
export function kindOfType(type: string | null): "number" | "string" | "list" | "date" | null {
  if (type === null) return null;
  const base = type.replace(/\s*\|\s*null\s*$/, "").trim();
  if (base.endsWith("[]")) return "list";
  if (base === "number" || base === "string") return base;
  if (base.startsWith("Date")) return "date";
  return null;
}

/** Quando o cursor está dentro do valor de uma declaração: o que há antes dele na declaração, depois do `=`. Nulo no nome, na anotação, dentro de um texto ou de um comentário. */
export function valueBefore(declarationText: string): string | null {
  let index = 0;
  let equals = -1;
  let quote: string | null = null;
  let comment: "line" | "block" | null = null;
  const length = declarationText.length;

  // Antes do `=`: o `let`, o nome e a anotação. Tudo isso é nome e tipo, e nada se completa ali.
  for (; index < length; index++) {
    const character = declarationText[index];
    if (comment === "line") {
      if (character === "\n") comment = null;
    } else if (comment === "block") {
      if (character === "*" && declarationText[index + 1] === "/") {
        comment = null;
        index++;
      }
    } else if ((character === "/" && declarationText[index + 1] === "/") || (character === "-" && declarationText[index + 1] === "-")) comment = "line";
    else if (character === "/" && declarationText[index + 1] === "*") comment = "block";
    else if (character === "=") {
      equals = index;
      break;
    }
  }
  if (equals < 0) return null;

  // Depois do `=`: dentro de um texto (`'`, `"`, crase) ou de um comentário não se completa nada.
  comment = null;
  for (index = equals + 1; index < length; index++) {
    const character = declarationText[index];
    if (quote !== null) {
      if (character === "\\") index++;
      else if (character === quote) quote = null;
      else if (character === "\n" && quote !== "`") quote = null;
    } else if (comment === "line") {
      if (character === "\n") comment = null;
    } else if (comment === "block") {
      if (character === "*" && declarationText[index + 1] === "/") {
        comment = null;
        index++;
      }
    } else if ((character === "/" && declarationText[index + 1] === "/") || (character === "-" && declarationText[index + 1] === "-")) comment = "line";
    else if (character === "/" && declarationText[index + 1] === "*") comment = "block";
    else if (character === "'" || character === '"' || character === "`") quote = character;
  }
  return quote === null && comment === null ? declarationText.slice(equals + 1) : null;
}

/** O nome (a palavra) antes do cursor e, antes dele, o nome com o ponto que o abre: `Math.ma` → `{ owner: "Math", partial: "ma" }`. */
export function memberContext(valueText: string): { owner: string | null; partial: string } {
  const match = /(?:([\p{ID_Start}_$][\p{ID_Continue}$]*)\s*\.\s*)?([\p{ID_Continue}$]*)$/u.exec(valueText);
  return match === null ? { owner: null, partial: "" } : { owner: match[1] ?? null, partial: match[2] };
}

function itemAtPosition(model: ScriptModel, position: number): ModelItem | null {
  for (const item of model.items) if (item.start <= position && position <= item.end) return item;
  return null;
}

/** O script lido uma vez por versão do texto: o pedido seguinte, na mesma versão, reaproveita. */
function createModelCache() {
  let held: { doc: Text; engine: Engine | undefined; blankLines: boolean; model: ScriptModel | null } | null = null;

  return (state: EditorState, engine: Engine | undefined, blankLines: boolean): ScriptModel | null => {
    if (held !== null && held.doc === state.doc && held.engine === engine && held.blankLines === blankLines) return held.model;

    let model: ScriptModel | null = null;
    if (state.doc.length <= completionMaxChars) {
      const text = state.doc.toString();
      // Sem `let`, `const` nem `@` não há variável a completar: o texto comum de SQL nem passa pelo leitor.
      if (/\b(?:let|const)\b|@/.test(text)) {
        try {
          model = readScript(text, engine, { blankLines });
        } catch {
          model = null;
        }
      }
    }
    held = { doc: state.doc, engine, blankLines, model };
    return model;
  };
}

const variable = (name: string, detail: string): Completion => ({ label: name, type: "variable", detail });

export type VariablesCompletion = {
  /** As fontes que entram na lista do autocompletar. */
  sources: CompletionSource[];
  /** Se o cursor está onde o SQL não completa: dentro de uma declaração, ou logo depois do `@` de uma variável. As palavras-chave e os nomes da árvore se calam ali. */
  quietsSql: (state: EditorState, position: number) => boolean;
};

export function variablesCompletion(options: VariablesCompletionOptions): VariablesCompletion {
  const modelOf = createModelCache();
  const read = (state: EditorState) => modelOf(state, options.engine(), options.blankLines());

  /** O tipo que se mostra de uma variável: o do armazém (o que foi avaliado), ou a anotação. */
  const typeOf = (model: ScriptModel, name: string): string | null => options.values()?.get(name)?.type ?? model.declarations.get(name)?.annotation?.text ?? null;

  const declaredAbove = (model: ScriptModel, item: ModelItem) => [...model.declarations.values()].filter((declaration) => declaration.itemIndex < item.index);

  /** O `@nome` no SQL: os nomes declarados acima do comando. */
  function afterAt(context: CompletionContext, model: ScriptModel, item: ModelItem): CompletionResult | null {
    const match = context.matchBefore(/@[\p{ID_Continue}$]*/u);
    if (match === null || item.atScan === null || item.atScan.inBody) return null;

    // O `@` tem de ser SQL de verdade: dentro de um texto, de um comentário ou de um nome entre aspas ele não é variável.
    let isCode = false;
    visitCode(item.text, options.engine(), (position, code) => {
      if (code === 64 && item.start + position === match.from) isCode = true;
    });
    // E o caractere de antes tem de deixar o `@` ser variável: no PostgreSQL o `<@x` é o operador `<@` (RN-VAR-015), e ali não há nome a completar.
    if (!isCode || !allowedBefore(item.text, match.from - item.start, options.engine())) return null;

    const options_ = declaredAbove(model, item).map((declaration) => variable(declaration.name, typeOf(model, declaration.name) ?? copy.completion.variable));
    return options_.length === 0 ? null : { from: match.from + 1, options: options_, validFor: /^[\p{ID_Continue}$]*$/u };
  }

  /** Dentro do valor de uma declaração: os nomes, a lista fechada e os membros. */
  function insideValue(context: CompletionContext, model: ScriptModel, item: ModelItem): CompletionResult | null {
    const valueText = valueBefore(context.state.sliceDoc(item.start, context.pos));
    if (valueText === null) return null;

    const { owner, partial } = memberContext(valueText);
    const from = context.pos - partial.length;

    if (owner !== null) {
      const members = namespaceMembers.get(owner);
      if (members !== undefined) {
        const completions: Completion[] = [
          ...[...members.functions].map((name): Completion => ({ label: name, type: "function", detail: copy.completion.function })),
          ...[...members.constants].map((name): Completion => ({ label: name, type: "constant", detail: copy.completion.constant })),
        ];
        return { from, options: completions, validFor: /^[\p{ID_Continue}$]*$/u };
      }

      const declaration = model.declarations.get(owner);
      const kind = declaration !== undefined && declaration.itemIndex < item.index ? kindOfType(typeOf(model, owner)) : null;
      const methods = kind === null ? undefined : methodNames.get(kind);
      return methods === undefined ? null : { from, options: methods.map((name): Completion => ({ label: name, type: "method", detail: copy.completion.method })), validFor: /^[\p{ID_Continue}$]*$/u };
    }

    // Sem ponto: só com uma palavra começada (ou pedido com Ctrl+Espaço), e que não começa por número.
    if ((partial === "" && !context.explicit) || /^\p{Nd}/u.test(partial)) return null;
    const names = declaredAbove(model, item).map((declaration) => variable(declaration.name, typeOf(model, declaration.name) ?? copy.completion.variable));
    const closed = [...closedNames].map((name): Completion => ({ label: name, type: "namespace", detail: copy.completion.namespace }));
    return { from, options: [...names, ...closed], validFor: /^[\p{ID_Continue}$]*$/u };
  }

  const source: CompletionSource = (context) => {
    const model = read(context.state);
    if (model === null) return null;

    const item = itemAtPosition(model, context.pos);
    if (item === null) return null;
    return item.kind === "statement" ? afterAt(context, model, item) : insideValue(context, model, item);
  };

  const quietsSql = (state: EditorState, position: number): boolean => {
    const model = read(state);
    if (model === null) return false;

    const item = itemAtPosition(model, position);
    if (item === null) return false;
    if (item.kind !== "statement") return true;

    // Depois do `@`, com variáveis declaradas: o nome é de uma variável (sem variáveis, `@coluna` é o valor absoluto do PostgreSQL, e as colunas continuam a completar).
    const start = position - (/[\p{ID_Continue}$]*$/u.exec(state.sliceDoc(Math.max(0, position - 80), position))?.[0].length ?? 0);
    return model.declaredNames.size > 0 && start > 0 && state.sliceDoc(start - 1, start) === "@" && item.atScan?.inBody !== true && allowedBefore(item.text, start - 1 - item.start, options.engine());
  };

  return { sources: [source], quietsSql };
}
