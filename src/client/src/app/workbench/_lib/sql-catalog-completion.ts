import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { QueryClient } from "@tanstack/react-query";

import type { Engine } from "@/components/ui";

import { hasFailedList, markFailedList } from "./catalog-fetch-failures";
import type { Column, ForeignKey, ReferencingForeignKey } from "./database-sessions.schema";
import { databaseSessionKey, treeKey, type FetchedPath } from "./database-sessions.service";
import { columnNodes, inDatabase, type NavNode, type TableLevelPath } from "./navigator-model";
import type { CachedLevel } from "./navigator-search";
import { cachedLevels, columnOptions, requoted, sameLevels, sqlName } from "./sql-completion";
import { joinSuggestions, linksOf, onSuggestions, type LinkSuggestion, type StatementTable } from "./sql-join";
import { analyzeAt, joinScope, maxAnalyzedLength, resolveQualifier, resolveReference, type Analysis, type Reference, type ResolvedReference } from "./sql-references";
import { columnsQuery, foreignKeysQuery, referencedByQuery, structureKey } from "./table-structure.service";
import { defaultSchemasOf, linkCatalog, type LinkCatalog } from "./table-links";

/**
 * RN-CONFIG-004 e RN-SQL-025: as colunas de `tabela.` (ou `apelido.`) e a junção. São as únicas coisas que o autocompletar busca no banco: as colunas de uma tabela
 * ou visão (`columnsQuery`, a consulta da Estrutura; a lista pronta também vai para a chave da árvore, e a que a árvore já tem vale, então o navegador e a Estrutura
 * mostram depois sem pedir de novo) e as chaves estrangeiras de uma tabela (`foreignKeysQuery` e `referencedByQuery`, o cache da Estrutura). Só com a sessão da
 * árvore daquela conexão e daquele banco já aberta (nada conecta nem reconecta por causa dele), uma vez por lista; a busca que falha não mostra nem avisa nada, e não é
 * refeita enquanto a sessão for a mesma, ou até o "Atualizar" do navegador ou da Estrutura (`forgetFailedLists`).
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

  // O catálogo (o que a árvore já carregou) só é refeito quando algum nível muda, como no link da tabela (RN-LINK-001).
  let catalogOf: { levels: readonly CachedLevel[]; catalog: LinkCatalog } | null = null;
  // O comando é relido uma vez por versão do texto e posição: a fonte de nomes (`owns`) e as duas daqui perguntam o mesmo.
  let analyzed: { doc: Text; position: number; blankLines: boolean; engine: Engine | undefined; analysis: Analysis | null } | null = null;

  const levels = (): CachedLevel[] => {
    const connectionId = env.connectionId();
    return connectionId === null ? [] : cachedLevels(queryClient, connectionId, env.database());
  };

  function catalog(): LinkCatalog {
    const current = levels();
    if (catalogOf === null || !sameLevels(catalogOf.levels, current)) catalogOf = { levels: current, catalog: linkCatalog(current) };
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

  /** A sessão da árvore da conexão e do banco da aba, se já está aberta: só então se busca. */
  function openSession(): string | null {
    const connectionId = env.connectionId();
    if (connectionId === null) return null;
    return queryClient.getQueryData<{ id: string }>(databaseSessionKey(connectionId, env.database()))?.id ?? null;
  }

  /** O que o cache tem de uma consulta: os dados, e se estão em dia (nunca invalidados pelo "Atualizar"). */
  function peek<T>(queryKey: readonly unknown[]): { data: T | undefined; fresh: boolean } {
    const state = queryClient.getQueryState<T>(queryKey);
    return { data: state?.data, fresh: state?.data !== undefined && !state.isInvalidated };
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

    const session = openSession();
    if (session === null) return old;

    const connectionId = env.connectionId() as string;
    if (hasFailedList(queryClient, connectionId, session, queryKey)) return old;

    try {
      return await fetch();
    } catch {
      markFailedList(queryClient, connectionId, session, queryKey);
      if (data === undefined) {
        if (queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() === 0) queryClient.removeQueries({ queryKey, exact: true });
      } else {
        queryClient.setQueryData(queryKey, data);
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      }
      return old;
    }
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
    const found = memberTable(context);
    if (found === null) return null;

    const engine = env.engine();
    const answer = (nodes: NavNode[] | null): CompletionResult | null => {
      if (nodes === null) return null;
      const options: Completion[] = columnOptions(nodes, engine);
      return replacing(context, found.from, found.quoted, found.quoted ? options.map(requoted) : options, found.quoted ? validForQuoted : validForWord);
    };

    const cached = cachedColumns(found.table);
    if (cached.fresh) return answer(cached.nodes ?? null);
    // Sem a sessão da árvore, nada é buscado: a lista velha, se houver, é a resposta.
    if (openSession() === null) return answer(cached.nodes ?? null);

    return columnsOf(found.table).then((nodes) => (context.aborted ? null : answer(nodes)));
  };

  /** A tabela do comando para montar a condição: o apelido como está escrito, ou o nome. */
  function statementTable(resolved: ResolvedReference, links: StatementTable["links"]): StatementTable {
    return { schema: resolved.schema, name: resolved.name, qualifier: resolved.reference.aliasText ?? sqlName(resolved.name, env.engine()), links };
  }

  /** `JOIN `: as tabelas ligadas por chave estrangeira às do comando, com a condição. `JOIN tabela ON `: as condições que ligam a tabela às outras. */
  const joinSource: CompletionSource = (context) => {
    const analysis = analysisAt(context);
    if (analysis === null || (analysis.context.kind !== "join" && analysis.context.kind !== "on")) return null;

    const tableCatalog = catalog();
    const schemas = defaultSchemas();
    const resolve = (references: readonly Reference[]) =>
      references.flatMap((reference) => {
        const table = resolveReference(reference, tableCatalog, schemas);
        return table === null ? [] : [table];
      });
    // Só as tabelas que já valem na posição do cursor (RN-SQL-025): as escritas antes dele, sem o alvo do `INSERT INTO`.
    const resolved = resolve(joinScope(analysis));

    const { context: asked } = analysis;
    const joined = asked.kind === "on" ? resolve([asked.table])[0] : undefined;
    // O `JOIN` da tabela que o catálogo não conhece (uma expressão de tabela, uma tabela que a árvore não abriu) não tem chave para sugerir.
    if (asked.kind === "on" && joined === undefined) return null;
    const wanted = joined === undefined ? resolved : [joined];
    if (wanted.length === 0) return null;

    const listsOf = (table: ResolvedReference) => Promise.all([foreignKeysOf(table), referencedByOf(table)]);
    const answer = (lists: readonly (readonly [ForeignKey[] | null, ReferencingForeignKey[] | null])[]): CompletionResult | null => {
      const tables = wanted.map((table, index) => statementTable(table, linksOf(lists[index][0] ?? undefined, lists[index][1] ?? undefined)));
      const engine = env.engine();
      let suggestions: LinkSuggestion[];
      if (joined === undefined) suggestions = joinSuggestions({ tables, used: analysis.used, usesAliases: analysis.usesAliases, engine, defaultSchemas: schemas });
      else {
        const others = resolved.map((table) => statementTable(table, []));
        suggestions = onSuggestions(tables[0], others, engine);
      }

      const options: Completion[] = suggestions.map((suggestion, index) => ({ label: suggestion.label, detail: suggestion.detail, type: "class", boost: Math.max(1, 99 - index) }));
      return replacing(context, asked.from, asked.quoted, options);
    };

    // Tudo no cache e em dia: a resposta sai na hora, sem esperar uma promessa (a lista não pisca).
    const connectionId = env.connectionId() as string;
    const cachedLists = wanted.map((table) => [peek<ForeignKey[]>(structureKey(connectionId, table.schema, table.name, "foreignKeys", env.database())), peek<ReferencingForeignKey[]>(structureKey(connectionId, table.schema, table.name, "referencedBy", env.database()))] as const);
    const asCached = () => cachedLists.map(([keys, referenced]) => [keys.data ?? null, referenced.data ?? null] as const);
    if (cachedLists.every(([keys, referenced]) => keys.fresh && referenced.fresh)) return answer(asCached());
    if (openSession() === null) return answer(asCached());

    return Promise.all(wanted.map(listsOf)).then((lists) => (context.aborted ? null : answer(lists)));
  };

  return { sources: [columnsSource, joinSource], owns: (context) => memberTable(context) !== null };
}
