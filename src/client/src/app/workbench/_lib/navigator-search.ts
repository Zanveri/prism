import type { QueryClient } from "@tanstack/react-query";

import { databaseOfKey, type FetchedPath } from "./database-sessions.service";
import { childrenKey, inDatabase, navKey, schemaGroupNodes, tableGroupNodes, type LevelState, type LoadedLevels, type NavNode, type NavPath, type ObjectsKind, type TableLevel } from "./navigator-model";

/** O trecho do rótulo que casou: posições `[início, fim)` no texto do rótulo, como `slice` as lê. */
export type MatchRange = readonly [start: number, end: number];

const nonAscii = /\P{ASCII}/u;
const combiningMarks = /\p{M}/gu;
const combiningMark = /\p{M}/u;

/** Sem caixa e sem acento: "Produção" e "producao" ficam iguais. O nome comum de banco (ASCII) só passa para minúsculas. */
export function fold(text: string): string {
  return nonAscii.test(text) ? text.normalize("NFD").replace(combiningMarks, "").toLowerCase() : text.toLowerCase();
}

/**
 * Onde `needle` (já passado por `fold`, não vazio) aparece no rótulo, em posições do próprio rótulo, ou `null`. O nome comum de banco
 * (ASCII) tem o mesmo tamanho dobrado ou não, e a conta é uma busca de texto. Com acento, cada ponto de código é dobrado e guarda
 * de onde veio: tirar o acento muda o tamanho do texto (o "ã" decomposto vira uma letra só), e o destaque tem de cair no rótulo
 * que a pessoa vê. O acento solto que acompanha uma letra entra no trecho dela.
 */
export function findMatch(label: string, needle: string): MatchRange | null {
  if (!nonAscii.test(label)) {
    const at = label.toLowerCase().indexOf(needle);
    return at < 0 ? null : [at, at + needle.length];
  }

  // O comum com acento (letra já composta, "ç" e "ã") dobra para o mesmo tamanho: as posições são as do rótulo, sem mapear ponto a ponto.
  // Sem acento solto no rótulo, o tamanho só mudaria por uma expansão (o hangul), e aí o mapa é preciso.
  const simple = fold(label);
  if (simple.length === label.length && !combiningMark.test(label)) {
    const at = simple.indexOf(needle);
    return at < 0 ? null : [at, at + needle.length];
  }

  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const point of label) {
    const part = fold(point);
    if (part === "" && ends.length > 0) ends[ends.length - 1] = index + point.length;
    for (let unit = 0; unit < part.length; unit++) {
      starts.push(index);
      ends.push(index + point.length);
    }
    folded += part;
    index += point.length;
  }

  const at = folded.indexOf(needle);
  return at < 0 ? null : [starts[at], ends[at + needle.length - 1]];
}

/**
 * A chave de uma consulta da árvore (`["tree", conexão, …]`, `treeKey`) de volta ao nó cujos filhos ela guarda: o inverso de `treeKey`,
 * que o teste confere. Mudou `treeKey`, mude aqui junto. Chave de outra coisa: `null`.
 */
export function levelPathOf(queryKey: readonly unknown[]): FetchedPath | null {
  const [root, connectionId] = queryKey;
  if (root !== "tree" || typeof connectionId !== "string") return null;
  if (queryKey[2] === "databases" && queryKey.length === 3) return { type: "connection", connectionId };

  // O que vem depois do banco: nada no banco da conexão, a marca `{ database }` em outro banco do servidor (RN-ARVORE-006).
  const database = databaseOfKey(queryKey);
  const [kind, schema, what, third, fourth] = queryKey.slice(database === undefined ? 2 : 3) as string[];
  const rest = queryKey.length - (database === undefined ? 2 : 3);
  const at = { connectionId, ...inDatabase(database) };
  if (kind === "schemas" && rest === 1) return { type: "database", ...at };
  if (kind === "schema" && what === "objects" && rest === 4) return { type: "objects", ...at, schema, objects: third as ObjectsKind };
  if (kind === "schema" && what === "table" && rest === 5) return { type: "tableLevel", ...at, schema, table: third, level: fourth as TableLevel };
  return null;
}

/** Uma consulta da árvore já respondida: a chave dela e os filhos que ela trouxe. */
export type CachedLevel = { key: readonly unknown[]; nodes: NavNode[] };

export type CachedTree = { cached: CachedLevel[] };

const snapshots = new WeakMap<QueryClient, { signature: string; value: CachedTree }>();

/**
 * O que o cache da árvore já guarda, para a busca: os níveis respondidos (`["tree", …]`), a começar pela lista dos bancos de cada conexão
 * (RN-ARVORE-006). Só lê; não busca nada. Devolve o MESMO objeto enquanto nenhuma dessas consultas ganhou, perdeu ou trocou de dado (a
 * assinatura é o hash e a contagem de atualizações de cada uma): é isso que deixa o `useMemo` do filtro valer, em vez de refazê-lo a cada render.
 */
export function cachedTree(queryClient: QueryClient): CachedTree {
  const queries = queryClient.getQueryCache();
  const levels = queries.findAll({ queryKey: ["tree"] }).filter((query) => query.state.data !== undefined);
  const signature = levels.map((query) => `${query.queryHash}#${query.state.dataUpdateCount}`).join("|");

  const previous = snapshots.get(queryClient);
  if (previous?.signature === signature) return previous.value;

  const value: CachedTree = { cached: levels.map((query) => ({ key: query.queryKey, nodes: query.state.data as NavNode[] })) };
  snapshots.set(queryClient, { signature, value });
  return value;
}

/**
 * Tudo o que a árvore já carregou, nível por nível, aberto ou não (a busca olha o que está em memória, não só o que está à vista).
 * Parte dos níveis que o navegador já tem (`base`: as pastas e os nós abertos, que valem mais) e acrescenta, sem ir à API, o que cada
 * consulta guardada trouxe (os bancos de cada conexão, os esquemas de cada banco…), com os grupos fixos (Tabelas, Visões, Colunas…)
 * que ligam um ao outro. Só cria o grupo fixo de quem tem algo carregado abaixo: nenhum nível é inventado.
 */
export function loadedLevels(base: LoadedLevels, cached: readonly CachedLevel[]): Map<string, LevelState> {
  const levels = new Map(base);
  const add = (path: NavPath, children: NavNode[]) => {
    const key = childrenKey({ key: navKey(path) });
    if (!levels.has(key)) levels.set(key, { status: "loaded", children });
  };


  for (const { key, nodes } of cached) {
    const path = levelPathOf(key);
    if (path === null) continue;

    add(path, nodes);
    if (path.type === "objects") add({ type: "schema", connectionId: path.connectionId, ...inDatabase(path.database), schema: path.schema }, schemaGroupNodes(path.connectionId, path.schema, path.database));
    if (path.type === "tableLevel") add({ type: "table", connectionId: path.connectionId, ...inDatabase(path.database), schema: path.schema, table: path.table }, tableGroupNodes(path.connectionId, path.schema, path.table, path.database));
  }

  return levels;
}

export type SearchView = {
  /** As linhas da árvore filtrada, em ordem, com o recuo certo. Só o que casou e o caminho até ele. */
  rows: NavNode[];
  /** As chaves das linhas com os filhos à mostra: a busca abre o caminho até o que casou, sem tocar nos nós abertos da árvore. */
  open: Set<string>;
  /** Onde o termo casou, por chave de linha, para o destaque. */
  matches: Map<string, MatchRange>;
  /** Quantos nós casaram. */
  count: number;
};

/**
 * A árvore filtrada por nome (RN-BUSCA-001), sobre o que já está carregado (`levels`; ver `loadedLevels`): não abre conexão, não busca
 * nível, não altera a árvore. Fica o que casa (sem diferenciar caixa nem acento) e os ancestrais dele, abertos; o grupo fixo
 * (Tabelas, Colunas…) não casa pelo próprio nome. Na tela da busca só tem chevron quem tem algo à vista embaixo (`hasChildren`), e um grupo diz
 * quantos aparecem do total ("3 de 120"). `collapsed` são os ancestrais que a pessoa recolheu na busca: ficam com chevron, para reabrir.
 *
 * Termo vazio não filtra: quem chama mostra a árvore normal e não chama isto.
 */
export function searchTree(roots: readonly NavNode[], levels: LoadedLevels, query: string, collapsed: ReadonlySet<string> = new Set()): SearchView {
  const needle = fold(query.trim());
  const rows: NavNode[] = [];
  const open = new Set<string>();
  const matches = new Map<string, MatchRange>();
  if (needle === "") return { rows, open, matches, count: 0 };

  /** Põe a linha do nó e as de baixo em `rows`; devolve se o nó ficou (casou, ou tem algo que casou embaixo). */
  function visit(node: NavNode, depth: number): boolean {
    const range = node.kind === "group" ? null : findMatch(node.label, needle);
    const start = rows.length;
    // Reserva o lugar da linha: os filhos entram logo depois, e a linha só se sabe se fica quando eles entraram.
    rows.push(node);

    const level = node.hasChildren ? levels.get(childrenKey(node)) : undefined;
    let kept = 0;
    if (level?.status === "loaded") for (const child of level.children) if (visit(child, depth + 1)) kept++;

    if (range === null && kept === 0) {
      rows.length = start;
      return false;
    }

    if (range !== null) matches.set(node.key, range);
    if (kept > 0 && !collapsed.has(node.key)) open.add(node.key);
    else rows.length = start + 1;

    const total = level?.status === "loaded" ? level.children.length : 0;
    rows[start] = { ...node, depth, hasChildren: kept > 0, ...(node.kind === "group" && total > 0 ? { detail: kept < total ? `${kept} de ${total}` : String(total) } : {}) };
    return true;
  }

  for (const root of roots) visit(root, root.depth);
  return { rows, open, matches, count: matches.size };
}
