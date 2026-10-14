import { useEffect, useEffectEvent, useRef, useState } from "react";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText, tooltips } from "@codemirror/view";

import type { Engine } from "@/components/ui/engine-tag";

import { completionTheme, highlight } from "../_lib/completion-theme";
import { filterCompletion, type FilterColumn } from "../_lib/filter-completion";

/** O PostgreSQL é o banco de número 1; Db2 e Informix usam o SQL padrão (como no editor). */
const dialectOf = (engine: Engine | undefined) => (engine === 1 ? PostgreSQL : StandardSQL);

/** A troca do texto que veio de fora (o clique no cabeçalho, o "Filtrar" do menu, "Limpar"): não volta a quem a fez como digitação. */
const external = Annotation.define<boolean>();

/**
 * O campo é de uma linha só, como o `input` de antes: a quebra de linha que chega (colar, o Enter de outro mapa) vira espaço. É o que mantém o texto do campo
 * igual ao que vai no comando, e o `--` de um comentário no fim sem engolir uma linha seguinte que a pessoa não vê.
 */
export const singleLine: Extension = EditorState.transactionFilter.of((transaction) =>
  transaction.newDoc.lines === 1 ? transaction : [transaction, { changes: { from: 0, to: transaction.newDoc.length, insert: transaction.newDoc.sliceString(0, undefined, " ") }, sequential: true }],
);

/** Os atributos do texto editável (o `contenteditable` do CodeMirror): o nome do campo, a descrição, a recusa e nada de corretor. */
export function fieldAttributes({ label, describedBy, invalid }: { label: string; describedBy: string; invalid: boolean }): Record<string, string> {
  return { "aria-label": label, "aria-describedby": describedBy, "aria-invalid": invalid ? "true" : "false", spellcheck: "false", autocorrect: "off", autocapitalize: "off" };
}

/** O tema do campo: a altura de uma linha, sem borda própria (a caixa em volta é a do formulário), a fonte do editor SQL e a lista de sugestões do editor. */
const fieldTheme = EditorView.theme({
  "&": { flex: "1 1 0%", minWidth: "0", height: "28px", backgroundColor: "transparent", color: "var(--color-ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "28px", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" },
  ".cm-content": { padding: "0", caretColor: "var(--color-accent)" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--color-subtle)" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--color-selection)" },
  ...completionTheme("var(--font-editor)"),
});

type FilterFieldProps = {
  value: string;
  onChange: (text: string) => void;
  /** Enter (sem sugestão escolhida na lista): aplicar o filtro. */
  onSubmit: () => void;
  label: string;
  describedBy: string;
  invalid: boolean;
  placeholder: string;
  /** O banco da aba: as cores, o que é texto e comentário, e como o nome de uma coluna é escrito. */
  engine: Engine | undefined;
  /** As colunas que o campo sugere (RN-TABELA-011). Lidas na hora do pedido de sugestão. */
  columns: readonly FilterColumn[];
  /** A chave do autocompletar do editor (RN-CONFIG-004): ligada, sugere ao digitar; desligada, só com Ctrl+Espaço. */
  autocomplete: boolean;
};

/**
 * O campo de filtro (RN-TABELA-005, 010 e 011), nos Registros e no resultado da aba de consulta: um CodeMirror de uma linha, com as cores do SQL e o
 * autocompletar das colunas e das palavras do filtro. É controlado como o `input` de antes: `value` de fora troca o texto (o cursor vai ao fim), e cada
 * tecla chega a `onChange`. Enter aplica; com a lista de sugestões aberta e uma escolhida, Enter a aceita (a lista abre sem nada escolhido). Desfazer e
 * refazer valem no campo. A lista de sugestões vai para o `body`, para a barra do filtro não a recortar.
 */
export function FilterField({ value, onChange, onSubmit, label, describedBy, invalid, placeholder, engine, columns, autocomplete }: FilterFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [slots] = useState(() => ({ language: new Compartment(), completion: new Compartment(), attributes: new Compartment(), placeholder: new Compartment() }));
  const [initial] = useState(() => ({ value, engine, autocomplete, attributes: fieldAttributes({ label, describedBy, invalid }), placeholder }));
  const now = useRef({ columns, engine });
  useEffect(() => {
    now.current = { columns, engine };
  });

  const emitChange = useEffectEvent((text: string) => onChange(text));
  const emitSubmit = useEffectEvent(() => onSubmit());
  const completionFor = useEffectEvent((on: boolean) => filterCompletion({ columns: () => now.current.columns, engine: () => now.current.engine, activateOnTyping: on }));

  useEffect(() => {
    if (host.current === null) return;
    const submit = () => {
      emitSubmit();
      return true;
    };

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.value,
        selection: EditorSelection.cursor(initial.value.length),
        extensions: [
          singleLine,
          history(),
          slots.language.of(sql({ dialect: dialectOf(initial.engine) })),
          syntaxHighlighting(highlight),
          fieldTheme,
          tooltips({ parent: document.body }),
          // O autocompletar vem antes do Enter do campo: com uma sugestão escolhida, o Enter a aceita.
          slots.completion.of(completionFor(initial.autocomplete)),
          Prec.high(keymap.of([{ key: "Enter", run: submit }, { key: "Mod-Enter", run: submit }])),
          keymap.of([...standardKeymap, ...historyKeymap]),
          slots.attributes.of(EditorView.contentAttributes.of(initial.attributes)),
          slots.placeholder.of(placeholderText(initial.placeholder)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(external) === true)) emitChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [initial, slots]);

  // O texto que chega de fora (o clique no cabeçalho, o "Filtrar", "Limpar", a memória da aba) troca o do campo, com o cursor no fim.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: EditorSelection.cursor(value.length), annotations: external.of(true) });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: slots.language.reconfigure(sql({ dialect: dialectOf(engine) })) });
  }, [engine, slots]);

  useEffect(() => {
    const editor = view.current;
    if (editor !== null) editor.dispatch({ effects: slots.completion.reconfigure(completionFor(autocomplete)) });
  }, [autocomplete, slots]);

  useEffect(() => {
    view.current?.dispatch({ effects: [slots.attributes.reconfigure(EditorView.contentAttributes.of(fieldAttributes({ label, describedBy, invalid }))), slots.placeholder.reconfigure(placeholderText(placeholder))] });
  }, [label, describedBy, invalid, placeholder, slots]);

  return <div ref={host} data-filter-field="" className="flex h-7 min-w-0 flex-1 items-center font-editor text-ink" />;
}
