import type { Engine } from "@/components/ui";

import { sqlName } from "./sql-completion";
import { aliasFor, joinCondition, type TableLink } from "./sql-join";
import { analyzeAt, type Reference } from "./sql-references";
import { sqlTokens, statementAt, type SqlToken } from "./sql-statements";

/**
 * A árvore recursiva de sugestões de ligação (`JOIN`) do modal aberto pelo menu de contexto ou por `Ctrl+.` no editor SQL.
 * A partir das tabelas do `FROM` (e dos `JOIN`s já escritos no comando), lista as tabelas que podem ser ligadas por chave estrangeira;
 * à medida que a pessoa marca uma tabela filha, abre abaixo dela as ligações possíveis daquela tabela, recursivamente.
 */

export type JoinTreeNode = {
  /** Identificador único do nó na árvore (caminho desde a raiz). */
  id: string;
  /** Esquema da tabela de origem (pai). */
  sourceSchema: string;
  /** Nome da tabela de origem (pai). */
  sourceName: string;
  /** Esquema da tabela ligada (filha). */
  targetSchema: string;
  /** Nome da tabela ligada (filha). */
  targetName: string;
  /** Nome da constraint de FK. */
  constraintName: string;
  /** Colunas na tabela pai (`own` em `TableLink`). */
  sourceColumns: readonly string[];
  /** Colunas na tabela filha (`other` em `TableLink`). */
  targetColumns: readonly string[];
  /** Profundidade de indentação (1 para filhas diretas do FROM, 2 para netas, etc.). */
  depth: number;
  /** Se o checkbox está marcado. */
  checked: boolean;
  /** Se as chaves estrangeiras desta tabela filha estão sendo carregadas. */
  loading: boolean;
  /** Se as chaves estrangeiras desta tabela filha já foram carregadas. */
  loaded: boolean;
  /** As ligações possíveis a partir desta tabela filha (exibidas abaixo quando `checked` é `true`). */
  children: JoinTreeNode[];
};

export type JoinTreeRoot = {
  key: string;
  schema: string;
  name: string;
  /** O qualificador da tabela no comando (o apelido, quando tem, ou o nome como vai ao SQL). */
  qualifier: string;
  /** Se a tabela foi escrita com esquema no comando (`esquema.tabela`). */
  qualified: boolean;
  /** As ligações diretas a partir desta tabela do comando. */
  nodes: JoinTreeNode[];
};

export type ExcludeBackLink = {
  constraintName: string;
  schema: string;
  table: string;
};

/** Cria os nós filhos de uma tabela a partir das ligações (`linksOf`), sem repetir a própria constraint de volta para a tabela pai. */
export function childNodesOf(
  parentId: string,
  sourceSchema: string,
  sourceName: string,
  depth: number,
  links: readonly TableLink[],
  exclude?: ExcludeBackLink,
): JoinTreeNode[] {
  return links
    .filter(
      (link) =>
        exclude === undefined ||
        !(link.name === exclude.constraintName && link.table.schema === exclude.schema && link.table.name === exclude.table),
    )
    .map((link, index) => ({
      id: `${parentId}/${index}:${link.table.schema}.${link.table.name}:${link.name}`,
      sourceSchema,
      sourceName,
      targetSchema: link.table.schema,
      targetName: link.table.name,
      constraintName: link.name,
      sourceColumns: link.own,
      targetColumns: link.other,
      depth,
      checked: false,
      loading: false,
      loaded: false,
      children: [],
    }));
}

function uncheckSubtree(nodes: readonly JoinTreeNode[]): JoinTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    checked: false,
    children: node.children.length === 0 ? node.children : uncheckSubtree(node.children),
  }));
}

function mapNodes(nodes: readonly JoinTreeNode[], nodeId: string, updater: (node: JoinTreeNode) => JoinTreeNode): JoinTreeNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) return updater(node);
    if (node.children.length === 0) return node;
    return { ...node, children: mapNodes(node.children, nodeId, updater) };
  });
}

/** Encontra um nó pelo `id` na árvore. */
export function findJoinNode(roots: readonly JoinTreeRoot[], nodeId: string): JoinTreeNode | null {
  const visit = (nodes: readonly JoinTreeNode[]): JoinTreeNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      const found = visit(node.children);
      if (found !== null) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = visit(root.nodes);
    if (found !== null) return found;
  }
  return null;
}

/** Marca ou desmarca um checkbox da árvore. Ao desmarcar um nó pai, desmarca também as tabelas filhas abaixo dele. */
export function toggleJoinNode(roots: readonly JoinTreeRoot[], nodeId: string, checked: boolean): JoinTreeRoot[] {
  return roots.map((root) => ({
    ...root,
    nodes: mapNodes(root.nodes, nodeId, (node) => ({
      ...node,
      checked,
      children: checked ? node.children : uncheckSubtree(node.children),
    })),
  }));
}

/** Marca um nó como carregando as suas ligações filhas. */
export function setJoinNodeLoading(roots: readonly JoinTreeRoot[], nodeId: string, loading: boolean): JoinTreeRoot[] {
  return roots.map((root) => ({
    ...root,
    nodes: mapNodes(root.nodes, nodeId, (node) => ({ ...node, loading })),
  }));
}

/** Preenche as ligações filhas de um nó quando as chaves estrangeiras dele chegam do banco. */
export function setJoinNodeChildren(roots: readonly JoinTreeRoot[], nodeId: string, links: readonly TableLink[]): JoinTreeRoot[] {
  return roots.map((root) => ({
    ...root,
    nodes: mapNodes(root.nodes, nodeId, (node) => ({
      ...node,
      loading: false,
      loaded: true,
      children: childNodesOf(node.id, node.targetSchema, node.targetName, node.depth + 1, links, {
        constraintName: node.constraintName,
        schema: node.sourceSchema,
        table: node.sourceName,
      }),
    })),
  }));
}

export type BuildJoinsOptions = {
  used: ReadonlySet<string>;
  usesAliases: boolean;
  engine: Engine | undefined;
  defaultSchemas: readonly string[] | null;
  uppercaseKeywords: boolean;
};

export type GeneratedJoin = {
  nodeId: string;
  /** A cláusula completa: `inner join tabela on ...` ou `INNER JOIN tabela ON ...`. */
  clause: string;
  /** O corpo depois de `JOIN `: `tabela on ...` ou `tabela ON ...`. */
  body: string;
  /** A condição de ligação (`tabela.col = pai.col`). */
  condition: string;
  /** O nome da tabela (e apelido, se houver) como fica no comando. */
  targetLabel: string;
};

/**
 * Monta as cláusulas `INNER JOIN` para todos os checkboxes marcados na árvore, na ordem hierárquica (pai antes da filha),
 * respeitando a preferência de maiúsculas (`uppercaseKeywords`) e se o usuário qualificou ou não o esquema na tabela de origem.
 */
export function buildSelectedJoins(roots: readonly JoinTreeRoot[], options: BuildJoinsOptions): GeneratedJoin[] {
  const { engine, defaultSchemas, uppercaseKeywords } = options;
  const used = new Set<string>(options.used);
  const knownTables: { schema: string; name: string }[] = roots.map((root) => ({ schema: root.schema, name: root.name }));
  const result: GeneratedJoin[] = [];

  const joinKeyword = uppercaseKeywords ? "INNER JOIN" : "inner join";
  const onKeyword = uppercaseKeywords ? "ON" : "on";

  const visit = (nodes: readonly JoinTreeNode[], parentQualifier: string, parentQualified: boolean) => {
    for (const node of nodes) {
      if (!node.checked) continue;

      const hasSameNameInOtherSchema = knownTables.some((table) => table.name === node.targetName && table.schema !== node.targetSchema);
      const inDefaultSchema = defaultSchemas !== null && defaultSchemas.includes(node.targetSchema);
      const needsSchema = hasSameNameInOtherSchema || (parentQualified && !inDefaultSchema);

      const plainTable = sqlName(node.targetName, engine);
      const writtenTable = needsSchema ? `${sqlName(node.targetSchema, engine)}.${plainTable}` : plainTable;

      const needsAlias = options.usesAliases || used.has(node.targetName.toLowerCase());
      let qualifier: string;
      let targetLabel: string;
      if (needsAlias) {
        const alias = aliasFor(node.targetName, used);
        used.add(alias.toLowerCase());
        qualifier = alias;
        targetLabel = `${writtenTable} ${alias}`;
      } else {
        used.add(node.targetName.toLowerCase());
        qualifier = plainTable;
        targetLabel = writtenTable;
      }

      knownTables.push({ schema: node.targetSchema, name: node.targetName });
      const condition = joinCondition(qualifier, node.targetColumns, parentQualifier, node.sourceColumns, engine, uppercaseKeywords);
      const body = `${targetLabel} ${onKeyword} ${condition}`;
      const clause = `${joinKeyword} ${body}`;

      result.push({ nodeId: node.id, clause, body, condition, targetLabel });

      if (node.children.length > 0) {
        visit(node.children, qualifier, parentQualified || needsSchema);
      }
    }
  };

  for (const root of roots) {
    visit(root.nodes, root.qualifier, root.qualified);
  }

  return result;
}

/** Palavras que encerram a seção `FROM`/`JOIN` no nível principal do comando. */
const afterFromClauses = new Set([
  "where",
  "group",
  "having",
  "window",
  "order",
  "limit",
  "offset",
  "fetch",
  "for",
  "union",
  "intersect",
  "except",
]);

function findFromSectionEnd(statementText: string, engine: Engine | undefined): number {
  const tokens = sqlTokens(statementText, engine);
  let depth = 0;
  let seenFrom = false;
  let lastTokenEnd = statementText.length;

  for (let index = 0; index < tokens.length; index++) {
    const token: SqlToken = tokens[index];
    if (!token.word) {
      if (token.text === "(") depth++;
      else if (token.text === ")" && depth > 0) depth--;
      else if (token.text === ";" && depth === 0) return lastTokenEnd;
      if (depth === 0 && token.text !== ";") lastTokenEnd = token.end;
      continue;
    }

    if (depth === 0) {
      const prev = tokens[index - 1];
      if (token.text === "from" && !(prev?.word === true && prev.text === "distinct")) {
        seenFrom = true;
      } else if (seenFrom && afterFromClauses.has(token.text)) {
        return lastTokenEnd;
      }
      lastTokenEnd = token.end;
    }
  }

  return lastTokenEnd;
}

function findEnclosingSubqueryBounds(
  statementText: string,
  cursorOffset: number,
  engine: Engine | undefined,
): { start: number; end: number } {
  const tokens = sqlTokens(statementText, engine);
  const stack: number[] = [];
  const closes = new Map<number, number>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.word) continue;
    if (token.text === "(") stack.push(i);
    else if (token.text === ")") {
      const open = stack.pop();
      if (open !== undefined) closes.set(open, i);
    }
  }

  let bestOpen: number | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.word || token.text !== "(") continue;
    const next = tokens[i + 1];
    if (next?.word !== true || (next.text !== "select" && next.text !== "with")) continue;
    const closeIdx = closes.get(i);
    const openEnd = token.end;
    const closeStart = closeIdx !== undefined ? tokens[closeIdx].start : statementText.length;
    if (cursorOffset >= openEnd && cursorOffset <= closeStart) {
      bestOpen = i;
    }
  }

  if (bestOpen === undefined) {
    return { start: 0, end: statementText.length };
  }

  const closeIdx = closes.get(bestOpen);
  return {
    start: tokens[bestOpen].end,
    end: closeIdx !== undefined ? tokens[closeIdx].start : statementText.length,
  };
}

export type StatementJoinModalPlan = {
  references: Reference[];
  used: Set<string>;
  usesAliases: boolean;
  /** Onde inserir as cláusulas geradas no documento do editor. */
  insert: {
    from: number;
    to: number;
    mode: "after-join" | "append-clause";
    indent: string;
  };
};

/**
 * Analisa o comando onde está o cursor para o modal de sugestões de ligação: extrai as tabelas do `FROM`/`JOIN`
 * (mesmo se o cursor estiver em cima do nome da tabela ou no `SELECT`) e descobre onde inserir os `JOIN`s escolhidos.
 */
export function analyzeStatementForJoinModal(
  sql: string,
  position: number,
  engine: Engine | undefined,
  blankLines = false,
): StatementJoinModalPlan | null {
  const statement = statementAt(sql, position, engine, { blankLines });
  if (statement === null) return null;

  const cursorInStatement = Math.max(0, Math.min(position - statement.start, statement.text.length));
  const bounds = findEnclosingSubqueryBounds(statement.text, cursorInStatement, engine);
  const fullSql = `${statement.text.slice(0, bounds.end)} ${statement.text.slice(bounds.end)}`;

  const atCursor = analyzeAt(sql, position, engine, blankLines);
  const full = analyzeAt(fullSql, bounds.end + 1, engine, false);
  const base = atCursor?.context.kind === "join" ? atCursor : (full ?? atCursor);
  if (base === null) return null;

  const references = base.references.filter((reference) => reference.via !== "into");
  if (references.length === 0) return null;

  // Detecta a indentação para novas linhas de JOIN a partir do comando.
  const lines = statement.text.split(/\r?\n/);
  const joinLine = lines.find((line) => /^\s*(?:inner\s+|left\s+|right\s+|full\s+)?join\b/i.test(line));
  const indent = joinLine !== undefined ? (/^(\s*)/.exec(joinLine)?.[1] ?? "") : "";

  if (atCursor !== null && atCursor.context.kind === "join") {
    const joinFrom = atCursor.context.from;
    return {
      references: references.filter((reference) => reference.start < joinFrom - atCursor.offset),
      used: atCursor.used,
      usesAliases: atCursor.usesAliases,
      insert: {
        from: joinFrom,
        to: Math.max(joinFrom, position),
        mode: "after-join",
        indent,
      },
    };
  }

  if (full !== null && full.context.kind === "join") {
    const joinFrom = statement.start + full.context.from;
    return {
      references,
      used: full.used,
      usesAliases: full.usesAliases,
      insert: {
        from: joinFrom,
        to: joinFrom,
        mode: "after-join",
        indent,
      },
    };
  }

  const scopeText = statement.text.slice(bounds.start, bounds.end);
  const sectionEnd = statement.start + bounds.start + findFromSectionEnd(scopeText, engine);
  return {
    references,
    used: base.used,
    usesAliases: base.usesAliases,
    insert: {
      from: sectionEnd,
      to: sectionEnd,
      mode: "append-clause",
      indent,
    },
  };
}

/** Formata o texto final que será inserido no editor a partir das junções marcadas no modal. */
export function formatJoinInsertion(joins: readonly GeneratedJoin[], insert: StatementJoinModalPlan["insert"]): string {
  if (joins.length === 0) return "";
  if (insert.mode === "after-join") {
    const [first, ...rest] = joins;
    return [first.body, ...rest.map((join) => `\n${insert.indent}${join.clause}`)].join("");
  }
  return joins.map((join) => `\n${insert.indent}${join.clause}`).join("");
}
