import { byName, type TreeNode } from "@/app/connections/_lib/connection-tree";

import type { Column, DatabaseObject, DatabaseSchema, ForeignKey, ServerDatabase, TableIndex } from "./database-sessions.schema";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.navigator;

/**
 * Uma linha da árvore (RN-ARVORE-001). `loading` e `error` são as linhas que o modelo cria no
 * lugar dos filhos de um nó aberto que ainda não carregou ou que falhou (RN-ARVORE-005).
 */
export type NavKind = "folder" | "connection" | "database" | "schema" | "group" | "table" | "view" | "routine" | "sequence" | "column" | "index" | "foreignKey" | "error" | "loading";

export type NavNode = {
  key: string;
  kind: NavKind;
  label: string;
  depth: number;
  hasChildren: boolean;
  /** O que acompanha o nome, em texto apagado: o tipo da coluna, as colunas do índice, a contagem do grupo. */
  detail?: string;
  /** Uma marca curta ao lado do detalhe: `PK` na coluna, `único` no índice. */
  badge?: string;
  /** Só na linha de erro: a chave do nó que falhou, para "Tentar de novo". */
  retryKey?: string;
  /** Só na linha de erro: o código que a API deu à falha. É por ele que a linha oferece mais que "Tentar de novo" ("Instalar driver"). */
  errorCode?: string;
  /** Só na linha de erro do driver que falta: o `driverID` do 422, para o "Instalar driver" apontar a linha dele. */
  errorDriverID?: string;
};

export type ObjectsKind = "tables" | "views" | "routines" | "sequences";
export type TableLevel = "columns" | "indexes" | "foreignKeys";

/**
 * O banco de uma linha (RN-ARVORE-006): a conexão e, quando é outro banco do mesmo servidor, o nome dele. Sem `database`, é o banco
 * da conexão, que usa a sessão dela; com ele, a sessão daquele banco.
 */
export type DatabaseRef = { connectionId: string; database?: string };

/**
 * Onde um nó que abre está na árvore. A chave do nó é este caminho em JSON: nome de esquema ou de
 * tabela pode ter barra, aspas e espaço, e qualquer separador faria dois caminhos colidirem. A
 * chave basta para saber o que buscar quando o nó abre, sem procurar o nó. O que está abaixo de
 * outro banco do servidor leva o nome dele (`database`); o banco da conexão não leva nada, e as
 * chaves dele são as de antes da lista dos bancos.
 */
export type NavPath =
  | { type: "folder"; id: string }
  | { type: "connection"; connectionId: string }
  | { type: "database"; connectionId: string; database?: string }
  | { type: "schema"; connectionId: string; database?: string; schema: string }
  | { type: "objects"; connectionId: string; database?: string; schema: string; objects: ObjectsKind }
  | { type: "table"; connectionId: string; database?: string; schema: string; table: string }
  | { type: "tableLevel"; connectionId: string; database?: string; schema: string; table: string; level: TableLevel };

export type TableLevelPath = Extract<NavPath, { type: "tableLevel" }>;
export type ObjectsPath = Extract<NavPath, { type: "objects" }>;

/** Os campos de um caminho, na ordem da chave: a mesma chave qualquer que seja a ordem em que o caminho foi escrito, e sem o banco que não há. */
const pathFields = ["type", "id", "connectionId", "database", "schema", "objects", "table", "level"];

export const navKey = (path: NavPath): string => JSON.stringify(path, pathFields);

/** O nome do outro banco, só quando há: no banco da conexão o caminho fica sem o campo. */
export const inDatabase = (database: string | undefined): { database?: string } => (database === undefined ? {} : { database });

/** Só para chave de nó que abre (`hasChildren`): as das linhas de folha e de aviso não são caminhos. */
export const parseNavKey = (key: string): NavPath => JSON.parse(key) as NavPath;

/** A chave sob a qual os filhos de um nó ficam guardados em `LoadedLevels`; separada da do nó para uma não passar pela outra. */
export const childrenKey = (node: { key: string }): string => `children:${node.key}`;

/**
 * Os filhos de um nó aberto, ou a falha de buscá-los. Sem entrada, ainda não chegaram. `total` é só do nível que a busca monta do índice de nomes (RN-BUSCA-002): os
 * `children` são os que casaram, e `total` é quantos o índice tem ali, para o grupo dizer "3 de 120". Sem ele, o total é o número de filhos.
 */
export type LevelState = { status: "loaded"; children: NavNode[]; total?: number } | { status: "error"; message: string; code?: string; driverID?: string };

export type LoadedLevels = ReadonlyMap<string, LevelState>;

/**
 * As linhas que a lista desenha, em ordem: cada nó aberto é seguido pelos filhos, com um nível a
 * mais de recuo (`depth` do filho é sempre o do pai mais um, qualquer que seja o que ele trouxe).
 * Aberto e ainda sem entrada em `loaded`: uma linha "Carregando…". Um grupo carregado diz quantos
 * filhos tem. A lista é plana para a virtualização desenhar só o que se vê.
 */
export function flattenVisible(roots: NavNode[], expanded: ReadonlySet<string>, loaded: LoadedLevels): NavNode[] {
  const rows: NavNode[] = [];

  function walk(nodes: NavNode[], depth: number | null) {
    for (const node of nodes) {
      const open = node.hasChildren && expanded.has(node.key);
      const level = open ? loaded.get(childrenKey(node)) : undefined;
      const placed = depth === null || node.depth === depth ? node : { ...node, depth };
      const row = node.kind === "group" && level?.status === "loaded" ? { ...placed, detail: String(level.children.length) } : placed;
      rows.push(row);

      if (!open) continue;
      if (level === undefined) rows.push({ key: `${node.key}#loading`, kind: "loading", label: copy.loading, depth: row.depth + 1, hasChildren: false });
      else if (level.status === "error") rows.push({ key: `${node.key}#error`, kind: "error", label: level.message, depth: row.depth + 1, hasChildren: false, retryKey: node.key, errorCode: level.code, errorDriverID: level.driverID });
      else walk(level.children, row.depth + 1);
    }
  }

  walk(roots, null);
  return rows;
}

/** A conexão, o banco (quando é outro do servidor), o esquema e o nome da tabela ou da visão de uma linha. */
export type TableRef = DatabaseRef & { schema: string; name: string };

/**
 * Onde está a tabela ou a visão de uma linha (RN-TABELA-001), ou `null` se a linha é de outra coisa. A tabela traz tudo na
 * própria chave. A visão é folha, e a chave de folha é o caminho do pai mais a posição (`leafKey`): o esquema sai do pai
 * (o que vem antes do último `#`, que o nome do esquema pode ter, mas o sufixo `#view:N` não) e o nome, do rótulo.
 */
export function tableTargetOf(node: NavNode): TableRef | null {
  if (node.kind === "table") {
    const path = parseNavKey(node.key);
    return path.type === "table" ? { connectionId: path.connectionId, ...inDatabase(path.database), schema: path.schema, name: path.table } : null;
  }

  if (node.kind === "view") {
    const parent = parseNavKey(node.key.slice(0, node.key.lastIndexOf("#")));
    return parent.type === "objects" ? { connectionId: parent.connectionId, ...inDatabase(parent.database), schema: parent.schema, name: node.label } : null;
  }

  return null;
}

/**
 * A conexão a que a linha pertence, para as ações do menu (nova consulta, atualizar, abrir a tabela…). A pasta não é de conexão
 * nenhuma, e as folhas que só copiam o nome (rotina, coluna, índice, chave) não precisam dela: a chave delas nem é um caminho.
 */
/** A conexão, o banco (quando é outro do servidor) e o esquema de uma linha de esquema (RN-ESQUEMA-001). */
export type SchemaRef = DatabaseRef & { schema: string };

export function schemaTargetOf(node: NavNode): SchemaRef | null {
  if (node.kind !== "schema" || !node.key.startsWith("{")) return null;
  const path = parseNavKey(node.key);
  return path.type === "schema" ? { connectionId: path.connectionId, ...inDatabase(path.database), schema: path.schema } : null;
}

/** A conexão, o banco (quando é outro do servidor) e o nome do banco de uma linha de banco (RN-BANCO-001). */
export type DatabaseNodeRef = DatabaseRef & { name: string };

export function databaseTargetOf(node: NavNode): DatabaseNodeRef | null {
  if (node.kind !== "database" || !node.key.startsWith("{")) return null;
  const path = parseNavKey(node.key);
  return path.type === "database" ? { connectionId: path.connectionId, ...inDatabase(path.database), name: node.label } : null;
}

export function ownerConnectionId(node: NavNode): string | null {
  switch (node.kind) {
    case "connection":
    case "database":
    case "schema":
    case "group":
    case "table": {
      const path = parseNavKey(node.key);
      return path.type === "folder" ? null : path.connectionId;
    }
    case "view":
      return tableTargetOf(node)?.connectionId ?? null;
    default:
      return null;
  }
}

/**
 * O banco a que a linha pertence (RN-ARVORE-006): a nova consulta, a aba da tabela e o "Gerar SELECT" abertos a partir dela usam a
 * sessão dele. A conexão é o banco dela. Como em `ownerConnectionId`, a pasta e as folhas que só copiam o nome não são de banco nenhum.
 */
export function databaseRefOf(node: NavNode): DatabaseRef | null {
  switch (node.kind) {
    case "connection":
    case "database":
    case "schema":
    case "group":
    case "table": {
      const path = parseNavKey(node.key);
      if (path.type === "folder") return null;
      return { connectionId: path.connectionId, ...inDatabase(path.type === "connection" ? undefined : path.database) };
    }
    case "view": {
      const target = tableTargetOf(node);
      return target === null ? null : { connectionId: target.connectionId, ...inDatabase(target.database) };
    }
    default:
      return null;
  }
}

/**
 * O que um clique na linha faz: alternar o nó (abrir ou fechar) ou nada além de selecionar.
 * - O segundo clique de um duplo clique não alterna de novo (`detail` > 1): o nó abriria e fecharia. O chevron é a exceção, para
 *   quem abre e fecha depressa.
 * - Na tabela o clique no nome só seleciona: o duplo clique abre a aba dela (RN-TABELA-001), e abrir a árvore fica para o
 *   chevron e as setas. Senão cada tabela aberta deixaria três linhas a mais na lista.
 * - Sem contagem de cliques (`detail` 0) o clique veio do teclado (Espaço): alterna, como as setas.
 */
export function clickEffect(node: NavNode, click: { detail: number; onChevron: boolean }): "toggle" | "none" {
  if (!node.hasChildren) return "none";
  if (click.onChevron || click.detail === 0) return "toggle";
  if (click.detail > 1 || tableTargetOf(node) !== null) return "none";
  return "toggle";
}

/** Recebe foco (e entra na ordem do Tab): tudo menos "Carregando…". A linha de erro, sim: é onde fica o "Tentar de novo". */
/** A linha do pai de uma linha da árvore: a mais próxima acima com profundidade menor; na raiz, nenhuma. É para onde a seta para a esquerda leva num nó fechado ou numa folha (o padrão das árvores da WAI-ARIA). */
export function parentRowIndex(rows: readonly NavNode[], index: number): number | null {
  const depth = rows[index]?.depth;
  if (depth === undefined) return null;
  for (let target = index - 1; target >= 0; target -= 1) if (rows[target].depth < depth) return target;
  return null;
}

export const isFocusable = (node: NavNode | undefined): node is NavNode => node !== undefined && node.kind !== "loading";

/**
 * Os nomes que o type-ahead compara (RN-ARVORE-009), um por linha: o que a linha mostra como nome (`label`), sem o selo, o detalhe nem a contagem. A linha
 * de "Carregando…" e a de erro não têm nome (`""`): a mensagem delas não é item que se procure.
 */
export const typeAheadLabels = (rows: readonly NavNode[]): string[] => rows.map((row) => (row.kind === "loading" || row.kind === "error" ? "" : row.label));

/**
 * A única linha que o Tab alcança na lista (as demais só pelas setas): a selecionada, se está entre
 * as linhas desenhadas (`rendered`, índices em `rows`); senão a primeira desenhada que recebe foco.
 * Sem esse recuo, selecionar uma linha e rolar até ela sair da janela virtual deixaria a árvore sem
 * nenhum elemento na ordem do Tab, e o Tab pularia o navegador inteiro.
 */
export function tabbableKey(rows: readonly NavNode[], selectedKey: string | null, rendered: readonly number[]): string | null {
  const candidates = rendered.map((index) => rows[index]).filter(isFocusable);
  return (candidates.find((row) => row.key === selectedKey) ?? candidates[0])?.key ?? null;
}

/**
 * Pastas e conexões salvas como nós; os filhos de cada pasta já vêm como nível carregado.
 * `folderKeys` são as pastas, que começam fechadas e voltam abertas como a pessoa as deixou (RN-NAV-014: `openTreeKeys`, que cruza estas chaves com as pastas
 * lembradas).
 */
export function treeNodes(tree: TreeNode[]): { roots: NavNode[]; levels: Map<string, LevelState>; folderKeys: string[] } {
  const levels = new Map<string, LevelState>();
  const folderKeys: string[] = [];

  function convert(nodes: TreeNode[]): NavNode[] {
    return nodes.map((node): NavNode => {
      if (node.kind === "connection") return { key: navKey({ type: "connection", connectionId: node.id }), kind: "connection", label: node.name, depth: node.depth, hasChildren: true };

      const children = convert(node.children);
      const folder: NavNode = { key: navKey({ type: "folder", id: node.id }), kind: "folder", label: node.name, depth: node.depth, hasChildren: children.length > 0 };
      levels.set(childrenKey(folder), { status: "loaded", children });
      folderKeys.push(folder.key);
      return folder;
    });
  }

  return { roots: convert(tree), levels, folderKeys };
}

/** Uma folha é identificada pela posição na lista que a trouxe: sobrecarga de rotina repete o nome. */
const leafKey = (parent: NavPath, kind: NavKind, index: number) => `${navKey(parent)}#${kind}:${index}`;

/**
 * Os bancos do servidor que a API listou (RN-ARVORE-006), os filhos da conexão: o da conexão primeiro, marcado como o padrão, com a
 * chave sem banco (a sessão dele é a da conexão); os outros na ordem em que vieram (a de nome, do banco), cada um com o nome no caminho.
 */
export function databaseNodes(connectionId: string, databases: readonly ServerDatabase[]): NavNode[] {
  const ordered = [...databases.filter((database) => database.isCurrent), ...databases.filter((database) => !database.isCurrent)];

  return ordered.map((database): NavNode =>
    database.isCurrent
      ? { key: navKey({ type: "database", connectionId }), kind: "database", label: database.name, depth: 0, hasChildren: true, badge: copy.defaultDatabase }
      : { key: navKey({ type: "database", connectionId, database: database.name }), kind: "database", label: database.name, depth: 0, hasChildren: true },
  );
}

/** Esquemas comuns primeiro, os de sistema depois (RN-ARVORE-004); cada grupo em ordem alfabética. `database`: o outro banco do servidor de onde vieram. */
export function schemaNodes(connectionId: string, schemas: readonly Pick<DatabaseSchema, "name" | "isSystem">[], database?: string): NavNode[] {
  return [...schemas]
    .sort(byName)
    .map((schema): NavNode => ({ key: navKey({ type: "schema", connectionId, ...inDatabase(database), schema: schema.name }), kind: "schema", label: schema.name, depth: 0, hasChildren: true, ...(schema.isSystem ? { detail: copy.system } : {}) }));
}

/** Tabelas, Visões e Rotinas: fixos, sem ir ao banco. */
export function schemaGroupNodes(connectionId: string, schema: string, database?: string): NavNode[] {
  return (["tables", "views", "routines", "sequences"] as const).map((objects): NavNode => ({ key: navKey({ type: "objects", connectionId, ...inDatabase(database), schema, objects }), kind: "group", label: copy.groups[objects], depth: 0, hasChildren: true }));
}

/** Só a tabela abre (RN-ARVORE-001); visão e rotina são folhas. */
export function objectNodes(connectionId: string, schema: string, objects: ObjectsKind, items: DatabaseObject[], database?: string): NavNode[] {
  const parent: ObjectsPath = { type: "objects", connectionId, ...inDatabase(database), schema, objects };

  return [...items].sort(byName).map((item, index) => objectNode(parent, item, index));
}

/**
 * A linha de um item da lista de um grupo de objetos. `index` é a posição dele na lista INTEIRA do grupo, em ordem `byName`: a visão e a rotina são folhas, e a chave de
 * folha leva a posição (`leafKey`). A tabela não depende dela. É a mesma linha, com a mesma chave, que a busca monta do índice de nomes (RN-BUSCA-002) antes de o nível
 * carregar, para o duplo clique, o menu e a escolha valerem nela e continuarem valendo quando o nível chegar.
 */
export function objectNode(parent: ObjectsPath, item: DatabaseObject, index: number): NavNode {
  if (item.kind === "table") return { key: navKey({ type: "table", connectionId: parent.connectionId, ...inDatabase(parent.database), schema: parent.schema, table: item.name }), kind: "table", label: item.name, depth: 0, hasChildren: true };
  if (item.kind === "view") return { key: leafKey(parent, "view", index), kind: "view", label: item.name, depth: 0, hasChildren: false };
  if (item.kind === "sequence") return { key: leafKey(parent, "sequence", index), kind: "sequence", label: item.name, depth: 0, hasChildren: false };
  return { key: leafKey(parent, "routine", index), kind: "routine", label: item.name, depth: 0, hasChildren: false, detail: copy.routineKinds[item.kind] };
}

/** Colunas, Índices e Chaves estrangeiras de uma tabela: fixos, sem ir ao banco. */
export function tableGroupNodes(connectionId: string, schema: string, table: string, database?: string): NavNode[] {
  return (["columns", "indexes", "foreignKeys"] as const).map((level): NavNode => ({ key: navKey({ type: "tableLevel", connectionId, ...inDatabase(database), schema, table, level }), kind: "group", label: copy.groups[level], depth: 0, hasChildren: true }));
}

/** Nome, tipo, "nulo" quando aceita e a marca da chave primária (RN-ARVORE-003), na ordem das colunas. */
export function columnNodes(parent: TableLevelPath, columns: Column[]): NavNode[] {
  return [...columns]
    .sort((a, b) => a.position - b.position)
    .map((column, index): NavNode => ({
      key: leafKey(parent, "column", index),
      kind: "column",
      label: column.name,
      depth: 0,
      hasChildren: false,
      detail: column.isNullable ? `${column.type} · ${copy.nullable}` : column.type,
      ...(column.isPrimaryKey ? { badge: copy.primaryKey } : {}),
    }));
}

/** Nome, colunas e a marca de único (RN-ARVORE-003). */
export function indexNodes(parent: TableLevelPath, indexes: TableIndex[]): NavNode[] {
  return indexes.map((index, position): NavNode => ({
    key: leafKey(parent, "index", position),
    kind: "index",
    label: index.name,
    depth: 0,
    hasChildren: false,
    detail: index.columns.join(", "),
    ...(index.isUnique ? { badge: copy.unique } : {}),
  }));
}

/** Nome e `colunas → tabela(colunas)` (RN-ARVORE-003); o esquema da tabela referenciada só aparece quando é outro. */
export function foreignKeyNodes(parent: TableLevelPath, foreignKeys: ForeignKey[]): NavNode[] {
  return foreignKeys.map((foreignKey, position): NavNode => {
    const table = foreignKey.referencedSchema === parent.schema ? foreignKey.referencedTable : `${foreignKey.referencedSchema}.${foreignKey.referencedTable}`;

    return {
      key: leafKey(parent, "foreignKey", position),
      kind: "foreignKey",
      label: foreignKey.name,
      depth: 0,
      hasChildren: false,
      detail: `${foreignKey.columns.join(", ")} → ${table}(${foreignKey.referencedColumns.join(", ")})`,
    };
  });
}
