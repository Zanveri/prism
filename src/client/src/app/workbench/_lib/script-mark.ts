import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * RN-SQL-019: a marca do comando do script em execução, no editor. Fica enquanto ele roda (o destaque do Ctrl+Enter, `run-flash.ts`, pisca e some; esta
 * fica até o comando seguinte começar) e acompanha a edição do texto, que só a desloca. Só desenha: o texto, o cursor e a seleção ficam como estão.
 */

const setScriptMark = StateEffect.define<{ from: number; to: number } | null>();

const scriptMarkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(mark, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setScriptMark)) continue;
      const range = effect.value;
      return range === null || range.from >= range.to ? Decoration.none : Decoration.set(Decoration.mark({ class: "cm-script-running" }).range(range.from, range.to));
    }
    return transaction.docChanged ? mark.map(transaction.changes) : mark;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** O trecho marcado agora, ou `null`. */
export function scriptMarkedRange(state: EditorState): { from: number; to: number } | null {
  const cursor = state.field(scriptMarkField, false)?.iter();
  return cursor?.value ? { from: cursor.from, to: cursor.to } : null;
}

/**
 * O efeito que marca o comando em execução (`running`: o texto e onde ele estava quando o script começou), e o traz à vista quando ele está fora dela; ou que
 * tira a marca, sem comando em execução. Se o texto naquele lugar já não é o do comando (a pessoa editou o texto depois de o script começar), não marca nada:
 * o lugar já não é o mesmo.
 */
export function scriptMarkEffects(state: EditorState, running: { offset: number; sql: string } | null): StateEffect<unknown>[] {
  if (running === null) return scriptMarkedRange(state) === null ? [] : [setScriptMark.of(null)];

  const from = running.offset;
  const to = from + running.sql.length;
  if (to > state.doc.length || state.sliceDoc(from, to) !== running.sql) return scriptMarkedRange(state) === null ? [] : [setScriptMark.of(null)];
  return [setScriptMark.of({ from, to }), EditorView.scrollIntoView(from, { y: "nearest" })];
}

/** A cor é ficha do tema, como a do destaque do Ctrl+Enter: o acento, translúcido, sobre o fundo de qualquer um dos seis temas. Parada: não anima. */
const scriptMarkTheme = EditorView.baseTheme({
  ".cm-script-running": { backgroundColor: "color-mix(in srgb, var(--color-accent) 20%, transparent)" },
});

/** A marca do comando do script em execução: o estado e a cor. Quem executa manda `scriptMarkEffects`. */
export const scriptMark: Extension = [scriptMarkField, scriptMarkTheme];
