import { Prec, StateEffect, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

import type { Engine } from "@/components/ui";

import { sqlTokens, type SqlToken } from "./sql-statements";
import type { TableLink } from "./table-links";

/** O que a extensão pergunta a quem a monta, na hora em que precisa: o link sob o caractere (com os pedaços do texto, que ela guarda) e o que fazer no clique. */
export type TableLinkOptions = {
  /** O banco da aba agora (muda quando a aba sem conexão recebe uma). */
  engine: () => Engine | undefined;
  find: (sql: string, offset: number, tokens: readonly SqlToken[]) => TableLink | null;
  open: (link: TableLink) => void;
  /** No macOS o modificador é o ⌘; nos outros, o Ctrl. */
  mac: boolean;
};

const setLink = StateEffect.define<{ from: number; to: number } | null>();

const linkMark = Decoration.mark({ class: "cm-table-link" });

/** O destaque do link (um só por vez): some com qualquer edição, porque as posições eram as do texto de antes. */
const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) if (effect.is(setLink)) return effect.value === null ? Decoration.none : Decoration.set(linkMark.range(effect.value.from, effect.value.to));
    return transaction.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * RN-LINK-001 no editor: com o Ctrl (⌘ no macOS) apertado, o nome de uma tabela ou visão sob o ponteiro fica azul e sublinhado, com o cursor de mão, e o
 * Ctrl+clique abre a aba dela nos Registros. Soltar o Ctrl, tirar o ponteiro do nome ou sair do editor desfaz o destaque. O modificador é lido das teclas da
 * JANELA (o editor pode não ter o foco) e de cada movimento do ponteiro; os pedaços do texto são lidos uma vez por versão do texto, e não a cada movimento.
 *
 * O Ctrl+clique de um link não chega ao CodeMirror (que acrescentaria um cursor): a extensão tem precedência e consome o `mousedown`. Fora de um link, o
 * clique segue como sempre.
 */
export function tableLinks(options: TableLinkOptions): Extension {
  // O texto e os pedaços dele, uma vez por versão do texto (e por banco): um movimento do ponteiro não copia nem relê um script de 1 MB.
  let cached: { doc: Text; engine: Engine | undefined; sql: string; tokens: SqlToken[] } | null = null;
  const readOf = (state: EditorState) => {
    const engine = options.engine();
    if (cached === null || cached.doc !== state.doc || cached.engine !== engine) {
      const sql = state.doc.toString();
      cached = { doc: state.doc, engine, sql, tokens: sqlTokens(sql, engine) };
    }
    return cached;
  };

  /** O caractere sob o ponteiro: `posAtCoords` dá a fronteira mais próxima, e o caractere é o da esquerda quando o ponteiro está antes dela. */
  const linkAt = (view: EditorView, x: number, y: number): TableLink | null => {
    const position = view.posAtCoords({ x, y });
    if (position === null) return null;
    const box = view.coordsAtPos(position);
    const offset = box !== null && x < box.left ? position - 1 : position;
    if (offset < 0 || offset >= view.state.doc.length) return null;
    const { sql, tokens } = readOf(view.state);
    return options.find(sql, offset, tokens);
  };

  const modifierOf = (event: { ctrlKey: boolean; metaKey: boolean }) => (options.mac ? event.metaKey : event.ctrlKey);

  const plugin = ViewPlugin.define((view) => {
    let pointer: { x: number; y: number } | null = null;
    let held = false;
    let shown: { from: number; to: number } | null = null;

    const show = (range: { from: number; to: number } | null) => {
      if (shown?.from === range?.from && shown?.to === range?.to) return;
      shown = range;
      view.dispatch({ effects: setLink.of(range) });
    };
    const refresh = () => {
      if (!held || pointer === null) return show(null);
      const link = linkAt(view, pointer.x, pointer.y);
      show(link === null ? null : { from: link.from, to: link.to });
    };

    const onKey = (event: KeyboardEvent) => {
      const next = modifierOf(event);
      if (next === held) return;
      held = next;
      refresh();
    };
    const onBlur = () => {
      held = false;
      show(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);

    return {
      update(update) {
        // Uma edição já tirou o destaque (as posições mudaram); o que mostrar de novo, o próximo movimento diz.
        if (update.docChanged) shown = null;
      },
      destroy() {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKey, true);
        window.removeEventListener("blur", onBlur);
      },
      onPointer(event: MouseEvent | null) {
        pointer = event === null ? null : { x: event.clientX, y: event.clientY };
        if (event !== null) held = modifierOf(event);
        refresh();
      },
    };
  });

  const handlers = EditorView.domEventHandlers({
    mousemove(event, view) {
      view.plugin(plugin)?.onPointer(event);
    },
    mouseleave(_event, view) {
      view.plugin(plugin)?.onPointer(null);
    },
    mousedown(event, view) {
      if (event.button !== 0 || !modifierOf(event)) return false;
      const link = linkAt(view, event.clientX, event.clientY);
      if (link === null) return false;
      event.preventDefault();
      view.plugin(plugin)?.onPointer(null);
      options.open(link);
      return true;
    },
  });

  return [linkField, plugin, Prec.highest(handlers)];
}
