import { useEffect, useRef, useSyncExternalStore } from "react";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";

import { editorFont } from "@/app/settings/_lib/editor-style";
import { resolveScheme, subscribeSystemScheme, systemPrefersLight } from "@/app/settings/_lib/theme";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";

import { highlight } from "../../_lib/completion-theme";

/**
 * O texto do "Gerar SQL" num editor só de leitura (RN-GRADE-018): o realce do SQL do banco, a fonte do editor (RN-CONFIG-008) e as linhas longas quebradas na
 * largura dele, sem mudar o texto. Dá para escolher, copiar um pedaço (Ctrl+C) e rolar, e o foco começa nele (`autoFocus`; não onde a pessoa escreve a tabela
 * de destino, que o editor tiraria do campo ao aparecer). O texto é refeito a cada opção: o editor fica, e só o documento troca.
 */
export function SqlViewer({ text, engine, label, autoFocus = true }: { text: string; engine: Engine; label: string; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { preferences } = usePreferences();
  const systemIsLight = useSyncExternalStore(subscribeSystemScheme, systemPrefersLight, () => false);
  const dark = resolveScheme(preferences.theme, systemIsLight) === "dark";
  const font = editorFont(preferences.editor);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          drawSelection(),
          sql({ dialect: engine === 1 ? PostgreSQL : StandardSQL }),
          syntaxHighlighting(highlight),
          EditorView.contentAttributes.of({ "aria-label": label, "aria-readonly": "true" }),
          EditorView.theme(
            {
              "&": { maxHeight: "320px", backgroundColor: "var(--color-background)", color: "var(--color-ink)", fontSize: font.fontSize, border: "1px solid var(--color-border)", borderRadius: "6px" },
              "&.cm-focused": { outline: "2px solid var(--color-accent)", outlineOffset: "1px" },
              ".cm-scroller": { fontFamily: font.fontFamily, lineHeight: font.lineHeight, overflow: "auto" },
              ".cm-content": { padding: "10px 12px", caretColor: "var(--color-accent)" },
              ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--color-selection)" },
            },
            { dark },
          ),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o editor nasce uma vez por banco, fonte e tema; o texto troca no efeito de baixo, sem recriá-lo.
  }, [engine, label, dark, font.fontFamily, font.fontSize, font.lineHeight, autoFocus]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.state.doc.toString() === text) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  }, [text]);

  return <div ref={host} className="min-w-0" />;
}
