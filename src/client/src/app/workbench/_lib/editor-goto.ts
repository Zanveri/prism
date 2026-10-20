import { EditorView } from "@codemirror/view";

/**
 * Leva o cursor do editor de SQL à posição `offset` do texto e o foco a ele (RN-VAR-012 e 024: o clique num erro das variáveis, "Ir para a declaração"). O
 * editor é achado pela árvore da página, a partir da aba que o contém (`root`), e não por uma referência: quem pede é a área de resultado, que pode estar noutro
 * lugar (a aba do resultado, a janela do resultado). Devolve se achou o editor.
 */
export function goToOffset(root: ParentNode | null, offset: number): boolean {
  const dom = root?.querySelector<HTMLElement>(".cm-editor") ?? null;
  const view = dom === null ? null : EditorView.findFromDOM(dom);
  if (view === null) return false;

  const anchor = Math.max(0, Math.min(offset, view.state.doc.length));
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  view.focus();
  return true;
}
