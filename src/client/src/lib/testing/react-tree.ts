import { isValidElement, type ReactElement, type ReactNode } from "react";

export type Found = ReactElement<Record<string, unknown>>;

/**
 * Todos os elementos de uma árvore de React, descendo por `children` e pelas propriedades que levam nós (`footer`,
 * `description`). Serve a testar o que um componente **sem estado** monta (os botões e o que cada um faz ao ser
 * clicado) sem DOM: o vitest deste projeto não tem jsdom. Só para testes.
 */
export function elementsOf(node: ReactNode): Found[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode), ...elementsOf(node.props.footer as ReactNode), ...elementsOf(node.props.description as ReactNode)];
}

/** O elemento cujo único filho é este texto e que tem `onClick`: o botão com este rótulo. */
export function buttonLabeled(tree: ReactNode, label: string): Found | undefined {
  return elementsOf(tree).find((element) => element.props.children === label && typeof element.props.onClick === "function");
}

/** Clica no botão com este rótulo (chama o `onClick` dele); falha se não existe. */
export function clickLabeled(tree: ReactNode, label: string): void {
  const button = buttonLabeled(tree, label);
  if (button === undefined) throw new Error(`Não há botão "${label}" na árvore.`);
  (button.props.onClick as () => void)();
}
