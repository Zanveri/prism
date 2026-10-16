import { fold } from "@/app/workbench/_lib/navigator-search";

import { byName } from "./connection-tree";

/**
 * A árvore de marcar dos diálogos de exportar e de importar conexões (RN-TRANSF-002 e 011): pastas e conexões, com uma caixa em cada linha. Pura e
 * testada; os diálogos só desenham e guardam as marcas.
 *
 * **O que se marca são as folhas**: as conexões e as pastas vazias (sem subpastas e sem conexões), que têm a caixa delas próprias. A caixa de uma pasta com
 * algo dentro mostra o estado do que está dentro dela, a qualquer profundidade, e o clique nela marca ou desmarca esse conteúdo. Toda pasta com algo dentro
 * está no caminho de alguma folha, então marcar tudo o que está dentro de uma pasta leva todas as pastas dela ao arquivo. A pasta de uma folha marcada vai
 * como caminho, marcada ou não (RN-TRANSF-006): desmarcá-la não a tira, e a caixa dela fica mista.
 *
 * As chaves são únicas no conjunto das pastas e das conexões: os IDs do cofre na exportação, as chaves do arquivo na importação.
 */

/** Um item da árvore, como os diálogos o entregam: `selectable` falso é o que não pode ser marcado (o item que não pode ser importado, RN-TRANSF-014). */
export type CheckItem = { key: string; kind: "folder" | "connection"; parentKey: string | null; name: string; selectable: boolean };

/** Uma linha da árvore, na ordem dela. `depth` 0 é a raiz; `end` é o índice logo depois da última linha de dentro dela (as de dentro vêm em seguida). */
export type CheckNode = CheckItem & { depth: number; index: number; end: number; leaf: boolean };

export type CheckTree = {
  /** Na ordem da árvore: dentro de cada pasta, as subpastas primeiro e depois as conexões, cada grupo pelo nome, como no navegador. */
  nodes: readonly CheckNode[];
  byKey: ReadonlyMap<string, CheckNode>;
};

/** O estado da caixa: marcada (tudo), desmarcada (nada) ou mista (parte). */
export type CheckState = "checked" | "unchecked" | "mixed";

/**
 * Monta a árvore. O item cujo pai não está na lista vai para a raiz (o que ficou sem lugar não some); as pastas em ciclo, que não chegam à raiz, não aparecem,
 * como no `buildConnectionTree` do navegador. Um item dentro de uma pasta que não pode ser marcada também não pode: a pasta que não pode ser importada leva
 * junto o que está dentro dela (RN-TRANSF-014).
 */
export function checkTree(items: readonly CheckItem[]): CheckTree {
  const folderKeys = new Set(items.filter((item) => item.kind === "folder").map((item) => item.key));
  const childrenOf = new Map<string | null, CheckItem[]>();
  for (const item of items) {
    const parent = item.parentKey !== null && folderKeys.has(item.parentKey) && item.parentKey !== item.key ? item.parentKey : null;
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [item]);
    else siblings.push(item);
  }

  const nodes: CheckNode[] = [];
  const visited = new Set<string>();

  function walk(parent: string | null, depth: number, parentSelectable: boolean) {
    const children = (childrenOf.get(parent) ?? []).sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === "folder" ? -1 : 1));
    for (const child of children) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);

      const node: CheckNode = { ...child, selectable: parentSelectable && child.selectable, depth, index: nodes.length, end: nodes.length + 1, leaf: true };
      nodes.push(node);
      if (child.kind === "folder") {
        walk(child.key, depth + 1, node.selectable);
        node.end = nodes.length;
        node.leaf = node.end === node.index + 1;
      }
    }
  }

  walk(null, 0, true);
  return { nodes, byKey: new Map(nodes.map((node) => [node.key, node])) };
}

/** As linhas de dentro de uma pasta (sem ela), a qualquer profundidade. */
function inside(tree: CheckTree, node: CheckNode): readonly CheckNode[] {
  return tree.nodes.slice(node.index + 1, node.end);
}

/** As folhas que contam numa pasta: as de dentro dela que podem ser marcadas; numa folha, ela mesma. */
export function leavesOf(tree: CheckTree, key: string): CheckNode[] {
  const node = tree.byKey.get(key);
  if (node === undefined) return [];
  if (node.leaf) return node.selectable ? [node] : [];
  return inside(tree, node).filter((child) => child.leaf && child.selectable);
}

/** As marcas que ainda valem: as das folhas que existem e podem ser marcadas (o item que outra janela excluiu sai com a marca, RN-TRANSF-002). */
export function validMarks(tree: CheckTree, marked: ReadonlySet<string>): Set<string> {
  return new Set([...marked].filter((key) => {
    const node = tree.byKey.get(key);
    return node !== undefined && node.leaf && node.selectable;
  }));
}

/**
 * O estado da caixa de cada linha, de uma vez (a árvore pode ter 4.000 linhas): a folha está marcada ou não; a pasta com algo dentro, pelo que está dentro
 * dela, a qualquer profundidade, à vista ou não. A pasta sem nada que possa ser marcado fica desmarcada.
 */
export function checkStates(tree: CheckTree, marked: ReadonlySet<string>): Map<string, CheckState> {
  const totals = new Map<string, { all: number; marked: number }>();
  const states = new Map<string, CheckState>();

  // De baixo para cima: cada linha soma o que tem no pai dela, e a pasta já tem a soma de dentro quando chega a vez dela.
  for (let index = tree.nodes.length - 1; index >= 0; index--) {
    const node = tree.nodes[index];
    let total = totals.get(node.key) ?? { all: 0, marked: 0 };
    if (node.leaf) total = node.selectable ? { all: 1, marked: marked.has(node.key) ? 1 : 0 } : { all: 0, marked: 0 };

    states.set(node.key, total.all === 0 || total.marked === 0 ? "unchecked" : total.marked === total.all ? "checked" : "mixed");
    if (node.parentKey !== null && tree.byKey.has(node.parentKey)) {
      const parent = totals.get(node.parentKey) ?? { all: 0, marked: 0 };
      totals.set(node.parentKey, { all: parent.all + total.all, marked: parent.marked + total.marked });
    }
  }
  return states;
}

/**
 * O clique na caixa de uma linha. Na folha, marca ou desmarca ela. Na pasta, marca tudo o que está dentro, ou desmarca tudo quando tudo já estava marcado.
 * Com a busca (`visible`), age só no que ela mostra: marca o que está à vista, ou desmarca o que está à vista quando tudo o que está à vista já estava
 * marcado (RN-TRANSF-002).
 */
export function toggle(tree: CheckTree, key: string, marked: ReadonlySet<string>, visible: ReadonlySet<string> | null = null): Set<string> {
  const targets = leavesOf(tree, key).filter((leaf) => visible === null || visible.has(leaf.key));
  const next = new Set(marked);
  if (targets.length === 0) return next;

  const unmark = targets.every((leaf) => marked.has(leaf.key));
  for (const leaf of targets) {
    if (unmark) next.delete(leaf.key);
    else next.add(leaf.key);
  }
  return next;
}

/** "Marcar todas": todas as folhas que podem ser marcadas, ou só as que a busca mostra. */
export function markAll(tree: CheckTree, marked: ReadonlySet<string>, visible: ReadonlySet<string> | null = null): Set<string> {
  const next = new Set(marked);
  for (const node of tree.nodes) if (node.leaf && node.selectable && (visible === null || visible.has(node.key))) next.add(node.key);
  return next;
}

/** "Desmarcar todas": todas, ou só as que a busca mostra (as escondidas continuam como estavam). */
export function unmarkAll(tree: CheckTree, marked: ReadonlySet<string>, visible: ReadonlySet<string> | null = null): Set<string> {
  if (visible === null) return new Set();
  return new Set([...marked].filter((key) => !visible.has(key)));
}

/**
 * O que a busca mostra (RN-TRANSF-002, pelas regras da RN-BUSCA-001: pelo nome, sem diferenciar maiúsculas nem acentos): a conexão que casa, com as pastas do
 * caminho; a pasta que casa, com as do caminho e tudo o que está dentro dela. `null` sem busca (tudo à vista).
 */
export function searchVisible(tree: CheckTree, query: string): Set<string> | null {
  const needle = needleOf(query);
  if (needle === "") return null;

  const visible = new Set<string>();
  const withPath = (node: CheckNode) => {
    for (let current: CheckNode | undefined = node; current !== undefined && !visible.has(current.key); current = current.parentKey === null ? undefined : tree.byKey.get(current.parentKey)) visible.add(current.key);
  };

  for (const node of tree.nodes) {
    if (!fold(node.name).includes(needle)) continue;
    withPath(node);
    for (const child of inside(tree, node)) visible.add(child.key);
  }
  return visible;
}

/** O texto da busca como ela compara: sem os espaços das pontas, sem maiúsculas e sem acentos. Vazio é sem busca. */
function needleOf(query: string): string {
  return fold(query.trim());
}

/**
 * As pastas fechadas, guardadas como no navegador (RN-BUSCA-001: o que casa aparece com os ancestrais abertos, e limpar a busca devolve a árvore como
 * estava). `tree` são as que a pessoa fechou sem busca; `search`, as que ela fechou na busca de agora (`needle`). Com a busca, as de `tree` não contam: a
 * pasta fechada antes de buscar abre para mostrar o que casou dentro dela. Outro texto de busca começa com tudo aberto.
 */
export type Collapsed = { tree: ReadonlySet<string>; search: { needle: string; keys: ReadonlySet<string> } };

const noKeys: ReadonlySet<string> = new Set();

/** Tudo aberto: como os dois diálogos começam (RN-TRANSF-002 e 011), e como a prévia de outro arquivo começa. */
export const noneCollapsed: Collapsed = { tree: noKeys, search: { needle: "", keys: noKeys } };

/** As pastas fechadas que valem com esta busca: sem busca, as da árvore; com ela, só as que a pessoa fechou nela. */
export function collapsedFor(collapsed: Collapsed, query: string): ReadonlySet<string> {
  const needle = needleOf(query);
  if (needle === "") return collapsed.tree;
  return collapsed.search.needle === needle ? collapsed.search.keys : noKeys;
}

/** A seta de abrir e fechar de uma pasta, com ou sem a busca: muda só o conjunto que vale agora. */
export function toggleCollapsed(collapsed: Collapsed, query: string, key: string): Collapsed {
  const current = collapsedFor(collapsed, query);
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);

  const needle = needleOf(query);
  return needle === "" ? { ...collapsed, tree: next } : { ...collapsed, search: { needle, keys: next } };
}

/**
 * As linhas desenhadas: as que a busca mostra, menos as de dentro de uma pasta fechada. Com a busca, `collapsed` são as que a pessoa fechou nela
 * (`collapsedFor`), para o que casou aparecer com os ancestrais abertos.
 */
export function shownNodes(tree: CheckTree, visible: ReadonlySet<string> | null, collapsed: ReadonlySet<string>): CheckNode[] {
  const shown: CheckNode[] = [];
  for (let index = 0; index < tree.nodes.length; ) {
    const node = tree.nodes[index];
    if (visible !== null && !visible.has(node.key)) {
      index++;
      continue;
    }
    shown.push(node);
    index = collapsed.has(node.key) ? node.end : index + 1;
  }
  return shown;
}

/** O caminho de pastas acima de um item ("Estoque / Production PRD"), ou `null` na raiz: o que distingue as linhas de mesmo nome para o leitor de tela. */
export function pathOf(tree: CheckTree, key: string): string | null {
  const names: string[] = [];
  // Pelo nível, e não só pelo `parentKey`: o item cujo pai não está na lista (ou é ele mesmo) foi para a raiz, com o nível 0.
  for (let node = tree.byKey.get(key); node !== undefined && node.depth > 0 && node.parentKey !== null; ) {
    const parent = tree.byKey.get(node.parentKey);
    if (parent === undefined) break;
    names.unshift(parent.name);
    node = parent;
  }
  return names.length === 0 ? null : names.join(" / ");
}

/**
 * As pastas que vão no arquivo (RN-TRANSF-006 e 011): a pasta vazia marcada e as do caminho de cada folha marcada até a raiz, cada uma uma vez só, na ordem
 * da árvore.
 */
export function foldersInFile(tree: CheckTree, marked: ReadonlySet<string>): CheckNode[] {
  const keys = new Set<string>();
  for (const key of marked) {
    const leaf = tree.byKey.get(key);
    if (leaf === undefined || !leaf.leaf || !leaf.selectable) continue;
    for (let current: CheckNode | undefined = leaf.kind === "folder" ? leaf : leaf.parentKey === null ? undefined : tree.byKey.get(leaf.parentKey); current !== undefined && !keys.has(current.key); current = current.parentKey === null ? undefined : tree.byKey.get(current.parentKey)) {
      keys.add(current.key);
    }
  }
  return tree.nodes.filter((node) => keys.has(node.key));
}

/** As folhas marcadas, na ordem da árvore: o que a tela manda (as conexões, e as pastas vazias). */
export function markedLeaves(tree: CheckTree, marked: ReadonlySet<string>): CheckNode[] {
  return tree.nodes.filter((node) => node.leaf && node.selectable && marked.has(node.key));
}
