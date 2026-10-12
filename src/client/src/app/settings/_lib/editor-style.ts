import type { EditorFont, Preferences } from "./preferences";

export type EditorPreferences = Pick<Preferences["editor"], "fontFamily" | "fontSize" | "tabSize">;

/**
 * A pilha de fontes do editor: a escolhida primeiro, e a do app (`--font-mono`, que começa pela IBM Plex Mono, a única que
 * vai dentro do Prism) atrás. Uma fonte que não está instalada neste computador cai na do app, e o editor continua legível.
 */
export function fontStack(family: EditorFont): string {
  return family === "IBM Plex Mono" ? "var(--font-mono)" : `"${family}", var(--font-mono)`;
}

/** A altura da linha acompanha o tamanho da fonte, na proporção do canvas: 22 px para 13 px. */
export function lineHeightFor(fontSize: number): number {
  return Math.round((fontSize * 22) / 13);
}

/** Como o editor desenha o texto, com o que o usuário escolheu. O padrão é o que o editor sempre teve. */
export function editorFont({ fontFamily, fontSize, tabSize }: EditorPreferences) {
  return { fontFamily: fontStack(fontFamily), fontSize: `${fontSize}px`, lineHeight: `${lineHeightFor(fontSize)}px`, tabSize };
}
