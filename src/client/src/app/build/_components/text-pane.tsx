import { useEffect, useEffectEvent, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
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

import { sameName } from "../_lib/build-engines";
import { tableKey } from "../_lib/build-model";
import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { dbmlLanguage } from "../_lib/dbml-language";
import {
  createTextSyncController,
  textApplyDelayMs,
  type TextStatus,
} from "../_lib/text-apply";
import type { TextWarning } from "../_lib/text-merge";

export interface TextPaneProps {
  model: BuildModel;
  format: "sql" | "dbml";
  onChange: (next: BuildModel, warnings: TextWarning[]) => void;
  onFocusTableInDiagram?: (tableKey: string) => void;
}

function unquoteIdent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/**
 * Dado o texto do editor SQL/DBML e a posição `pos` onde houve Ctrl+clique,
 * identifica se o cursor está sobre o nome de uma tabela do modelo e devolve a chave dela (`schema.tabela`).
 */
export function resolveTableAtPosition(
  docText: string,
  pos: number,
  model: BuildModel,
): string | null {
  if (model.tables.length === 0 || docText.length === 0) return null;
  const clampedPos = Math.max(0, Math.min(pos, docText.length));
  const lineStart = docText.lastIndexOf("\n", Math.max(0, clampedPos - 1)) + 1;
  const nextNewline = docText.indexOf("\n", clampedPos);
  const lineEnd = nextNewline === -1 ? docText.length : nextNewline;
  const lineText = docText.slice(lineStart, lineEnd);
  const col = clampedPos - lineStart;

  const pattern = /(?:"[^"]+"|[a-zA-Z0-9_$]+)(?:\.(?:"[^"]+"|[a-zA-Z0-9_$]+))*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (col < start || col > end) continue;

    const parts = (match[0].match(/"[^"]+"|[a-zA-Z0-9_$]+/g) ?? []).map(unquoteIdent);
    if (parts.length >= 2) {
      const [first, second] = parts;
      if (first && second) {
        const bySchemaAndTable = model.tables.find(
          (t) =>
            sameName(model.engine, { name: t.schema, exactName: false }, { name: first, exactName: false }) &&
            sameName(model.engine, { name: t.name, exactName: t.exactName }, { name: second, exactName: false }),
        );
        if (bySchemaAndTable) return tableKey(bySchemaAndTable);

        const byFirstAsTable = model.tables.find((t) =>
          sameName(model.engine, { name: t.name, exactName: t.exactName }, { name: first, exactName: false }),
        );
        if (byFirstAsTable) return tableKey(byFirstAsTable);

        const bySecondAsTable = model.tables.find((t) =>
          sameName(model.engine, { name: t.name, exactName: t.exactName }, { name: second, exactName: false }),
        );
        if (bySecondAsTable) return tableKey(bySecondAsTable);
      }
    } else if (parts.length === 1 && parts[0]) {
      const single = parts[0];
      const found = model.tables.find((t) =>
        sameName(model.engine, { name: t.name, exactName: t.exactName }, { name: single, exactName: false }),
      );
      if (found) return tableKey(found);
    }
  }
  return null;
}

function buildLanguageExtension(format: "sql" | "dbml", engine: BuildModel["engine"]) {
  return format === "dbml"
    ? dbmlLanguage
    : sql({
        dialect: engine === "postgresql" ? PostgreSQL : StandardSQL,
      });
}

function buildThemeExtension(
  font: ReturnType<typeof editorFont>,
  dark: boolean,
) {
  return EditorView.theme(
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
}

export function TextPane({ model, format, onChange, onFocusTableInDiagram }: TextPaneProps) {
  const { preferences } = usePreferences();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const syncControllerRef = useRef<ReturnType<typeof createTextSyncController> | null>(
    null,
  );
  if (syncControllerRef.current === null) {
    syncControllerRef.current = createTextSyncController(model, format);
  }
  const languageCompartmentRef = useRef(new Compartment());
  const themeCompartmentRef = useRef(new Compartment());

  const [status, setStatus] = useState<TextStatus>({
    kind: "applied",
    warnings: [],
  });

  const handleCtrlClickAtPos = useEffectEvent((docText: string, pos: number): boolean => {
    if (!onFocusTableInDiagram) return false;
    const foundKey = resolveTableAtPosition(docText, pos, model);
    if (!foundKey) return false;
    onFocusTableInDiagram(foundKey);
    return true;
  });

  const handleTextChanged = useEffectEvent((nextText: string) => {
    if (syncingRef.current) return;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const sync = syncControllerRef.current;
      if (!sync) return;
      const res = sync.applyEditorText(nextText);
      setStatus(res.status);
      if (res.model !== null && res.status.kind === "applied") {
        onChange(res.model, res.status.warnings);
      }
    }, textApplyDelayMs);
  });

  useEffect(() => {
    const host = hostRef.current;
    const sync = syncControllerRef.current;
    if (!host || !sync) return;

    const font = editorFont(preferences.editor);
    const dark = resolveScheme(preferences.theme, systemPrefersLight()) === "dark";

    const state = EditorState.create({
      doc: sync.initialDoc(),
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
        languageCompartmentRef.current.of(buildLanguageExtension(format, model.engine)),
        themeCompartmentRef.current.of(buildThemeExtension(font, dark)),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            if (handleCtrlClickAtPos(view.state.doc.toString(), pos)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o EditorView é criado apenas na montagem; mudanças de formato, modelo e preferências atualizam o estado via transações e Compartments
  }, []);

  useEffect(() => {
    const sync = syncControllerRef.current;
    const view = viewRef.current;
    if (!sync) return;
    const { shouldReplaceDoc, nextDoc } = sync.receiveProps(model, format);
    if (!shouldReplaceDoc) return;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus({ kind: "applied", warnings: [] });

    if (view && view.state.doc.toString() !== nextDoc) {
      syncingRef.current = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
        });
      } finally {
        syncingRef.current = false;
      }
    }
  }, [model, format]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const font = editorFont(preferences.editor);
    const dark = resolveScheme(preferences.theme, systemPrefersLight()) === "dark";
    view.dispatch({
      effects: [
        languageCompartmentRef.current.reconfigure(
          buildLanguageExtension(format, model.engine),
        ),
        themeCompartmentRef.current.reconfigure(buildThemeExtension(font, dark)),
      ],
    });
  }, [format, model.engine, preferences.editor, preferences.theme]);

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
            <span className="min-w-0 break-words [overflow-wrap:anywhere] text-ink">
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
