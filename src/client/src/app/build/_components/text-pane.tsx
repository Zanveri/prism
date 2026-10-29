import { useEffect, useEffectEvent, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { editorFont } from "@/app/settings/_lib/editor-style";
import { resolveScheme, systemPrefersLight } from "@/app/settings/_lib/theme";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { highlight } from "@/app/workbench/_lib/completion-theme";
import { Button } from "@/components/ui";

import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { dbmlLanguage } from "../_lib/dbml-language";
import {
  applyText,
  printText,
  textApplyDelayMs,
  type TextStatus,
} from "../_lib/text-apply";
import type { TextWarning } from "../_lib/text-merge";

export interface TextPaneProps {
  model: BuildModel;
  format: "sql" | "dbml";
  onChange: (next: BuildModel, warnings: TextWarning[]) => void;
}

export function TextPane({ model, format, onChange }: TextPaneProps) {
  const { preferences } = usePreferences();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestModelRef = useRef(model);
  latestModelRef.current = model;

  const [initialText] = useState(() => printText(model, format));
  const [status, setStatus] = useState<TextStatus>({
    kind: "applied",
    warnings: [],
  });

  const handleTextChanged = useEffectEvent((nextText: string) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const res = applyText(latestModelRef.current, format, nextText);
      setStatus(res.status);
      if (res.model !== null && res.status.kind === "applied") {
        onChange(res.model, res.status.warnings);
      }
    }, textApplyDelayMs);
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const font = editorFont(preferences.editor);
    const dark = resolveScheme(preferences.theme, systemPrefersLight()) === "dark";
    const languageExt =
      format === "dbml"
        ? dbmlLanguage
        : sql({
            dialect: model.engine === "postgresql" ? PostgreSQL : StandardSQL,
          });

    const themeExt = EditorView.theme(
      {
        "&": {
          height: "100%",
          backgroundColor: "var(--color-background)",
          color: "var(--color-ink)",
          fontSize: font.fontSize,
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily: font.fontFamily,
          lineHeight: font.lineHeight,
        },
        ".cm-content": {
          padding: "12px 16px 12px 0",
          caretColor: "var(--color-accent)",
          outline: "none",
        },
        ".cm-gutters": {
          backgroundColor: "var(--color-background)",
          color: "var(--color-subtle)",
          border: "none",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "48px",
          padding: "0 12px 0 0",
        },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in srgb, var(--color-ink) 3%, transparent)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--color-panel)",
          color: "var(--color-ink)",
        },
        ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
        ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
          { backgroundColor: "var(--color-selection)" },
      },
      { dark },
    );

    const state = EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(highlight),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        languageExt,
        themeExt,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handleTextChanged(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [format, initialText, model.engine, preferences.editor, preferences.theme]);

  function handleGoToLine(lineNumber: number) {
    const view = viewRef.current;
    if (!view) return;
    const clamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
    const line = view.state.doc.line(clamped);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        ref={hostRef}
        aria-label={
          format === "dbml"
            ? buildCopy.textEditorDbmlLabel
            : buildCopy.textEditorSqlLabel
        }
        className="min-h-0 flex-1 overflow-auto"
      />
      <div
        role="status"
        className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-panel px-3 py-2 text-xs leading-[18px]"
      >
        {status.kind === "applied" ? (
          <>
            <span className="size-2 flex-none rounded-full bg-success" />
            <span className="text-ink">{buildCopy.textApplied}</span>
            {format === "dbml" ? (
              <span className="text-muted">{buildCopy.textDbmlRebuildNote}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="size-2 flex-none rounded-full bg-danger" />
            <span className="text-ink">
              {buildCopy.textErrorLine(status.error.line, status.error.message)}
            </span>
            <span className="text-muted">{buildCopy.textErrorDiagramFollows}</span>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              className="ml-auto h-7 px-2.5 text-xs"
              onClick={() => handleGoToLine(status.error.line)}
            >
              {buildCopy.textGoToLine}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
