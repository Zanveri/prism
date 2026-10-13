import { fontStack } from "./fonts";
import type { Preferences } from "./preferences";

export type EditorPreferences = Pick<Preferences["editor"], "fontFamily" | "fontSize" | "tabSize">;

/** A altura da linha acompanha o tamanho da fonte, na proporção do canvas: 22 px para 13 px. */
export function lineHeightFor(fontSize: number): number {
  return Math.round((fontSize * 22) / 13);
}

/**
 * Como o editor desenha o texto, com o que o usuário escolheu. O padrão é o que o editor sempre teve. A pilha é a de `fonts.ts` (RN-CONFIG-008): a
 * escolhida primeiro e a do app (`--font-mono`, que começa pela IBM Plex Mono) atrás, e a fonte que não está instalada cai na do app.
 */
export function editorFont({ fontFamily, fontSize, tabSize }: EditorPreferences) {
  return { fontFamily: fontStack("editor", fontFamily), fontSize: `${fontSize}px`, lineHeight: `${lineHeightFor(fontSize)}px`, tabSize };
}
