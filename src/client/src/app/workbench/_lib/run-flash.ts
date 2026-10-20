import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

/**
 * RN-SQL-018: o destaque, por um instante, do trecho que o Ctrl+Enter sem seleção enviou, para a pessoa ver qual comando rodou (com a linha em
 * branco separando, nem sempre é o que ela imaginava). Só desenha: o texto, o cursor e a seleção ficam como estão. Some sozinho depois de
 * `runFlashMs`, e qualquer edição o tira antes, porque o trecho era o do texto enviado.
 */

/** Quanto o destaque fica na tela: o tempo da animação que o apaga. */
export const runFlashMs = 700;

const setRunFlash = StateEffect.define<{ from: number; to: number; serial: number } | null>();

/** Cada destaque é outro, mesmo no mesmo trecho: a marca muda, o CodeMirror a redesenha, e a animação recomeça (Ctrl+Enter duas vezes seguidas pisca duas vezes). */
let serial = 0;

/** O efeito que destaca o trecho de `from` a `to`. Trecho vazio não destaca nada (e apaga o destaque que estiver na tela). */
export const flashRun = (from: number, to: number) => setRunFlash.of(from < to ? { from, to, serial: ++serial } : null);

/** O efeito que apaga o destaque. */
export const clearRunFlash = setRunFlash.of(null);

const runFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(flash, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setRunFlash)) continue;
      const range = effect.value;
      const to = range === null ? 0 : Math.min(range.to, transaction.state.doc.length);
      return range === null || range.from >= to ? Decoration.none : Decoration.set(Decoration.mark({ class: "cm-run-flash", attributes: { "data-run": String(range.serial) } }).range(range.from, to));
    }
    return transaction.docChanged ? Decoration.none : flash;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** O trecho destacado agora, com o número do destaque (outro a cada `flashRun`), ou `null`. */
export function flashedRange(state: EditorState): { from: number; to: number; serial: number } | null {
  const cursor = state.field(runFlashField, false)?.iter();
  if (!cursor?.value) return null;
  return { from: cursor.from, to: cursor.to, serial: Number((cursor.value.spec as { attributes: Record<string, string> }).attributes["data-run"]) };
}

/** O relógio que apaga o destaque: um destaque novo recomeça a conta, e o editor desmontado leva o relógio junto. */
const runFlashTimer = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    update(update) {
      const flashed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setRunFlash) && effect.value !== null));
      if (!flashed) return;

      stop();
      timer = setTimeout(() => {
        timer = null;
        view.dispatch({ effects: clearRunFlash });
      }, runFlashMs);
    },
    destroy: stop,
  };
});

/**
 * A cor é ficha do tema: o acento, translúcido, que aparece sobre a linha do cursor e o fundo de qualquer um dos seis temas, e se apaga. Com o
 * "reduzir movimento" do sistema não há animação: o destaque aparece parado e some de uma vez.
 */
const flashColor = "color-mix(in srgb, var(--color-accent) 28%, transparent)";

const runFlashTheme = EditorView.baseTheme({
  ".cm-run-flash": { animation: `prism-run-flash ${runFlashMs}ms ease-out both` },
  "@keyframes prism-run-flash": { "0%, 35%": { backgroundColor: flashColor }, "100%": { backgroundColor: "transparent" } },
  "@media (prefers-reduced-motion: reduce)": { ".cm-run-flash": { animation: "none", backgroundColor: flashColor } },
});

/** O destaque do trecho enviado: o estado, o relógio que o apaga e a cor. Quem executa manda `flashRun(de, até)`. */
export const runFlash: Extension = [runFlashField, runFlashTimer, runFlashTheme];
