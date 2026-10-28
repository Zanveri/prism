import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { QueryClient } from "@tanstack/react-query";

import type { Engine } from "@/components/ui";

import { hasFailedList, markFailedList } from "./catalog-fetch-failures";
import type { Column, ForeignKey, ObjectNames, ReferencingForeignKey } from "./database-sessions.schema";
import { databaseSessionKey, objectNamesKey, objectNamesQuery, treeKey, type FetchedPath } from "./database-sessions.service";
import { columnNodes, inDatabase, type NavNode, type TableLevelPath } from "./navigator-model";
import type { CachedLevel } from "./navigator-search";
import { cachedLevels, columnOptions, requoted, sameLevels, sqlName } from "./sql-completion";
import { joinSuggestions, linksOf, onSuggestions, type LinkSuggestion, type StatementTable } from "./sql-join";
import { analyzeAt, joinScope, maxAnalyzedLength, resolveQualifier, resolveReference, type Analysis, type Reference, type ResolvedReference } from "./sql-references";
import { columnsQuery, foreignKeysQuery, referencedByQuery, structureKey } from "./table-structure.service";
import { defaultSchemasOf, linkCatalog, type LinkCatalog } from "./table-links";

/**
 * RN-CONFIG-004 e RN-SQL-025: as colunas de `tabela.` (ou `apelido.`) e a junção. Buscam no banco o índice de nomes (`objectNamesQuery`, quando a lista de tabelas
 * da barra lateral não está aberta), as colunas de uma tabela ou visão (`columnsQuery`, a consulta da Estrutura; a lista pronta também vai para a chave da árvore, e a
 * que a árvore já tem vale, então o navegador e a Estrutura mostram depois sem pedir de novo) e as chaves estrangeiras de uma tabela (`foreignKeysQuery` e
 * `referencedByQuery`, o cache da Estrutura). Uma vez por lista; a busca que falha não mostra nem avisa nada, e não é refeita enquanto a sessão for a mesma, ou até o
 * "Atualizar" do navegador ou da Estrutura (`forgetFailedLists`).
 *
 * Uma lista que o "Atualizar" invalidou (`isInvalidated`) não vale mais: o `invalidateQueries` só busca de novo a que alguém está mostrando, e a que o autocompletar
 * buscou sozinho fica velha no cache. Com a sessão aberta, é buscada de novo (o `fetchQuery` busca a invalidada mesmo com `staleTime` infinito); se a busca falha, a velha
 * segue valendo; sem a sessão, também.
 */

export type CatalogCompletionEnv = {
  queryClient: QueryClient;
  engine: () => Engine | undefined;
  /** A conexão da aba, ou `null` (a aba sem conexão não completa nada daqui). */
  connectionId: () => string | null;
  /** O outro banco do servidor da aba (RN-ARVORE-006). */
  database: () => string | undefined;
  /** O usuário da conexão, de onde sai o esquema padrão da sessão. */
  userName: () => string | undefined;
  /** A linha em branco separa os comandos (RN-SQL-018). */
  blankLines: () => boolean;
  /** A preferência de palavras-chave em maiúsculas (RN-CONFIG-004), respeitada no `ON` e no `AND` da junção. */
  uppercaseKeywords?: () => boolean;
  /** Quando `true`, abre a sessão do catálogo se a aba está conectada a um banco mesmo sem a árvore expandida na barra lateral. */
  autoConnect?: () => boolean;
};

export type CatalogCompletion = {
  /** As fontes novas: as colunas de `nome.` e a junção. */
  sources: CompletionSource[];
  /**
   * `nome.` é uma tabela, visão ou apelido que a fonte das colunas completa (com as colunas do cache ou buscando-as): a fonte de nomes do `lang-sql` se cala ali
   * para a lista não ter cada coluna duas vezes.
   */
  owns: (context: CompletionContext) => boolean;
};

/** O que vem antes do cursor e pode ser um pedido destas fontes: um ponto, ou `JOIN`/`ON` e o espaço, e a palavra (ou o nome entre aspas) começada. */
const mayAsk = /(?:\.|\b(?:join|on)\s+)(?:"[^"\n]*|[\p{L}\p{N}_$]*)$/iu;
/** O quanto do texto antes do cursor a conferência rápida olha. */
const lookBack = 400;

const validForWord = /^[\p{L}\p{N}_$]*$/u;
const validForQuoted = /^"[^"]*"?$/;

/** Uma tabela do catálogo. */
type TableName = { schema: string; name: string };

export function catalogCompletion(env: CatalogCompletionEnv): CatalogCompletion {
  const { queryClient } = env;

  // O catálogo (o que a árvore já carregou mais o índice de nomes do banco) só é refeito quando algum nível ou o índice muda, como no link da tabela (RN-LINK-001).
  let catalogOf: { levels: readonly CachedLevel[]; names: ObjectNames | undefined; catalog: LinkCatalog } | null = null;
  // O comando é relido uma vez por versão do texto e posição: a fonte de nomes (`owns`) e as duas daqui perguntam o mesmo.
  let analyzed: { doc: Text; position: number; blankLines: boolean; engine: Engine | undefined; analysis: Analysis | null } | null = null;

  const levels = (): CachedLevel[] => {
    const connectionId = env.connectionId();
    return connectionId === null ? [] : cachedLevels(queryClient, connectionId, env.database());
  };

  function catalog(): LinkCatalog {
    const current = levels();
    const connectionId = env.connectionId();
    const names = connectionId === null ? undefined : queryClient.getQueryData<ObjectNames>(objectNamesKey(connectionId, env.database()));
    if (catalogOf === null || !sameLevels(catalogOf.levels, current) || catalogOf.names !== names) {
      catalogOf = { levels: current, names, catalog: linkCatalog(current, names) };
    }
    return catalogOf.catalog;
  }

  function analysisAt(context: CompletionContext): Analysis | null {
    if (env.connectionId() === null) return null;
    const { doc } = context.state;
    if (doc.length > maxAnalyzedLength || !mayAsk.test(doc.sliceString(Math.max(0, context.pos - lookBack), context.pos))) return null;

    const blankLines = env.blankLines();
    const engine = env.engine();
    if (analyzed === null || analyzed.doc !== doc || analyzed.position !== context.pos || analyzed.blankLines !== blankLines || analyzed.engine !== engine) analyzed = { doc, position: context.pos, blankLines, engine, analysis: analyzeAt(doc.toString(), context.pos, engine, blankLines) };
    return analyzed.analysis;
  }

  const defaultSchemas = () => defaultSchemasOf(env.engine(), env.userName());

  /** A tabela de `nome.`, se o catálogo a tem. */
  function memberTable(context: CompletionContext): { analysis: Analysis; table: TableName; from: number; quoted: boolean } | null {
    const analysis = analysisAt(context);
    if (analysis === null || analysis.context.kind !== "member") return null;

    const table = resolveQualifier(analysis.context.qualifier, analysis.references, catalog(), defaultSchemas(), analysis.outerReferences);
    return table === null ? null : { analysis, table, from: analysis.context.from, quoted: analysis.context.quoted };
  }

  /** A sessão da árvore da conexão e do banco da aba, se já está aberta: só então se busca (ou quando `autoConnect` autoriza abri-la). */
  function openSession(): string | null {
    const connectionId = env.connectionId();
    if (connectionId === null) return null;
    return queryClient.getQueryData<{ id: string }>(databaseSessionKey(connectionId, env.database()))?.id ?? null;
  }

  function canFetch(): boolean {
    if (env.connectionId() === null) return false;
    return openSession() !== null || env.autoConnect?.() === true;
  }

  /** O que o cache tem de uma consulta: os dados, e se estão em dia (nunca invalidados pelo "Atualizar"). */
  function peek<T>(queryKey: readonly unknown[]): { data: T | undefined; fresh: boolean } {
    const state = queryClient.getQueryState<T>(queryKey);
    return { data: state?.data, fresh: state?.data !== undefined && !state.isInvalidated };
  }

  /** Se ainda falta buscar o índice de nomes do banco (quando a lista de tabelas da barra lateral não foi aberta para todos os esquemas). */
  function needsObjectNames(): boolean {
    const connectionId = env.connectionId();
    if (connectionId === null) return false;
    if (peek<ObjectNames>(objectNamesKey(connectionId, env.database())).fresh) return false;
    const base = linkCatalog(levels());
    if (base.size === 0) return true;
    const schemas = peek<NavNode[]>(treeKey({ type: "database", connectionId, ...inDatabase(env.database()) })).data;
    return schemas === undefined || schemas.some((node) => node.kind === "schema" && !base.has(node.label));
  }

  /**
   * A lista de uma consulta: a do cache, se está em dia; senão (com a sessão da árvore aberta e a lista ainda não pedida sem falha) a que chega da busca. As buscas da
   * mesma lista dividem uma só requisição. A lista velha (invalidada) é o que sobra quando não há sessão ou a busca falha. `null`: não deu (sem sessão e sem lista, ou a
   * busca falhou). A lista que falhou sem nunca ter vindo sai do cache quando ninguém a mostra, para a árvore não mostrar um erro que a pessoa nunca pediu; a velha
   * volta ao estado de antes da busca (velha, sem o erro), para a árvore a refazer ao abrir o nó.
   */
  async function listOf<T>(queryKey: readonly unknown[], fetch: () => Promise<T>): Promise<T | null> {
    const { data, fresh } = peek<T>(queryKey);
    if (fresh) return data as T;
    const old = data ?? null;

    if (!canFetch()) return old;
    const sessionBefore = openSession() ?? "auto";

    const connectionId = env.connectionId() as string;
    if (hasFailedList(queryClient, connectionId, sessionBefore, queryKey)) return old;

    try {
      return await fetch();
    } catch {
      const sessionAfter = openSession() ?? sessionBefore;
      markFailedList(queryClient, connectionId, sessionAfter, queryKey);
      if (data === undefined) {
        if (queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() === 0) queryClient.removeQueries({ queryKey, exact: true });
      } else {
        queryClient.setQueryData(queryKey, data);
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      }
      return old;
    }
  }

  function ensureObjectNames(): Promise<ObjectNames | null> {
    const connectionId = env.connectionId() as string;
    return listOf<ObjectNames>(objectNamesKey(connectionId, env.database()), () => queryClient.fetchQuery(objectNamesQuery(connectionId, env.database(), queryClient, true)));
  }

  const columnsPath = (table: TableName): TableLevelPath & FetchedPath => ({ type: "tableLevel", connectionId: env.connectionId() as string, ...inDatabase(env.database()), schema: table.schema, table: table.name, level: "columns" });

  const structureColumnsKey = (table: TableName) => structureKey(env.connectionId() as string, table.schema, table.name, "columns", env.database());

  /**
   * As colunas que o cache já tem: as da árvore (linhas prontas) ou as da Estrutura (o dado cru, que vira as mesmas linhas), as que estão em dia; a que uma delas
   * guarda em dia vai também para a chave da outra, e o navegador não pergunta de novo. Sem nenhuma em dia, as velhas (`fresh` falso), se houver.
   */
  function cachedColumns(table: TableName): { nodes: NavNode[] | undefined; fresh: boolean } {
    const path = columnsPath(table);
    const tree = peek<NavNode[]>(treeKey(path));
    if (tree.fresh) return { nodes: tree.data, fresh: true };

    const structure = peek<Column[]>(structureColumnsKey(table));
    if (structure.data === undefined) return { nodes: tree.data, fresh: false };

    const nodes = columnNodes(path, structure.data);
    if (!structure.fresh) return { nodes: tree.data ?? nodes, fresh: false };

    queryClient.setQueryData(treeKey(path), nodes);
    return { nodes, fresh: true };
  }

  async function columnsOf(table: TableName): Promise<NavNode[] | null> {
    const connectionId = env.connectionId() as string;
    const rows = await listOf<Column[]>(structureColumnsKey(table), () => queryClient.fetchQuery({ ...columnsQuery(connectionId, table.schema, table.name, queryClient, true, env.database()), meta: { silent: true } }));
    if (rows === null) return null;

    const path = columnsPath(table);
    const nodes = columnNodes(path, rows);
    // A lista que acabou de chegar vai também para a chave da árvore; a velha que sobrou de uma busca que falhou, não.
    if (peek(structureColumnsKey(table)).fresh) queryClient.setQueryData(treeKey(path), nodes);
    return nodes;
  }

  const foreignKeysOf = (table: TableName) => {
    const connectionId = env.connectionId() as string;
    return listOf<ForeignKey[]>(structureKey(connectionId, table.schema, table.name, "foreignKeys", env.database()), () => queryClient.fetchQuery({ ...foreignKeysQuery(connectionId, table.schema, table.name, queryClient, true, env.database()), meta: { silent: true } }));
  };

  const referencedByOf = (table: TableName) => {
    const connectionId = env.connectionId() as string;
    return listOf<ReferencingForeignKey[]>(structureKey(connectionId, table.schema, table.name, "referencedBy", env.database()), () => queryClient.fetchQuery({ ...referencedByQuery(connectionId, table.schema, table.name, queryClient, true, env.database()), meta: { silent: true } }));
  };

  /** O resultado de uma lista de sugestões que troca o texto da palavra (ou do nome entre aspas aberto) do cursor. */
  function replacing(context: CompletionContext, from: number, quoted: boolean, options: Completion[], validFor?: RegExp): CompletionResult | null {
    if (options.length === 0) return null;
    // O nome entre aspas que a tela fechou sozinha (`p."|"`) é trocado junto.
    const to = quoted && context.state.sliceDoc(context.pos, context.pos + 1) === '"' ? context.pos + 1 : undefined;
    return { from, ...(to === undefined ? {} : { to }), options, ...(validFor === undefined ? {} : { validFor }) };
  }

  /** `tabela.`, `apelido.` e `esquema.tabela.`: as colunas. Uma tabela de colunas ainda não vistas é buscada, e a lista abre quando chegam. */
  const columnsSource: CompletionSource = (context) => {
    const analysis = analysisAt(context);
    if (analysis === null || analysis.context.kind !== "member") return null;

    const engine = env.engine();
    const { from, quoted, qualifier } = analysis.context;
    const answer = (nodes: NavNode[] | null): CompletionResult | null => {
      if (nodes === null) return null;
      const options: Completion[] = columnOptions(nodes, engine);
      return replacing(context, from, quoted, quoted ? options.map(requoted) : options, quoted ? validForQuoted : validForWord);
    };

    const resolve = () => resolveQualifier(qualifier, analysis.references, catalog(), defaultSchemas(), analysis.outerReferences);
    const table = resolve();
    if (table === null) {
      if (!needsObjectNames() || !canFetch()) return null;
      return ensureObjectNames().then(async (names) => {
        if (context.aborted || names === null) return null;
        const resolved = resolve();
        if (resolved === null) return null;
        const cached = cachedColumns(resolved);
        const nodes = cached.fresh ? (cached.nodes ?? null) : await columnsOf(resolved);
        return context.aborted ? null : answer(nodes);
      });
    }

    const cached = cachedColumns(table);
    if (cached.fresh) return answer(cached.nodes ?? null);
    // Sem a sessão da árvore, nada é buscado: a lista velha, se houver, é a resposta.
    if (!canFetch()) return answer(cached.nodes ?? null);

    return columnsOf(table).then((nodes) => (context.aborted ? null : answer(nodes)));
  };

  /** A tabela do comando para montar a condição: o apelido como está escrito, ou o nome, e se foi qualificada com esquema. */
  function statementTable(resolved: ResolvedReference, links: StatementTable["links"]): StatementTable {
    return {
      schema: resolved.schema,
      name: resolved.name,
      qualifier: resolved.reference.aliasText ?? sqlName(resolved.name, env.engine()),
      qualified: resolved.reference.schema !== null,
      links,
    };
  }

  /** `JOIN `: as tabelas ligadas por chave estrangeira às do comando, com a condição. `JOIN tabela ON `: as condições que ligam a tabela às outras. */
  const joinSource: CompletionSource = (context) => {
    const analysis = analysisAt(context);
    if (analysis === null || (analysis.context.kind !== "join" && analysis.context.kind !== "on")) return null;

    const schemas = defaultSchemas();
    // Só as tabelas que já valem na posição do cursor (RN-SQL-025): as escritas antes dele, sem o alvo do `INSERT INTO`.
    const scope = joinScope(analysis);
    const { context: asked } = analysis;

    const resolveAll = () => {
      const tableCatalog = catalog();
      const resolve = (references: readonly Reference[]) =>
        references.flatMap((reference) => {
          const table = resolveReference(reference, tableCatalog, schemas);
          return table === null ? [] : [table];
        });
      const resolved = resolve(scope);
      const joined = asked.kind === "on" ? resolve([asked.table])[0] : undefined;
      const missing = scope.length > resolved.length || (asked.kind === "on" && joined === undefined);
      return { resolved, joined, missing };
    };

    const listsOf = (table: ResolvedReference) => Promise.all([foreignKeysOf(table), referencedByOf(table)]);
    const answer = (
      resolved: readonly ResolvedReference[],
      joined: ResolvedReference | undefined,
      wanted: readonly ResolvedReference[],
      lists: readonly (readonly [ForeignKey[] | null, ReferencingForeignKey[] | null])[],
    ): CompletionResult | null => {
      const tables = wanted.map((table, index) => statementTable(table, linksOf(lists[index][0] ?? undefined, lists[index][1] ?? undefined)));
      const engine = env.engine();
      const uppercaseKeywords = env.uppercaseKeywords?.() ?? true;
      let suggestions: LinkSuggestion[];
      if (joined === undefined) suggestions = joinSuggestions({ tables, used: analysis.used, usesAliases: analysis.usesAliases, engine, defaultSchemas: schemas, uppercaseKeywords });
      else {
        const others = resolved.map((table) => statementTable(table, []));
        suggestions = onSuggestions(tables[0], others, engine, uppercaseKeywords);
      }

      const options: Completion[] = suggestions.map((suggestion, index) => ({ label: suggestion.label, detail: suggestion.detail, type: "class", boost: Math.max(1, 99 - index) }));
      return replacing(context, asked.from, asked.quoted, options);
    };

    const initial = resolveAll();
    if (initial.missing && needsObjectNames() && canFetch()) {
      return ensureObjectNames().then(async (names) => {
        if (context.aborted || names === null) return null;
        const next = resolveAll();
        if (asked.kind === "on" && next.joined === undefined) return null;
        const wanted = next.joined === undefined ? next.resolved : [next.joined];
        if (wanted.length === 0) return null;
        const lists = await Promise.all(wanted.map(listsOf));
        return context.aborted ? null : answer(next.resolved, next.joined, wanted, lists);
      });
    }

    // O `JOIN` da tabela que o catálogo não conhece (uma expressão de tabela, uma tabela inexistente) não tem chave para sugerir.
    if (asked.kind === "on" && initial.joined === undefined) return null;
    const wanted = initial.joined === undefined ? initial.resolved : [initial.joined];
    if (wanted.length === 0) return null;

    // Tudo no cache e em dia: a resposta sai na hora, sem esperar uma promessa (a lista não pisca).
    const connectionId = env.connectionId() as string;
    const cachedLists = wanted.map((table) => [peek<ForeignKey[]>(structureKey(connectionId, table.schema, table.name, "foreignKeys", env.database())), peek<ReferencingForeignKey[]>(structureKey(connectionId, table.schema, table.name, "referencedBy", env.database()))] as const);
    const asCached = () => cachedLists.map(([keys, referenced]) => [keys.data ?? null, referenced.data ?? null] as const);
    if (cachedLists.every(([keys, referenced]) => keys.fresh && referenced.fresh)) return answer(initial.resolved, initial.joined, wanted, asCached());
    if (!canFetch()) return answer(initial.resolved, initial.joined, wanted, asCached());

    return Promise.all(wanted.map(listsOf)).then((lists) => (context.aborted ? null : answer(initial.resolved, initial.joined, wanted, lists)));
  };

  return { sources: [columnsSource, joinSource], owns: (context) => memberTable(context) !== null };
}
